import { Direction, ICommandService, RANGE_TYPE, type ICellData, type IRange, type IWorkbookData, type Univer } from '@univerjs/core';
import type { FUniver } from '@univerjs/presets';
import { InsertColByRangeCommand, InsertRowByRangeCommand, RemoveColByRangeCommand, RemoveRowByRangeCommand } from '@univerjs/sheets';
import { ALL_IMPLEMENTED_FUNCTIONS_SET, ERROR_TYPE_SET, type ErrorType, type IFunctionNames, LexerTreeBuilder, deserializeRangeWithSheet, sequenceNodeType } from '@univerjs/engine-formula';
import type { WorkbookDocument } from '@open-design/contracts/runtime/workbook';
import { assertWorkbookStructuralScalarTokens } from '@open-design/contracts/runtime/workbook-formula-policy';
import { workbookAxisProjection } from '@open-design/contracts/runtime/workbook-structure';
import { assertWorkbookCalculationMutation } from './formula-worker-budget';
import { workbookGridEdits } from './grid-edits';

export type WorkbookStructureAction = 'row-before' | 'row-after' | 'row-delete' | 'column-before' | 'column-after' | 'column-delete';
export const workbookStructureActions: readonly WorkbookStructureAction[] = ['row-before', 'row-after', 'row-delete', 'column-before', 'column-after', 'column-delete'];
export interface WorkbookStructureSource { model: WorkbookDocument; sourceSha256: string; acknowledged: IWorkbookData }
export interface WorkbookStructureScope { projectId: string; controllerId: string; blocked: boolean }
export interface WorkbookStructureSelection { key: string; sheetId: string; range: IRange; rowCount: number; columnCount: number; axis: 'row' | 'column' | 'both'; allowed: Partial<Record<WorkbookStructureAction, boolean>> }
interface AxisAction { axis: 'row' | 'column'; insert: boolean; start: number; count: number; range: IRange; command: string; direction?: Direction }
function axisAction(action: WorkbookStructureAction, range: IRange, rows: number, columns: number): AxisAction {
  const axis = action.startsWith('row-') ? 'row' : 'column', insert = !action.endsWith('-delete');
  const first = axis === 'row' ? range.startRow : range.startColumn, last = axis === 'row' ? range.endRow : range.endColumn;
  const start = action.endsWith('-after') ? last + 1 : first, count = last - first + 1;
  return { axis, insert, start, count,
    range: axis === 'row' ? { startRow: start, endRow: start + count - 1, startColumn: 0, endColumn: columns - 1 } : { startRow: 0, endRow: rows - 1, startColumn: start, endColumn: start + count - 1 },
    command: axis === 'row' ? insert ? InsertRowByRangeCommand.id : RemoveRowByRangeCommand.id : insert ? InsertColByRangeCommand.id : RemoveColByRangeCommand.id,
    ...(insert ? { direction: axis === 'row' ? action.endsWith('-before') ? Direction.UP : Direction.DOWN : action.endsWith('-before') ? Direction.LEFT : Direction.RIGHT } : {}),
  };
}
function projection(action: AxisAction, rows: number, columns: number) {
  const count = action.axis === 'row' ? rows : columns;
  const origins = Array.from({ length: action.insert ? count + action.count : count - action.count }, (_, index) => action.insert ? index < action.start ? index : index < action.start + action.count ? null : index - action.count : index < action.start ? index : index + action.count);
  return workbookAxisProjection(count, origins, action.axis === 'row' ? 1048576 : 16384);
}
/** Check current and prospective scalar references through the actual pinned
 * lexer. This is admission only; source XML and calculation revalidate on save. */
function scalarAdmission(book: IWorkbookData, lexer: LexerTreeBuilder, sheetId?: string, action?: AxisAction): void {
  const names = new Map(Object.entries(book.sheets).map(([id, sheet]) => [sheet.name!.toLowerCase(), id]));
  const changed = sheetId ? book.sheets[sheetId] : undefined, map = action && changed ? projection(action, changed.rowCount!, changed.columnCount!) : undefined;
  let work = 0, formulas = 0;
  for (const [id, sheet] of Object.entries(book.sheets)) for (const [row, cells] of Object.entries(sheet.cellData ?? {})) for (const [column, raw] of Object.entries(cells ?? {})) {
    const cell = raw as ICellData | null | undefined; if (!cell?.f) continue;
    if (action && id === sheetId && !action.insert) { const position = Number(action.axis === 'row' ? row : column); if (position >= action.start && position < action.start + action.count) continue; }
    if (++formulas > 10_000) throw new Error('This worksheet exceeds its structural formula limit.');
    const nodes = lexer.sequenceNodesBuilder(cell.f); let rows = 1, columns = 1;
    assertWorkbookStructuralScalarTokens(cell.f, nodes, {
      types: sequenceNodeType,
      hasExecutor: name => ALL_IMPLEMENTED_FUNCTIONS_SET.has(name as IFunctionNames),
      isLiteral: token => ['TRUE', 'FALSE'].includes(token.toUpperCase()) || ERROR_TYPE_SET.has(token as ErrorType),
      referenceShape: token => {
        const ref = deserializeRangeWithSheet(token), targetId = ref.sheetName ? names.get(ref.sheetName.toLowerCase()) : id, target = targetId ? book.sheets[targetId] : undefined;
        if (ref.unitId || !target) throw new Error('This formula reference is unavailable.');
        const range = { ...ref.range };
        if (range.rangeType === RANGE_TYPE.ROW || range.rangeType === RANGE_TYPE.COLUMN || range.rangeType === RANGE_TYPE.ALL) return 'whole-axis';
        if (action && map && targetId === sheetId) {
          const result = action.axis === 'row' ? map.interval(range.startRow, range.endRow) : map.interval(range.startColumn, range.endColumn);
          if (!result) return 'single'; // the source writer emits a genuine #REF!, not a neighboring reference
          if (action.axis === 'row') [range.startRow, range.endRow] = result; else [range.startColumn, range.endColumn] = result;
        }
        const height = target.rowCount! + (targetId === sheetId && action?.axis === 'row' ? action.count * (action.insert ? 1 : -1) : 0), width = target.columnCount! + (targetId === sheetId && action?.axis === 'column' ? action.count * (action.insert ? 1 : -1) : 0);
        if (![range.startRow, range.endRow, range.startColumn, range.endColumn].every(Number.isSafeInteger) || range.startRow < 0 || range.startColumn < 0 || range.endRow < range.startRow || range.endColumn < range.startColumn || range.endRow >= height || range.endColumn >= width) throw new Error('This formula exceeds the editable worksheet window.');
        rows = Math.max(rows, range.endRow - range.startRow + 1); columns = Math.max(columns, range.endColumn - range.startColumn + 1);
        return range.startRow === range.endRow && range.startColumn === range.endColumn ? 'single' : 'range';
      },
    });
    work += rows * columns * ((nodes?.length ?? 0) + 1); if (!Number.isSafeInteger(work) || work > 1_000_000) throw new Error('This change exceeds the worksheet calculation limit.');
  }
}

export function workbookStructureController(univer: Univer, api: FUniver, source: () => WorkbookStructureSource | null, scope: () => WorkbookStructureScope | null) {
  const lexer = new LexerTreeBuilder(), commands = univer.__getInjector().get(ICommandService); let active = true;
  function selected() {
    const owner = scope(), currentSource = source(), book = api.getActiveWorkbook(), sheet = book?.getActiveSheet(), selection = sheet?.getSelection();
    if (!active || !owner || owner.blocked || !currentSource?.model.worksheetStructureEditable || !book?.getWorkbookPermission().canEdit() || !sheet || !selection || selection.getActiveRangeList().length !== 1) return null;
    const range = selection.getActiveRange()?.getRange(); if (!range) return null;
    const snapshot = book.save(), current = snapshot.sheets[sheet.getSheetId()];
    if (!current || current.hidden === 1 || current.hidden === 2 || ![range.startRow, range.endRow, range.startColumn, range.endColumn].every(Number.isSafeInteger) || range.startRow < 0 || range.startColumn < 0 || range.endRow < range.startRow || range.endColumn < range.startColumn || range.endRow >= current.rowCount! || range.endColumn >= current.columnCount!) return null;
    workbookGridEdits(currentSource.model, currentSource.sourceSha256, currentSource.acknowledged, snapshot);
    const key = JSON.stringify([owner.projectId, owner.controllerId, currentSource.sourceSha256, snapshot.id, sheet.getSheetId(), range.startRow, range.endRow, range.startColumn, range.endColumn, current.rowCount, current.columnCount]);
    return { book, sheet, snapshot, current, range, key };
  }
  function admit(value: NonNullable<ReturnType<typeof selected>>, actionId: WorkbookStructureAction): AxisAction {
    const action = axisAction(actionId, value.range, value.current.rowCount!, value.current.columnCount!);
    assertWorkbookCalculationMutation({ id: action.axis === 'row' ? action.insert ? 'sheet.mutation.insert-row' : 'sheet.mutation.remove-rows' : action.insert ? 'sheet.mutation.insert-col' : 'sheet.mutation.remove-col', params: { unitId: value.snapshot.id, subUnitId: value.sheet.getSheetId(), range: action.range } }, [value.snapshot], 'range');
    if (!action.insert) for (const merge of value.current.mergeData ?? []) {
      const start = action.axis === 'row' ? merge.startRow : merge.startColumn, end = action.axis === 'row' ? merge.endRow : merge.endColumn;
      if (action.start <= start && action.start + action.count > start && action.start + action.count <= end) throw new Error('Keep the merged cell anchor when deleting part of its range.');
    }
    scalarAdmission(value.snapshot, lexer, value.sheet.getSheetId(), action); return action;
  }
  return {
    read(): WorkbookStructureSelection | null {
      try {
        const value = selected(); if (!value) return null; scalarAdmission(value.snapshot, lexer);
        const allowed: WorkbookStructureSelection['allowed'] = {};
        for (const action of workbookStructureActions) { try { admit(value, action); allowed[action] = true; } catch { allowed[action] = false; } }
        return { key: value.key, sheetId: value.sheet.getSheetId(), range: value.range, rowCount: value.current.rowCount!, columnCount: value.current.columnCount!, axis: value.range.rangeType === RANGE_TYPE.ROW ? 'row' : value.range.rangeType === RANGE_TYPE.COLUMN ? 'column' : 'both', allowed };
      } catch { return null; }
    },
    run(actionId: WorkbookStructureAction, selectionKey: string): void {
      if (!workbookStructureActions.includes(actionId)) throw new Error('That worksheet action is unavailable.');
      const value = selected(); if (!value || value.key !== selectionKey) throw new Error('Select the worksheet cells again before changing rows or columns.');
      scalarAdmission(value.snapshot, lexer); const action = admit(value, actionId);
      const changed = commands.syncExecuteCommand(action.command, { unitId: value.snapshot.id, subUnitId: value.sheet.getSheetId(), range: action.range, ...(action.direction === undefined ? {} : { direction: action.direction }) });
      if (!changed) throw new Error('The worksheet could not be changed.');
      const currentSource = source(); if (!currentSource) throw new Error('The worksheet source is unavailable.');
      workbookGridEdits(currentSource.model, currentSource.sourceSha256, currentSource.acknowledged, value.book.save());
    },
    dispose() { active = false; lexer.dispose(); },
  };
}
export type WorkbookStructureController = ReturnType<typeof workbookStructureController>;
