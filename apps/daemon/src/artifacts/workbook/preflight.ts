import type { Element } from '@xmldom/xmldom';
import { WORKBOOK_MODEL_LIMITS } from '@open-design/contracts/runtime/workbook';
import { address, child, children, range } from './parts.js';
import { WorkbookFormatError } from './package.js';
import { readArrayFormulaMetadata } from './array-metadata.js';

export interface WorkbookImportBudget { cells: number; rows: number; mergedCells: number; arrayCells?: number }
function index(value: string | null): number {
  if (!value || !/^[0-9]+$/.test(value)) throw new WorkbookFormatError('Invalid worksheet index.');
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new WorkbookFormatError('Invalid worksheet index.');
  return result;
}
/** Check constructs that an importer may expand before giving it the package.
 * A tiny merge reference can otherwise ask it to allocate billions of cells. */
export function preflightWorksheet(root: Element, budget: WorkbookImportBudget): void {
  const data = child(root, 'sheetData');
  const rows = new Set<number>();
  let previousRow = -1;
  for (const row of data ? children(data, 'row') : []) {
    const rowIndex = row.hasAttribute('r') ? index(row.getAttribute('r')) - 1 : previousRow + 1;
    previousRow = rowIndex;
    if (rowIndex < 0 || rowIndex >= WORKBOOK_MODEL_LIMITS.rows || rows.has(rowIndex)) throw new WorkbookFormatError('Invalid or duplicate worksheet row.');
    rows.add(rowIndex);
    if (++budget.rows > WORKBOOK_MODEL_LIMITS.cells) throw new WorkbookFormatError('Workbook row records exceed the import limit.', 'WORKBOOK_LIMIT');
    const positions = new Set<number>();
    let previousColumn = -1;
    for (const cell of children(row, 'c')) {
      const position = cell.hasAttribute('r') ? address(cell.getAttribute('r')!) : { row: rowIndex, column: previousColumn + 1 };
      previousColumn = position.column;
      if (position.row !== rowIndex || position.column >= WORKBOOK_MODEL_LIMITS.columns || positions.has(position.column)) throw new WorkbookFormatError('Invalid or duplicate worksheet cell.');
      positions.add(position.column);
      if (++budget.cells > WORKBOOK_MODEL_LIMITS.cells) throw new WorkbookFormatError('Workbook cell count exceeds the import limit.', 'WORKBOOK_LIMIT');
      const array = readArrayFormulaMetadata(child(cell, 'f'), position);
      if (array) {
        budget.arrayCells = (budget.arrayCells ?? 0) + (array.range.endRow - array.range.startRow + 1) * (array.range.endColumn - array.range.startColumn + 1);
        if (budget.arrayCells > WORKBOOK_MODEL_LIMITS.cells) throw new WorkbookFormatError('Array formula ranges exceed the import limit.', 'WORKBOOK_LIMIT');
      }
    }
  }
  const columns = child(root, 'cols');
  const occupiedColumns = new Set<number>();
  for (const column of columns ? children(columns, 'col') : []) {
    const min = index(column.getAttribute('min')), max = index(column.getAttribute('max'));
    if (min < 1 || max < min || max > WORKBOOK_MODEL_LIMITS.columns) throw new WorkbookFormatError('Invalid worksheet column range.');
    for (let index = min; index <= max; index++) {
      if (occupiedColumns.has(index)) throw new WorkbookFormatError('Overlapping worksheet column ranges are not supported.', 'WORKBOOK_UNSUPPORTED');
      occupiedColumns.add(index);
    }
  }
  const merges = child(root, 'mergeCells');
  const ranges = merges ? children(merges, 'mergeCell') : [];
  if (ranges.length > 4096) throw new WorkbookFormatError('Workbook merge count exceeds the import limit.', 'WORKBOOK_LIMIT');
  for (const merge of ranges) {
    const bounds = range(merge.getAttribute('ref') ?? '');
    if (bounds.endRow < bounds.startRow || bounds.endColumn < bounds.startColumn) throw new WorkbookFormatError('Invalid worksheet merge.');
    budget.mergedCells += (bounds.endRow - bounds.startRow + 1) * (bounds.endColumn - bounds.startColumn + 1);
    if (budget.mergedCells > WORKBOOK_MODEL_LIMITS.cells) throw new WorkbookFormatError('Expanded workbook merges exceed the import limit.', 'WORKBOOK_LIMIT');
  }
}
