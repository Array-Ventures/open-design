import { expect, it } from 'vitest';
import { CellValueType, type IWorkbookData } from '@univerjs/presets';
import type { WorkbookDocument } from '@open-design/contracts/runtime/workbook';
import { csvPasteCells } from '../../src/components/embedded/workbook/csv-literal-input';
import { csvGridEdits } from '../../src/components/embedded/workbook/csv-grid-edits';
import { gridWorkbook } from '../../src/components/embedded/workbook/grid-model';
const model: WorkbookDocument = { version: 1, sourceFormat: 'csv', date1904: false, activeSheetId: 'csv', styles: [{ numberFormat: '@' }], features: { charts: 0, drawings: 0, externalLinks: 0, macros: false, signed: false }, sheets: [{ id: 'csv', name: 'Data', visibility: 'visible', rowCount: 2, columnCount: 2, cells: [{ row: 0, column: 0, kind: 'string', value: '001', style: 0 }, { row: 0, column: 1, kind: 'string', value: '', style: 0 }, { row: 1, column: 0, kind: 'string', value: 'tail', style: 0 }], merges: [], rowDimensions: [], columnDimensions: [], frozenRows: 0, frozenColumns: 0 }] };
it('keeps dimension changes view-only while producing a legitimate literal edit', () => {
  const initial = gridWorkbook(model, 'csv-grid', 'CSV').data as IWorkbookData, current = structuredClone(initial);
  current.sheets.csv!.rowData = { 0: { h: 40 } };
  expect(csvGridEdits(model, 'a'.repeat(64), initial, current)).toEqual({ sourceSha256: 'a'.repeat(64), edits: [] });
  current.sheets.csv!.cellData![0]![0] = { v: '002', t: CellValueType.FORCE_STRING, s: '0' };
  expect(csvGridEdits(model, 'a'.repeat(64), initial, current)).toEqual({ sourceSha256: 'a'.repeat(64), edits: [{ sheetId: 'csv', cell: { row: 0, column: 0, kind: 'string', value: '002', style: 0 } }] });
});
it('refuses typed formulas and formatting rather than dropping a change', () => {
  const initial = gridWorkbook(model, 'csv-grid', 'CSV').data as IWorkbookData;
  for (const value of [{ v: 2, t: CellValueType.NUMBER }, { f: '=1+1' }, { v: '001', s: { bl: 1 } }]) {
    const current = structuredClone(initial); current.sheets.csv!.cellData![0]![0] = value;
    expect(() => csvGridEdits(model, 'a'.repeat(64), initial, current)).toThrow();
  }
});
it('parses bounded quoted TSV paste as literal text while retaining embedded newlines and a ragged final row', () => {
  const cells = csvPasteCells('"001\nline"\t"=sum(a1)"\r\n雪', model, 0, 0);
  expect(cells.map(row => row.map(cell => cell.v))).toEqual([['001\nline', '=sum(a1)'], ['雪']]);
  expect(cells.flat().every(cell => cell.t === CellValueType.FORCE_STRING && !cell.f && !cell.p)).toBe(true);
  for (const text of ['too\tmany\tcolumns', 'a\tb\nc\td', '"unterminated', 'x'.repeat(32768)]) expect(() => csvPasteCells(text, model, 0, 0)).toThrow();
});
