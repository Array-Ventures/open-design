import { membershipMutationIds, type WorkbookMembershipPermit } from './sheet-calculation-permit';
import { assertWorkbookStructureIdentity, hasWorkbookStructureIdentity } from './grid-structure-identity';
import { WORKBOOK_STRUCTURE_AXIS_BUDGET } from '@open-design/contracts/runtime/workbook-structure';
import { assertWorkbookVisibilityMutation, WORKSHEET_VISIBILITY_MUTATION } from './grid-visibility-policy';
import type { ICellData, IWorkbookData } from '@univerjs/presets';
import { workbookSourceSheetProjectionSchema, WORKBOOK_MODEL_LIMITS } from '@open-design/contracts/runtime/workbook';

export class WorkbookCalculationBudgetError extends Error {}
// These pinned layout-only mutations cannot insert cells or change registered
// geometry. They preserve calculation admission when a person resizes a row.
const layoutMutations = new Set(['sheet.mutation.set-worksheet-col-width', 'sheet.mutation.set-worksheet-row-height', 'sheet.mutation.set-worksheet-row-auto-height', 'sheet.mutation.set-worksheet-row-is-auto-height']);
/** A browser worker is separately disposable, not an OS memory sandbox. Keep
 * its admitted geometry bounded before execution; the owning UI also enforces
 * a wall-clock deadline and terminates a failed worker. */
export function assertWorkbookCalculationBudget(books: readonly IWorkbookData[], inspectCells = false): void {
  if (books.length > 1) throw new WorkbookCalculationBudgetError('Live calculation supports one workbook per worker.');
  let area = 0, cells = 0, text = 0;
  for (const book of books) {
    const sheets = Object.values(book.sheets);
    if (sheets.length > WORKBOOK_MODEL_LIMITS.sheets) throw new WorkbookCalculationBudgetError('Workbook calculation exceeds its worksheet limit.');
    for (const sheet of sheets) {
      const rows = sheet.rowCount, columns = sheet.columnCount;
      if (typeof rows !== 'number' || typeof columns !== 'number' || !Number.isSafeInteger(rows) || !Number.isSafeInteger(columns) || rows < 1 || columns < 1 || rows > WORKBOOK_MODEL_LIMITS.rows || columns > WORKBOOK_MODEL_LIMITS.columns) throw new WorkbookCalculationBudgetError('Workbook calculation dimensions are invalid.');
      area += rows * columns;
      if (!Number.isSafeInteger(area) || area > WORKBOOK_MODEL_LIMITS.cells) throw new WorkbookCalculationBudgetError('This workbook needs a larger isolated calculation budget. Its stored results are preserved.');
      if (!inspectCells) continue;
      for (const [rowText, entries] of Object.entries(sheet.cellData ?? {})) for (const [columnText, cell] of Object.entries(entries ?? {})) {
        const row = Number(rowText), column = Number(columnText);
        if (!/^(0|[1-9][0-9]*)$/.test(rowText) || !/^(0|[1-9][0-9]*)$/.test(columnText) || !Number.isSafeInteger(row) || !Number.isSafeInteger(column) || row < 0 || column < 0 || row >= rows || column >= columns || ++cells > WORKBOOK_MODEL_LIMITS.cells) throw new WorkbookCalculationBudgetError('Workbook calculation contains out-of-bounds cells.');
        if (cell != null) {
          if (typeof cell !== 'object' || Array.isArray(cell)) throw new WorkbookCalculationBudgetError('Workbook calculation cells are malformed.');
          const data = cell as ICellData;
          if (data.si) throw new WorkbookCalculationBudgetError('Shared formula edits require a separate calculation adapter.');
          text += typeof data.v === 'string' ? data.v.length : 0; text += typeof data.f === 'string' ? data.f.length : 0; text += data.p ? JSON.stringify(data.p).length : 0;
        }
        if (text > WORKBOOK_MODEL_LIMITS.text) throw new WorkbookCalculationBudgetError('Workbook calculation text exceeds its limit.');
      }
    }
  }
}
const structuralMutations = new Map<string, { axis: 'row' | 'column'; insert: boolean }>([
  ['sheet.mutation.insert-row', { axis: 'row', insert: true }],
  ['sheet.mutation.insert-col', { axis: 'column', insert: true }],
  ['sheet.mutation.remove-rows', { axis: 'row', insert: false }],
  ['sheet.mutation.remove-col', { axis: 'column', insert: false }],
]);
export function isWorkbookCalculationStructuralMutation(id: string): boolean { return structuralMutations.has(id); }
/** Source-qualified editor ownership is required in addition to bounded geometry.
 * The prospective check runs before the SDK allocates or shifts any cells. */
function assertStructuralMutation(command: WorkbookCalculationMutation, books: readonly IWorkbookData[]): void {
  const shape = structuralMutations.get(command.id)!;
  const params = command.params as { unitId?: string; subUnitId?: string; range?: { startRow?: number; endRow?: number; startColumn?: number; endColumn?: number } } | undefined;
  const book = books.length === 1 ? books[0] : undefined;
  if (!book || !hasWorkbookStructureIdentity(book)) throw new WorkbookCalculationBudgetError('Structural workbook changes need a separate calculation adapter.');
  try { assertWorkbookStructureIdentity(book); } catch { throw new WorkbookCalculationBudgetError('Structural workbook ownership is invalid.'); }
  const sheet = params?.subUnitId ? book.sheets[params.subUnitId] : undefined, range = params?.range;
  if (!params || params.unitId !== book.id || !sheet || !range) throw new WorkbookCalculationBudgetError('Structural workbook mutation identity is unavailable.');
  const rows = sheet.rowCount!, columns = sheet.columnCount!;
  const start = shape.axis === 'row' ? range.startRow : range.startColumn, end = shape.axis === 'row' ? range.endRow : range.endColumn;
  const otherStart = shape.axis === 'row' ? range.startColumn : range.startRow, otherEnd = shape.axis === 'row' ? range.endColumn : range.endRow;
  const count = shape.axis === 'row' ? rows : columns, otherCount = shape.axis === 'row' ? columns : rows;
  if (![start, end, otherStart, otherEnd].every(Number.isSafeInteger) || start! < 0 || end! < start! || start! > count || !shape.insert && end! >= count || otherStart !== 0 || otherEnd !== otherCount - 1) throw new WorkbookCalculationBudgetError('Structural workbook range exceeds its registered bounds.');
  const delta = (end! - start! + 1) * (shape.insert ? 1 : -1), next = count + delta;
  const axes = Object.values(book.sheets).reduce((sum, item) => sum + item.rowCount! + item.columnCount!, delta);
  const area = Object.values(book.sheets).reduce((sum, item) => sum + item.rowCount! * item.columnCount!, delta * otherCount);
  if (!Number.isSafeInteger(next) || next < 1 || next > (shape.axis === 'row' ? WORKBOOK_MODEL_LIMITS.rows : WORKBOOK_MODEL_LIMITS.columns) || !Number.isSafeInteger(axes) || axes > WORKBOOK_STRUCTURE_AXIS_BUDGET || !Number.isSafeInteger(area) || area > WORKBOOK_MODEL_LIMITS.cells) throw new WorkbookCalculationBudgetError('Structural workbook changes exceed their calculation budget.');
}
export interface WorkbookCalculationMutation {
  id: string; params?: unknown;
}
/** Scalar/range writes stay within registered geometry. Only four pinned axis
 * mutations may change it, for source-qualified identity-stamped workbooks and
 * within prospective area/axis budgets; unknown geometry mutations fail closed. */
export function assertWorkbookCalculationMutation(command: WorkbookCalculationMutation, books: readonly IWorkbookData[], rangeMutationId: string, membership?: WorkbookMembershipPermit): void {
  assertWorkbookCalculationBudget(books);
  if (membershipMutationIds.has(command.id)) { assertMembershipMutation(command, books, membership); return; }
  if (isWorkbookCalculationStructuralMutation(command.id)) { assertStructuralMutation(command, books); return; }
  if (command.id === WORKSHEET_VISIBILITY_MUTATION) {
    if (books.length !== 1) throw new WorkbookCalculationBudgetError('Workbook visibility identity is unavailable.');
    assertWorkbookVisibilityMutation(command.params, books[0]!); return;
  }
  if (!command.id.startsWith('sheet.mutation.') || layoutMutations.has(command.id)) return;
  if (command.id !== rangeMutationId) throw new WorkbookCalculationBudgetError('Structural workbook changes need a separate calculation adapter.');
  const params = command.params as { unitId?: unknown; subUnitId?: unknown; cellValue?: unknown } | undefined;
  if (!params || typeof params.unitId !== 'string' || typeof params.subUnitId !== 'string') throw new WorkbookCalculationBudgetError('Workbook calculation mutation identity is unavailable.');
  const book = books.find(book => book.id === params.unitId), sheet = book?.sheets[params.subUnitId];
  if (!sheet) throw new WorkbookCalculationBudgetError('Workbook calculation mutation belongs to another worksheet.');
  if (params.cellValue == null) return;
  if (typeof params.cellValue !== 'object' || Array.isArray(params.cellValue)) throw new WorkbookCalculationBudgetError('Workbook calculation values are malformed.');
  let count = 0;
  for (const [rowText, entries] of Object.entries(params.cellValue)) {
    const row = Number(rowText);
    if (!/^(0|[1-9][0-9]*)$/.test(rowText) || !Number.isSafeInteger(row) || row < 0 || row >= (sheet.rowCount ?? 0) || !entries || typeof entries !== 'object' || Array.isArray(entries)) throw new WorkbookCalculationBudgetError('Workbook calculation mutation exceeds its registered bounds.');
    for (const columnText of Object.keys(entries)) {
      const column = Number(columnText);
      const cell = (entries as Record<string, ICellData | null>)[columnText];
      if (cell?.si) throw new WorkbookCalculationBudgetError('Shared formula edits require a separate calculation adapter.');
      if (!/^(0|[1-9][0-9]*)$/.test(columnText) || !Number.isSafeInteger(column) || column < 0 || column >= (sheet.columnCount ?? 0) || ++count > WORKBOOK_MODEL_LIMITS.cells) throw new WorkbookCalculationBudgetError('Workbook calculation mutation exceeds its registered bounds.');
    }
  }
}

/** A private main-owner permit is still subject to independent prospective
 * replica geometry/identity admission before either SDK allocates anything. */
function assertMembershipMutation(command: WorkbookCalculationMutation, books: readonly IWorkbookData[], permit: WorkbookMembershipPermit | undefined): void {
  projectWorkbookCalculationInputs(command, books[0], permit);
}

/** Replica-only prospective input view. It never selects source parts or grants
 * template/native authority; both budget owners use the same mutation semantics. */
export function projectWorkbookCalculationInputs(command: WorkbookCalculationMutation, input: IWorkbookData | undefined, permit: WorkbookMembershipPermit | undefined): IWorkbookData {
  const books = input ? [input] : [];
  const book = books.length === 1 ? books[0] : undefined;
  const params = command.params as { unitId?: string; subUnitId?: string; subUnitName?: string; index?: number; sheet?: IWorkbookData['sheets'][string]; name?: string; oldName?: string; trigger?: string } | undefined;
  if (!permit || !book || params?.unitId !== book.id || permit.unitId !== book.id) throw new WorkbookCalculationBudgetError('Worksheet calculation has no protected kernel permit.');
  assertWorkbookStructureIdentity(book);
  const keys = Object.keys(params).filter(key => key !== 'trigger');
  let sheets = book.sheets, order = book.sheetOrder;
  if (command.id === 'sheet.mutation.set-range-values') {
    assertWorkbookCalculationMutation(command, books, command.id);
    const range = command.params as { subUnitId: string; cellValue: Record<string, Record<string, ICellData | null>> };
    const sheet = sheets[range.subUnitId]!;
    const data = { ...sheet.cellData };
    for (const [row, columns] of Object.entries(range.cellValue)) {
      const entries = data[Number(row)] = { ...data[Number(row)] };
      for (const [column, patch] of Object.entries(columns)) {
        if (patch === null) delete entries[Number(column)];
        else {
          const cell = entries[Number(column)] = { ...entries[Number(column)], ...patch };
          for (const key of Object.keys(cell) as (keyof ICellData)[]) if (cell[key] === null) delete cell[key];
        }
      }
    }
    sheets = { ...sheets, [range.subUnitId]: { ...sheet, cellData: data } };
  } else if (command.id === 'sheet.mutation.insert-sheet') {
    const sheet = params.sheet;
    if (keys.some(key => !['unitId', 'index', 'sheet'].includes(key)) || !sheet || typeof sheet.id !== 'string' || Object.hasOwn(sheets, sheet.id)
      || !Number.isSafeInteger(params.index) || params.index! < 0 || params.index! > order.length) throw new WorkbookCalculationBudgetError('Worksheet insertion identity is invalid.');
    sheets = { ...sheets, [sheet.id]: sheet }; order = [...order]; order.splice(params.index!, 0, sheet.id);
  } else if (command.id === 'sheet.mutation.remove-sheet') {
    const sheet = params.subUnitId ? sheets[params.subUnitId] : undefined;
    if (keys.some(key => !['unitId', 'subUnitId', 'subUnitName'].includes(key)) || !sheet || typeof sheet.id !== 'string' || params.subUnitName !== sheet.name) throw new WorkbookCalculationBudgetError('Worksheet removal identity is invalid.');
    sheets = { ...sheets }; delete sheets[sheet.id]; order = order.filter(id => id !== sheet.id);
  } else {
    const sheet = params.subUnitId ? sheets[params.subUnitId] : undefined;
    if (keys.some(key => !['unitId', 'subUnitId', 'name', 'oldName'].includes(key)) || !sheet || typeof sheet.id !== 'string' || params.oldName !== sheet.name || typeof params.name !== 'string') throw new WorkbookCalculationBudgetError('Worksheet rename identity is invalid.');
    sheets = { ...sheets, [sheet.id]: { ...sheet, name: params.name } };
  }
  const prospective = { ...book, sheets, sheetOrder: order };
  workbookSourceSheetProjectionSchema.parse(order.map(sheetId => ({ sheetId, name: sheets[sheetId]!.name, origin: 'source' })));
  if (!order.some(id => !sheets[id]!.hidden)) throw new WorkbookCalculationBudgetError('Keep at least one worksheet visible.');
  assertWorkbookCalculationBudget([prospective], true);
  assertWorkbookStructureIdentity(prospective);
  return prospective;
}
