import { expect, it } from 'vitest';
import ExcelJS from 'exceljs-community';
import JSZip from 'jszip';
import { readXlsxWorkbook } from '../../src/artifacts/workbook/reader.js';
import { calculateWorkbookCellEdits } from '../../src/artifacts/workbook/calculated-patch.js';

async function fixture(formula = 'SEQUENCE(3,1,A1)') {
  const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('Inputs');
  sheet.getCell('A1').value = 10;
  sheet.getCell('D3').value = { formula, result: 10 };
  sheet.getCell('D4').value = 11; sheet.getCell('D5').value = 12;
  sheet.getCell('D4').font = { italic: true };
  const summary = book.addWorksheet('Summary');
  summary.getCell('A1').value = { formula: 'Inputs!D4+100', result: 111 };
  const zip = await JSZip.loadAsync(await book.xlsx.writeBuffer());
  const path = 'xl/worksheets/sheet1.xml';
  zip.file(path, (await zip.file(path)!.async('string')).replace('<f>', '<f t="array" ref="D3:D5" aca="1">'));
  return readXlsxWorkbook(await zip.generateAsync({ type: 'nodebuffer' }));
}
it('recalculates a fixed array and its cross-sheet follower consumer from server input', async () => {
  const source = await fixture();
  const { bytes } = await calculateWorkbookCellEdits(source, [{ sheetId: '1', cell: { row: 0, column: 0, kind: 'number', value: 20 } }]);
  const book = new ExcelJS.Workbook(); await book.xlsx.load(Uint8Array.from(bytes).buffer);
  expect(book.worksheets[0]!.getCell('D3').result).toBe(20);
  expect(book.worksheets[0]!.getCell('D4').value).toBe(21);
  expect(book.worksheets[0]!.getCell('D5').value).toBe(22);
  expect(book.worksheets[1]!.getCell('A1').result).toBe(121);
  expect(book.worksheets[0]!.getCell('D4').font.italic).toBe(true);
  const zip = await JSZip.loadAsync(bytes);
  expect(await zip.file('xl/worksheets/sheet1.xml')!.async('string')).toContain('<f t="array" ref="D3:D5" aca="1">SEQUENCE(3,1,A1)</f>');
});
it('preserves unsupported source owners, every follower and masked cross-sheet dependent while independent formulas calculate', async () => {
  const source = await fixture('MISSING(A1)');
  const { bytes } = await calculateWorkbookCellEdits(source, [{ sheetId: '1', cell: { row: 0, column: 0, kind: 'number', value: 30 } }]);
  const book = new ExcelJS.Workbook(); await book.xlsx.load(Uint8Array.from(bytes).buffer);
  expect(book.worksheets[0]!.getCell('D3').result).toBe(10);
  expect(book.worksheets[0]!.getCell('D4').value).toBe(11);
  expect(book.worksheets[1]!.getCell('A1').result).toBe(111);
});
it('distinguishes an error-looking string, boolean and real error in calculated array caches', async () => {
  const source = await fixture('IF(SEQUENCE(3)=1,"#N/A",IF(SEQUENCE(3)=2,TRUE,NA()))');
  const { bytes } = await calculateWorkbookCellEdits(source, [{ sheetId: '1', cell: { row: 0, column: 0, kind: 'number', value: 20 } }]);
  const reopened = await readXlsxWorkbook(bytes), cells = reopened.model.sheets[0]!.cells;
  expect(cells.find(cell => cell.row === 2 && cell.column === 3)).toMatchObject({ kind: 'string', value: '#N/A' });
  expect(cells.find(cell => cell.row === 3 && cell.column === 3)).toMatchObject({ kind: 'boolean', value: true });
  expect(cells.find(cell => cell.row === 4 && cell.column === 3)).toMatchObject({ kind: 'error', value: '#N/A' });
});
it('creates absent physical follower caches without treating missing source values as user inputs', async () => {
  const initial = await fixture(), zip = new JSZip();
  for (const [name, bytes] of initial.parts) zip.file(name, bytes);
  const path = 'xl/worksheets/sheet1.xml';
  zip.file(path, (await zip.file(path)!.async('string')).replace(/<c r="D5"[^>]*>.*?<\/c>/, ''));
  const source = await readXlsxWorkbook(await zip.generateAsync({ type: 'nodebuffer' }));
  const { bytes } = await calculateWorkbookCellEdits(source, [{ sheetId: '1', cell: { row: 0, column: 0, kind: 'number', value: 40 } }]);
  const book = new ExcelJS.Workbook(); await book.xlsx.load(Uint8Array.from(bytes).buffer);
  expect(book.worksheets[0]!.getCell('D5').value).toBe(42);
});
it('refuses fixed-range resizing and follower edits without changing source parts', async () => {
  const source = await fixture('SEQUENCE(A1)'), before = new Map(source.parts);
  await expect(calculateWorkbookCellEdits(source, [{ sheetId: '1', cell: { row: 0, column: 0, kind: 'number', value: 4 } }])).rejects.toMatchObject({ code: 'WORKBOOK_UNSUPPORTED' });
  await expect(calculateWorkbookCellEdits(source, [{ sheetId: '1', cell: { row: 3, column: 3, kind: 'number', value: 444, style: 1 } }])).rejects.toMatchObject({ code: 'WORKBOOK_UNSUPPORTED' });
  expect(source.parts).toEqual(before);
});
