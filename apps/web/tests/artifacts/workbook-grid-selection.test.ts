import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import { restoreWorkbookSelection } from '../../src/components/embedded/workbook/grid-selection';
import { workbookRecoveryFixture } from '../helpers/workbook-recovery-fixture';

const require = createRequire(realpathSync(fileURLToPath(new URL('../../node_modules/@univerjs/preset-sheets-core/package.json', import.meta.url))));
const { RANGE_TYPE } = require('@univerjs/core') as typeof import('@univerjs/presets');
const { Univer } = require('@univerjs/core') as typeof import('@univerjs/presets');
const { FUniver } = require('@univerjs/core/facade') as typeof import('@univerjs/presets');
const { UniverSheetsPlugin, SetSelectionsOperation } = require('@univerjs/sheets') as typeof import('@univerjs/preset-sheets-core');
require('@univerjs/sheets/facade');
const closing: (() => void)[] = [];
afterEach(() => { for (const close of closing.splice(0)) close(); });
function fixture() {
  const univer = new Univer(); closing.push(() => univer.dispose()); univer.registerPlugin(UniverSheetsPlugin);
  const data = workbookRecoveryFixture('66a28381-a8cf-40cd-91d2-b1f9cd696ac0', 'Forecast.xlsx').acknowledged;
  const api = FUniver.newAPI(univer), book = api.createWorkbook(data);
  return { api, book, sheet: book.getActiveSheet() };
}
it('reproduces the pinned unscoped-range failure and restores geometry in the live sheet', () => {
  const { book, sheet } = fixture(), range = { startRow: 1, endRow: 2, startColumn: 1, endColumn: 3 };
  expect(() => sheet.setActiveRange(sheet.getRange(range))).toThrow('Specified range must be part of the sheet');
  expect(restoreWorkbookSelection(sheet, range)).toBe(true);
  expect(book.getActiveRange()?.getRange()).toMatchObject({ ...range, unitId: book.getId(), sheetId: sheet.getSheetId() });
});
it('does not carry old unit or sheet identities into the new grid', () => {
  const { book, sheet } = fixture();
  const old = { startRow: 0, endRow: 0, startColumn: 2, endColumn: 2, unitId: 'retired', sheetId: 'removed' };
  expect(restoreWorkbookSelection(sheet, old)).toBe(true);
  expect(book.getActiveRange()?.getRange()).toMatchObject({ startColumn: 2, endColumn: 2, unitId: book.getId(), sheetId: sheet.getSheetId() });
});
it('leaves the current grid usable when the old selection no longer fits', () => {
  const { sheet } = fixture();
  for (const range of [undefined, { startRow: -1, endRow: 1, startColumn: 0, endColumn: 0 }, { startRow: 2, endRow: 1, startColumn: 0, endColumn: 0 }, { startRow: 0, endRow: sheet.getMaxRows(), startColumn: 0, endColumn: 0 }, { startRow: 0, endRow: 0, startColumn: 0.5, endColumn: 1 }]) expect(restoreWorkbookSelection(sheet, range)).toBe(false);
});

it('reports settled programmatic selection through command completion rather than pointer move-end', () => {
  const { api, book, sheet } = fixture(), pointer = vi.fn(), completed: unknown[] = [];
  sheet.setActiveRange(sheet.getRange(0, 2));
  const selection = book.onSelectionChange(pointer), command = api.addEvent(api.Event.CommandExecuted, event => {
    if (event.id === SetSelectionsOperation.id) completed.push(book.getActiveRange()?.getRange());
  });
  pointer.mockClear(); // discard the observable's immediate initial value
  try {
    sheet.setActiveSelection(sheet.getRange(0, 0));
    expect(pointer).not.toHaveBeenCalled();
    expect(completed).toEqual([expect.objectContaining({ startRow: 0, endRow: 0, startColumn: 0, endColumn: 0, unitId: book.getId(), sheetId: sheet.getSheetId() })]);
  } finally { command.dispose(); selection.dispose(); }
});

it.each(['ROW', 'COLUMN', 'ALL'] as const)('retains fresh-scoped whole-axis selection semantics: %s', kind => {
  const { book, sheet } = fixture();
  const range = { startRow: kind === 'ROW' ? 1 : 0, endRow: kind === 'ROW' ? 2 : sheet.getMaxRows() - 1,
    startColumn: kind === 'COLUMN' ? 1 : 0, endColumn: kind === 'COLUMN' ? 2 : sheet.getMaxColumns() - 1,
    rangeType: RANGE_TYPE[kind], unitId: 'old-unit', sheetId: 'old-sheet' };
  expect(restoreWorkbookSelection(sheet, range)).toBe(true);
  expect(book.getActiveRange()?.getRange()).toMatchObject({ ...range, unitId: book.getId(), sheetId: sheet.getSheetId() });
});
it('normalizes whole-axis extents after soft-preview shrink and clamps only the selected axis', () => {
  const { book, sheet } = fixture();
  const column = { startRow: 0, endRow: sheet.getMaxRows(), startColumn: 1, endColumn: sheet.getMaxColumns(), rangeType: RANGE_TYPE.COLUMN };
  expect(restoreWorkbookSelection(sheet, column)).toBe(true);
  expect(book.getActiveRange()?.getRange()).toMatchObject({ ...column, endRow: sheet.getMaxRows() - 1, endColumn: sheet.getMaxColumns() - 1 });
  const row = { startRow: 1, endRow: sheet.getMaxRows(), startColumn: 0, endColumn: sheet.getMaxColumns(), rangeType: RANGE_TYPE.ROW };
  expect(restoreWorkbookSelection(sheet, row)).toBe(true);
  expect(book.getActiveRange()?.getRange()).toMatchObject({ ...row, endRow: sheet.getMaxRows() - 1, endColumn: sheet.getMaxColumns() - 1 });
  expect(restoreWorkbookSelection(sheet, { ...column, rangeType: RANGE_TYPE.ALL, startColumn: 0 })).toBe(true);
  expect(book.getActiveRange()?.getRange()).toMatchObject({ rangeType: RANGE_TYPE.ALL, startRow: 0, startColumn: 0, endRow: sheet.getMaxRows() - 1, endColumn: sheet.getMaxColumns() - 1 });
});
it('retains explicit whole-axis intent when the fresh view has grown', () => {
  const { book, sheet } = fixture();
  expect(restoreWorkbookSelection(sheet, { startRow: 0, endRow: 2, startColumn: 1, endColumn: 1, rangeType: RANGE_TYPE.COLUMN })).toBe(true);
  expect(book.getActiveRange()?.getRange()).toMatchObject({ startRow: 0, endRow: sheet.getMaxRows() - 1, startColumn: 1, endColumn: 1, rangeType: RANGE_TYPE.COLUMN });
  expect(restoreWorkbookSelection(sheet, { startRow: 1, endRow: 1, startColumn: 0, endColumn: 2, rangeType: RANGE_TYPE.ROW })).toBe(true);
  expect(book.getActiveRange()?.getRange()).toMatchObject({ startColumn: 0, endColumn: sheet.getMaxColumns() - 1, startRow: 1, endRow: 1, rangeType: RANGE_TYPE.ROW });
});
it('refuses malformed whole-axis geometry and unknown range kinds without changing selection', () => {
  const { book, sheet } = fixture();
  sheet.setActiveRange(sheet.getRange(0, 0)); const before = book.getActiveRange()?.getRange();
  const base = { startRow: 0, endRow: 2, startColumn: 0, endColumn: 2 };
  const malformed = [
    { ...base, rangeType: 99 },
    { ...base, rangeType: RANGE_TYPE.COLUMN, startRow: 1 },
    { ...base, rangeType: RANGE_TYPE.ROW, startColumn: 1 },
    { ...base, rangeType: RANGE_TYPE.ALL, startRow: 1 },
    { ...base, rangeType: RANGE_TYPE.COLUMN, startColumn: sheet.getMaxColumns(), endColumn: sheet.getMaxColumns() },
    { ...base, rangeType: RANGE_TYPE.ROW, startRow: -1 },
    { ...base, rangeType: RANGE_TYPE.COLUMN, endRow: NaN },
  ];
  for (const range of malformed) expect(restoreWorkbookSelection(sheet, range)).toBe(false);
  expect(book.getActiveRange()?.getRange()).toEqual(before);
});
