import type { WorkbookArrayFormula, WorkbookSheet } from '@open-design/contracts/runtime/workbook';

/** Missing metadata from an older pin is unknown, not proof of no arrays. */
export function sourceArrayOwnershipKnown(sheet: Pick<WorkbookSheet, 'arrayFormulas'>): boolean {
  return sheet.arrayFormulas !== undefined;
}

/** Ownership comes only from validated source metadata. A numeric value, blank
 * or missing formula on a follower is never evidence that it is derived. */
export function sourceArrayOwner(sheet: Pick<WorkbookSheet, 'arrayFormulas'>, row: number, column: number): WorkbookArrayFormula | undefined {
  return sheet.arrayFormulas?.find(({ range }) => row >= range.startRow && row <= range.endRow && column >= range.startColumn && column <= range.endColumn);
}

/** Source caches are retained values, not newly calculated outputs. This does
 * not grant permission to edit an array member or bypass writer refusals. */
export function sourceArrayCachedCells(sheet: Pick<WorkbookSheet, 'arrayFormulas' | 'cells'>, array: WorkbookArrayFormula) {
  if (!sheet.arrayFormulas?.includes(array)) return [];
  return structuredClone(sheet.cells.filter(cell => sourceArrayOwner(sheet, cell.row, cell.column) === array));
}
