import { expect, it } from 'vitest';
import type { IWorkbookData } from '@univerjs/core';
import type { WorkbookDocument } from '@open-design/contracts/runtime/workbook';
import { workbookLiveCalculationEligible } from '../../src/components/embedded/workbook/grid-calculation';
const model: WorkbookDocument = { version: 1, date1904: false, activeSheetId: 's', styles: [{}], features: { charts: 0, drawings: 0, externalLinks: 0, macros: false, signed: false }, sheets: [{ id: 's', name: 'Inputs', rowCount: 100, columnCount: 20, visibility: 'visible', cells: [], merges: [], frozenRows: 0, frozenColumns: 0, rowDimensions: [], columnDimensions: [], arrayFormulas: [] }] };
const book = { id: 'bounded', name: 'Bounded', appVersion: '1.4.0', locale: 'enUS', styles: {}, sheetOrder: ['s'], sheets: { s: { id: 's', name: 'Inputs', rowCount: 100, columnCount: 20, cellData: {} } } } as IWorkbookData;
it('enters live mode only with bounded geometry and proven absence of source array ownership', () => {
  expect(workbookLiveCalculationEligible(model, book)).toBe(true);
  expect(workbookLiveCalculationEligible({ ...model, sheets: [{ ...model.sheets[0]!, arrayFormulas: undefined }] }, book)).toBe(false);
  expect(workbookLiveCalculationEligible({ ...model, sheets: [{ ...model.sheets[0]!, arrayFormulas: [{ kind: 'array', row: 0, column: 0, range: { startRow: 0, endRow: 2, startColumn: 0, endColumn: 0 } }] }] }, book)).toBe(false);
  expect(workbookLiveCalculationEligible(model, { ...book, sheets: { s: { ...book.sheets.s!, rowCount: 100_000 } } })).toBe(false);
  expect(workbookLiveCalculationEligible(model, { ...book, sheets: { s: { ...book.sheets.s!, cellData: { 0: { 0: { si: 'shared' } } } } } })).toBe(false);
});
