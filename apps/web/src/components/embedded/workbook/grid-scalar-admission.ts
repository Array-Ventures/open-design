import type { ICellData, IWorkbookData } from '@univerjs/core';
import { RANGE_TYPE } from '@univerjs/core';
import { ALL_IMPLEMENTED_FUNCTIONS_SET, ERROR_TYPE_SET, type ErrorType, type IFunctionNames, LexerTreeBuilder, deserializeRangeWithSheet, sequenceNodeType } from '@univerjs/engine-formula';
import { assertWorkbookStructuralScalarTokens } from '@open-design/contracts/runtime/workbook-formula-policy';
import { workbookAxisProjection } from '@open-design/contracts/runtime/workbook-structure';
interface ScalarAxisAction { axis: 'row' | 'column'; insert: boolean; start: number; count: number }
function projection(action: ScalarAxisAction, rows: number, columns: number) {
  const count = action.axis === 'row' ? rows : columns;
  const origins = Array.from({ length: action.insert ? count + action.count : count - action.count }, (_, index) => action.insert ? index < action.start ? index : index < action.start + action.count ? null : index - action.count : index < action.start ? index : index + action.count);
  return workbookAxisProjection(count, origins, action.axis === 'row' ? 1048576 : 16384);
}
/** Check current and prospective scalar references through the actual pinned
 * lexer. This is admission only; source XML and calculation revalidate on save. */
export function scalarAdmission(book: IWorkbookData, lexer: LexerTreeBuilder, sheetId?: string, action?: ScalarAxisAction): void {
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

export function assertWorkbookScalarSnapshot(book: IWorkbookData): void {
  const lexer = new LexerTreeBuilder();
  try { scalarAdmission(book, lexer); } finally { lexer.dispose(); }
}
