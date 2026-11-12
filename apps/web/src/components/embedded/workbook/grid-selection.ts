import type { FUniver, IRange } from '@univerjs/presets';

type Workbook = NonNullable<ReturnType<FUniver['getActiveWorkbook']>>;
type Worksheet = ReturnType<Workbook['getActiveSheet']>;

/** Selection snapshots can omit unit/sheet identities, or retain old ones.
 * The numeric overload binds geometry to the new live worksheet explicitly. */
export function restoreWorkbookSelection(sheet: Worksheet, range?: IRange): boolean {
  if (!range) return false;
  const { startRow, endRow, startColumn, endColumn } = range;
  if (![startRow, endRow, startColumn, endColumn].every(Number.isSafeInteger)
    || startRow < 0 || startColumn < 0 || endRow < startRow || endColumn < startColumn
    || endRow >= sheet.getMaxRows() || endColumn >= sheet.getMaxColumns()) return false;
  sheet.setActiveRange(sheet.getRange(startRow, startColumn, endRow - startRow + 1, endColumn - startColumn + 1));
  return true;
}
