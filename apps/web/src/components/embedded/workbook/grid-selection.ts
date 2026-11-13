import { RANGE_TYPE } from '@univerjs/core';
import type { FUniver, IRange } from '@univerjs/presets';

type Workbook = NonNullable<ReturnType<FUniver['getActiveWorkbook']>>;
type Worksheet = ReturnType<Workbook['getActiveSheet']>;

/** Rebind geometry to the fresh worksheet, retaining whole-axis semantics.
 * A soft preview can shrink its unmaterialized extent after an ACK; only an
 * explicitly whole-axis selection may normalize that extent and clamp its
 * selected rows/columns. Explicit SDK rangeType owns this view intent: old
 * axis bounds are unavailable, so a shorter old extent can also grow here.
 * This grants no source or mutation authority. Ordinary cells must fit exactly. */
export function restoreWorkbookSelection(sheet: Worksheet, range?: IRange): boolean {
  if (!range) return false;
  let { startRow, endRow, startColumn, endColumn } = range;
  const kind = range.rangeType;
  if (![startRow, endRow, startColumn, endColumn].every(Number.isSafeInteger)
    || startRow < 0 || startColumn < 0 || endRow < startRow || endColumn < startColumn
    || kind !== undefined && ![RANGE_TYPE.NORMAL, RANGE_TYPE.ROW, RANGE_TYPE.COLUMN, RANGE_TYPE.ALL].includes(kind)) return false;
  const wholeRows = kind === RANGE_TYPE.ROW || kind === RANGE_TYPE.ALL;
  const wholeColumns = kind === RANGE_TYPE.COLUMN || kind === RANGE_TYPE.ALL;
  if (wholeRows && startColumn !== 0 || wholeColumns && startRow !== 0) return false;
  if (wholeRows) { startColumn = 0; endColumn = sheet.getMaxColumns() - 1; endRow = Math.min(endRow, sheet.getMaxRows() - 1); }
  if (wholeColumns) { startRow = 0; endRow = sheet.getMaxRows() - 1; endColumn = Math.min(endColumn, sheet.getMaxColumns() - 1); }
  if (endRow < startRow || endColumn < startColumn || endRow >= sheet.getMaxRows() || endColumn >= sheet.getMaxColumns()) return false;
  const scoped = sheet.getRange(startRow, startColumn, endRow - startRow + 1, endColumn - startColumn + 1);
  sheet.setActiveRange(kind === undefined ? scoped : sheet.getRange({ ...scoped.getRange(), rangeType: kind }));
  return true;
}
