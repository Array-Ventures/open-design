import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import ExcelJS from 'exceljs-community';
import { renderWorkbook } from '../../src/embedded-render/workbooks.js';
import { selectedWorksheetCsv } from '../../src/artifacts/workbook/selected-sheet-csv.js';
import { readXlsxWorkbook } from '../../src/artifacts/workbook/reader.js';
let directory: string | undefined;
afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }); directory = undefined; });
async function fixture() {
  const book = new ExcelJS.Workbook(); book.addWorksheet('First').getCell('A1').value = 'WRONG SHEET';
  const sheet = book.addWorksheet('Chosen');
  sheet.addRow(['a,b', 'a"b', 'line\nbreak', '00017', '=literal']);
  sheet.addRow([true, false, 1.25, { formula: '1+1', result: 123 }, { error: '#N/A' }]);
  sheet.getCell('B4').value = { richText: [{ text: 'rich ' }, { text: '雪😀', font: { bold: true } }] };
  const hidden = book.addWorksheet('Hidden'); hidden.state = 'hidden'; hidden.getCell('A1').value = 'Hidden';
  const bytes = Buffer.from(await book.xlsx.writeBuffer());
  const model = (await readXlsxWorkbook(bytes)).model;
  return { bytes, model, digest: createHash('sha256').update(bytes).digest('hex') };
}
it('exports exact UTF-8 RFC4180 values from the explicit second sheet, preserving saved formula caches and source bytes', async () => {
  const { bytes, digest } = await fixture(), before = Buffer.from(bytes);
  directory = await mkdtemp(path.join(tmpdir(), 'selected-sheet-csv-'));
  const result = await renderWorkbook(directory, { fileName: 'book.xlsx', format: 'csv', sheetId: '2', workbookSourceSha256: digest }, async name => { expect(name).toBe('book.xlsx'); return bytes; });
  expect(result).toEqual({ file: 'artifact.csv', mime: 'text/csv' });
  expect(await readFile(path.join(directory, result.file))).toEqual(Buffer.from('"a,b","a""b","line\nbreak",00017,=literal\r\nTRUE,FALSE,1.25,123,#N/A\r\n,,,,\r\n,rich 雪😀,,,\r\n'));
  expect(bytes).toEqual(before);
  const reopened = (await readXlsxWorkbook(bytes)).model;
  expect(reopened.sheets[1]!.cells.find(cell => cell.formula)).toMatchObject({ value: 123, formula: '=1+1' });
});
it('refuses absent, foreign, hidden or path-shaped worksheet identities and changed source hashes without output', async () => {
  const { bytes, digest } = await fixture(); directory = await mkdtemp(path.join(tmpdir(), 'selected-sheet-csv-'));
  for (const sheetId of [undefined, 'missing', '3', '../sheet1.xml']) await expect(renderWorkbook(directory, { fileName: 'book.xlsx', format: 'csv', ...(sheetId ? { sheetId } : {}), workbookSourceSha256: digest }, async () => bytes)).rejects.toThrow();
  await expect(renderWorkbook(directory, { fileName: 'book.xlsx', format: 'csv', sheetId: '2', workbookSourceSha256: '0'.repeat(64) }, async () => bytes)).rejects.toThrow('Choose the worksheet');
  expect(await readdir(directory)).toEqual([]);
});
it('refuses uncached formulas and bounded sparse expansion instead of inventing values', async () => {
  const { model } = await fixture(); const sheet = model.sheets[1]!;
  sheet.cells.push({ row: 4, column: 0, kind: 'blank', value: null, formula: '=UNKNOWN()' });
  expect(() => selectedWorksheetCsv(model, '2')).toThrow('no saved result');
  sheet.cells.pop(); sheet.cells.push({ row: 1_000_000, column: 1, kind: 'string', value: 'far' });
  expect(() => selectedWorksheetCsv(model, '2')).toThrow('field limit');
});
it('exports a genuinely empty visible worksheet as empty CSV without guessing another sheet', async () => {
  const { model } = await fixture(); model.sheets[1]!.cells = [];
  expect(selectedWorksheetCsv(model, '2')).toEqual(Buffer.alloc(0));
});
