import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { restoreWorkbookSelection } from '../../src/components/embedded/workbook/grid-selection';
import { workbookRecoveryFixture } from '../helpers/workbook-recovery-fixture';

const require = createRequire(realpathSync(fileURLToPath(new URL('../../node_modules/@univerjs/preset-sheets-core/package.json', import.meta.url))));
const { Univer } = require('@univerjs/core') as typeof import('@univerjs/presets');
const { FUniver } = require('@univerjs/core/facade') as typeof import('@univerjs/presets');
const { UniverSheetsPlugin } = require('@univerjs/sheets') as typeof import('@univerjs/preset-sheets-core');
require('@univerjs/sheets/facade');
const closing: (() => void)[] = [];
afterEach(() => { for (const close of closing.splice(0)) close(); });
function fixture() {
  const univer = new Univer(); closing.push(() => univer.dispose()); univer.registerPlugin(UniverSheetsPlugin);
  const data = workbookRecoveryFixture('66a28381-a8cf-40cd-91d2-b1f9cd696ac0', 'Forecast.xlsx').acknowledged;
  const book = FUniver.newAPI(univer).createWorkbook(data);
  return { book, sheet: book.getActiveSheet() };
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
