import type { ICellData, IWorkbookData } from '@univerjs/presets';
import { WORKBOOK_MODEL_LIMITS } from '@open-design/contracts/runtime/workbook';

export class WorkbookCalculationBudgetError extends Error {}
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
        if (!Number.isSafeInteger(row) || !Number.isSafeInteger(column) || row < 0 || column < 0 || row >= rows || column >= columns || ++cells > WORKBOOK_MODEL_LIMITS.cells) throw new WorkbookCalculationBudgetError('Workbook calculation contains out-of-bounds cells.');
        if (cell != null) {
          if (typeof cell !== 'object' || Array.isArray(cell)) throw new WorkbookCalculationBudgetError('Workbook calculation cells are malformed.');
          const data = cell as ICellData; text += typeof data.v === 'string' ? data.v.length : 0; text += typeof data.f === 'string' ? data.f.length : 0;
        }
        if (text > WORKBOOK_MODEL_LIMITS.text) throw new WorkbookCalculationBudgetError('Workbook calculation text exceeds its limit.');
      }
    }
  }
}
export interface WorkbookCalculationMutation {
  id: string; params?: unknown;
}
/** Only the pinned scalar/range mutation is admitted as a sheet write in this
 * calculation replica. Structural commands must not grow its registered bounds
 * through paste, insertion, count changes or a future unreviewed mutation. */
export function assertWorkbookCalculationMutation(command: WorkbookCalculationMutation, books: readonly IWorkbookData[], rangeMutationId: string): void {
  assertWorkbookCalculationBudget(books);
  if (!command.id.startsWith('sheet.mutation.')) return;
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
    if (!Number.isSafeInteger(row) || row < 0 || row >= (sheet.rowCount ?? 0) || !entries || typeof entries !== 'object' || Array.isArray(entries)) throw new WorkbookCalculationBudgetError('Workbook calculation mutation exceeds its registered bounds.');
    for (const columnText of Object.keys(entries)) {
      const column = Number(columnText);
      if (!Number.isSafeInteger(column) || column < 0 || column >= (sheet.columnCount ?? 0) || ++count > WORKBOOK_MODEL_LIMITS.cells) throw new WorkbookCalculationBudgetError('Workbook calculation mutation exceeds its registered bounds.');
    }
  }
}
