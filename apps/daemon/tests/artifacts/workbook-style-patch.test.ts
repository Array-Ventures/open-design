import { expect, it } from 'vitest';
import ExcelJS from 'exceljs-community';
import JSZip from 'jszip';
import { readXlsxWorkbook } from '../../src/artifacts/workbook/reader.js';
import { calculateWorkbookCellEdits } from '../../src/artifacts/workbook/calculated-patch.js';
import { patchWorkbookStyles } from '../../src/artifacts/workbook/style-patch.js';
import { child, children, xmlPart } from '../../src/artifacts/workbook/parts.js';
async function fixture() {
  const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('Styled');
  sheet.getCell('A1').value = 2;
  sheet.getCell('B1').value = { formula: '[other.xlsx]Sheet1!A1', result: 71 };
  sheet.getCell('A1').font = { name: 'Arial', size: 14, color: { theme: 4 }, italic: true };
  sheet.getCell('A1').alignment = { horizontal: 'right', wrapText: true };
  sheet.getCell('A1').numFmt = '$0.00';
  sheet.getCell('C1').value = { richText: [{ text: 'Rich', font: { bold: true } }] };
  sheet.getColumn(4).font = { name: 'Courier New', italic: true };
  const zip = await JSZip.loadAsync(await book.xlsx.writeBuffer());
  zip.file('custom/opaque.bin', Buffer.from([1, 2, 255]));
  return readXlsxWorkbook(await zip.generateAsync({ type: 'nodebuffer' }));
}
it('patches real style components and retains formulas, caches, rich strings and opaque parts', async () => {
  const source = await fixture();
  const prepared = await calculateWorkbookCellEdits(source, [], [], [{ sheetId: '1', row: 0, column: 0, bold: true, italic: false, fontColor: 'FF123456', fillColor: 'FFABCDEF' }]);
  const reopened = await readXlsxWorkbook(prepared.bytes), cell = reopened.model.sheets[0]!.cells.find(c => c.row === 0 && c.column === 0)!;
  expect(reopened.model.styles[cell.style!]?.font?.italic).not.toBe(true);
  expect(reopened.model.styles[cell.style!]).toMatchObject({ font: { name: 'Arial', size: 14, bold: true, color: { kind: 'rgb', argb: 'FF123456' } }, alignment: { horizontal: 'right', wrap: true }, numberFormat: '$0.00', fill: { pattern: 'solid', foreground: { kind: 'rgb', argb: 'FFABCDEF' } } });
  for (const [part, bytes] of source.parts) if (!['xl/styles.xml', 'xl/worksheets/sheet1.xml'].includes(part)) expect(reopened.parts.get(part), part).toEqual(bytes);
  const originalXml = xmlPart(source.parts, 'xl/worksheets/sheet1.xml'), outputXml = xmlPart(reopened.parts, 'xl/worksheets/sheet1.xml');
  const originalCells = children(child(originalXml.documentElement!, 'sheetData')!.getElementsByTagName('row')[0]!, 'c');
  const outputCells = children(child(outputXml.documentElement!, 'sheetData')!.getElementsByTagName('row')[0]!, 'c');
  expect(outputCells.slice(1).map(c => c.toString())).toEqual(originalCells.slice(1).map(c => c.toString()));
  const independent = new ExcelJS.Workbook(); await independent.xlsx.load(Uint8Array.from(prepared.bytes).buffer);
  expect(independent.worksheets[0]!.getCell('A1').font).toMatchObject({ bold: true, name: 'Arial', color: { argb: 'FF123456' } });
  expect(independent.worksheets[0]!.getCell('A1').font.italic).not.toBe(true);
  expect(independent.worksheets[0]!.getCell('B1').result).toBe(71);
});
it('deduplicates identical edits and repeated saves; inherits a column font for a new blank cell', async () => {
  const source = await fixture(), edit = { sheetId: '1', row: 4, column: 3, bold: true };
  const first = await readXlsxWorkbook(await patchWorkbookStyles(source, [edit]));
  const second = await readXlsxWorkbook(await patchWorkbookStyles(first, [edit]));
  expect(second.parts.get('xl/styles.xml')).toEqual(first.parts.get('xl/styles.xml'));
  expect(second.parts.get('xl/worksheets/sheet1.xml')).toEqual(first.parts.get('xl/worksheets/sheet1.xml'));
  const cell = second.model.sheets[0]!.cells.find(c => c.row === 4 && c.column === 3)!;
  expect(second.model.styles[cell.style!]?.font).toMatchObject({ name: 'Courier New', italic: true, bold: true });
  await expect(patchWorkbookStyles(source, [edit, edit])).rejects.toThrow('Duplicate');
  await expect(patchWorkbookStyles(source, [{ ...edit, row: 1048576 }])).rejects.toThrow();
  await expect(patchWorkbookStyles({ ...source, model: { ...source.model, features: { ...source.model.features, signed: true } } }, [edit])).rejects.toThrow('signatures');
});
it('imports authored Normal as deduplicated style zero for omitted cells and defaults', async () => {
  const source = await fixture(), styles = xmlPart(source.parts, 'xl/styles.xml');
  const normal = children(child(styles.documentElement!, 'fonts')!, 'font')[0]!;
  const name = child(normal, 'name')!; name.setAttribute('val', 'Aptos');
  const parts = new Map(source.parts); parts.set('xl/styles.xml', Buffer.from(styles.toString()));
  const { writeWorkbookPackage } = await import('../../src/artifacts/workbook/package.js');
  const reopened = await readXlsxWorkbook(await writeWorkbookPackage(parts));
  expect(reopened.model.styles[0]?.font?.name).toBe('Aptos');
  expect(reopened.model.sheets[0]!.cells.find(c => c.column === 1)?.style).toBeUndefined();
});
