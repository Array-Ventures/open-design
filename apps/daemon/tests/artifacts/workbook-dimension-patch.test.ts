import { expect, it } from 'vitest';
import ExcelJS from 'exceljs-community';
import JSZip from 'jszip';
import { readXlsxWorkbook } from '../../src/artifacts/workbook/reader.js';
import { patchWorkbookDimensions } from '../../src/artifacts/workbook/dimension-patch.js';
import { calculateWorkbookCellEdits } from '../../src/artifacts/workbook/calculated-patch.js';
import { readWorkbookPackage } from '../../src/artifacts/workbook/package.js';
async function fixture() {
  const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('Forecast');
  sheet.getCell('A1').value = 2; sheet.getCell('B1').value = { formula: 'A1*2', result: 4 };
  sheet.getColumn(2).width = 14; sheet.getColumn(3).width = 14; sheet.getRow(2).height = 24;
  const zip = await JSZip.loadAsync(await book.xlsx.writeBuffer());
  const part = 'xl/worksheets/sheet1.xml';
  const xml = await zip.file(part)!.async('string');
  zip.file(part, xml.replace('<col min="2" max="3"', '<col min="2" max="3" outlineLevel="2"'));
  zip.file('custom/opaque.bin', Buffer.from([1, 2, 255]));
  return readXlsxWorkbook(await zip.generateAsync({ type: 'nodebuffer' }));
}
it('resizes rows and splits column ranges while retaining formulas, metadata and every untouched package part', async () => {
  const source = await fixture();
  const bytes = await patchWorkbookDimensions(source, [{ sheetId: '1', axis: 'row', index: 1, size: 36 }, { sheetId: '1', axis: 'column', index: 1, size: 25 }]);
  const reopened = await readXlsxWorkbook(bytes), sheet = reopened.model.sheets[0]!;
  expect(sheet.rowDimensions.find(row => row.index === 1)?.height).toBe(36);
  expect(sheet.columnDimensions.find(col => col.index === 1)?.width).toBe(25); expect(sheet.columnDimensions.find(col => col.index === 2)?.width).toBe(14);
  expect(sheet.cells).toEqual(source.model.sheets[0]!.cells);
  for (const [name, data] of source.parts) if (name !== 'xl/worksheets/sheet1.xml') expect(reopened.parts.get(name), name).toEqual(data);
  expect(reopened.parts.get('xl/worksheets/sheet1.xml')!.toString()).toContain('outlineLevel="2"');
  const book = new ExcelJS.Workbook(); await book.xlsx.load(Uint8Array.from(bytes).buffer); expect(book.worksheets[0]!.getColumn(2).width).toBe(25); expect(book.worksheets[0]!.getRow(2).height).toBe(36);
});
it('adds blank row dimensions in order and supports hiding and unhiding without changing cell values', async () => {
  const source = await fixture(); const bytes = await patchWorkbookDimensions(source, [{ sheetId: '1', axis: 'row', index: 10, size: 30, hidden: true }, { sheetId: '1', axis: 'column', index: 0, hidden: true }]);
  const model = (await readXlsxWorkbook(bytes)).model;
  expect(model.sheets[0]!.rowDimensions.find(row => row.index === 10)).toMatchObject({ height: 30, hidden: true });
  const shown = await readXlsxWorkbook(await patchWorkbookDimensions(await readXlsxWorkbook(bytes), [{ sheetId: '1', axis: 'row', index: 10, hidden: false }]));
  expect(shown.model.sheets[0]!.rowDimensions.find(row => row.index === 10)?.hidden).not.toBe(true);
});
it('combines a resized column with recalculated scalar edits', async () => {
  const source = await fixture(), prepared = await calculateWorkbookCellEdits(source, [{ sheetId: '1', cell: { row: 0, column: 0, kind: 'number', value: 7 } }], [{ sheetId: '1', axis: 'column', index: 1, size: 25 }]);
  expect(prepared.model.sheets[0]!.cells.find(cell => cell.column === 1 && cell.row === 0)?.value).toBe(14);
  expect(prepared.model.sheets[0]!.columnDimensions.find(col => col.index === 1)?.width).toBe(25);
});
it('rejects duplicate, out-of-bounds, invalid and protected dimension edits', async () => {
  const source = await fixture(), edit = { sheetId: '1', axis: 'row' as const, index: 1, size: 30 };
  for (const edits of [[edit, edit], [{ ...edit, index: 1048576 }], [{ ...edit, size: Infinity }], [{ ...edit, sheetId: 'missing' }]]) await expect(patchWorkbookDimensions(source, edits)).rejects.toThrow();
  const parts = new Map(source.parts); parts.set('xl/worksheets/sheet1.xml', Buffer.from(parts.get('xl/worksheets/sheet1.xml')!.toString().replace('</worksheet>', '<sheetProtection sheet="1"/></worksheet>')));
  await expect(patchWorkbookDimensions({ ...source, parts }, [edit])).rejects.toMatchObject({ code: 'WORKBOOK_UNSUPPORTED' });
  expect((await readWorkbookPackage(await patchWorkbookDimensions(source, []))).get('xl/worksheets/sheet1.xml')).toEqual(source.parts.get('xl/worksheets/sheet1.xml'));
});
