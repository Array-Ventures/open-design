import { expect, it } from 'vitest';
import ExcelJS from 'exceljs-community';
import JSZip from 'jszip';
import { DOMParser, XMLSerializer, type Element } from '@xmldom/xmldom';
import { readXlsxWorkbook } from '../../src/artifacts/workbook/reader.js';
import { patchWorkbookCells } from '../../src/artifacts/workbook/cell-patch.js';
import { patchWorkbookStyles } from '../../src/artifacts/workbook/style-patch.js';
const main = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main', future = 'urn:evebot:row-extension-fixture';
const sheetPart = 'xl/worksheets/sheet1.xml';
async function fixture() {
  const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('Inputs');
  sheet.getCell('A1').value = 1; sheet.getCell('C1').value = 3; sheet.getCell('A2').value = 7; sheet.getCell('C2').value = 9; sheet.getRow(1).height = 24;
  const zip = await JSZip.loadAsync(await book.xlsx.writeBuffer());
  zip.file('[Content_Types].xml', (await zip.file('[Content_Types].xml')!.async('string')).replace('</Types>', '<Override PartName="/customXml/row-preservation.xml" ContentType="application/xml"/></Types>'));
  zip.file('customXml/row-preservation.xml', '<opaque xmlns="urn:evebot:opaque">unchanged bytes</opaque>');
  const document = new DOMParser().parseFromString(await zip.file(sheetPart)!.async('string'), 'text/xml');
  for (const row of Array.from(document.getElementsByTagNameNS(main, 'row'))) {
    row.setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns:future', future); row.setAttributeNS(future, 'future:flag', `keep-${row.getAttribute('r')}`);
    const list = document.createElementNS(main, 'extLst'), ext = document.createElementNS(main, 'ext'), payload = document.createElementNS(future, 'future:payload');
    ext.setAttribute('uri', `{row-${row.getAttribute('r')}}`); payload.setAttribute('value', 'opaque & "retained"'); payload.appendChild(document.createTextNode('unknown row metadata')); ext.appendChild(payload); list.appendChild(ext); row.appendChild(list);
  }
  zip.file(sheetPart, new XMLSerializer().serializeToString(document));
  return readXlsxWorkbook(await zip.generateAsync({ type: 'nodebuffer' }));
}
async function assertPreserved(source: Awaited<ReturnType<typeof fixture>>, bytes: Buffer, expectedCells: string[][], styleChange = false) {
  const zip = await JSZip.loadAsync(bytes), xml = await zip.file(sheetPart)!.async('string');
  const parsed = new DOMParser().parseFromString(xml, 'text/xml'), old = new DOMParser().parseFromString(source.parts.get(sheetPart)!.toString(), 'text/xml');
  const rows = Array.from(parsed.getElementsByTagNameNS(main, 'row')), before = Array.from(old.getElementsByTagNameNS(main, 'row'));
  expect(rows).toHaveLength(2);
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index]!, elements = Array.from(row.childNodes).filter((node): node is Element => node.nodeType === 1);
    expect(elements.map(node => node.localName)).toEqual([...expectedCells[index]!.map(() => 'c'), 'extLst']);
    expect(elements.filter(node => node.localName === 'c').map(node => (node as Element).getAttribute('r'))).toEqual(expectedCells[index]);
    expect(row.getAttributeNS(future, 'flag')).toBe(`keep-${index + 1}`);
    const serializer = new XMLSerializer();
    expect(serializer.serializeToString(row.getElementsByTagNameNS(main, 'extLst')[0]!)).toBe(serializer.serializeToString(before[index]!.getElementsByTagNameNS(main, 'extLst')[0]!));
  }
  expect(rows[0]!.getAttribute('ht')).toBe(before[0]!.getAttribute('ht'));
  for (const [name, original] of source.parts) if (name !== sheetPart && !(styleChange && name === 'xl/styles.xml') && !(!styleChange && name === 'xl/workbook.xml')) expect(await zip.file(name)!.async('nodebuffer')).toEqual(original);
  // ExcelJS stops reading later rows after unknown row extensions. Independently
  // reopen with our reader too, so later source values cannot disappear unnoticed.
  const read = await readXlsxWorkbook(bytes);
  expect(read.model.sheets[0]!.cells.find(cell => cell.row === 1 && cell.column === 0)?.value).toBe(7);
  expect(read.model.sheets[0]!.cells.find(cell => cell.row === 1 && cell.column === 2)?.value).toBe(9);
  const reopened = new ExcelJS.Workbook(); await reopened.xlsx.load(Uint8Array.from(bytes).buffer); return reopened;
}
it('keeps row extension nodes last during a scalar edit, including untouched rows in the same sheet', async () => {
  const source = await fixture(), original = new Map(source.parts);
  const bytes = await patchWorkbookCells(source, [{ sheetId: '1', cell: { row: 0, column: 0, kind: 'number', value: 8 } }]);
  const reopened = await assertPreserved(source, bytes, [['A1', 'C1'], ['A2', 'C2']]);
  expect(reopened.getWorksheet('Inputs')!.getCell('A1').value).toBe(8); expect((await readXlsxWorkbook(bytes)).model.sheets[0]!.cells.find(cell => cell.row === 1 && cell.column === 2)?.value).toBe(9); expect(source.parts).toEqual(original);
});
it('inserts a new scalar cell in column order before the opaque row extension', async () => {
  const source = await fixture();
  const bytes = await patchWorkbookCells(source, [{ sheetId: '1', cell: { row: 0, column: 1, kind: 'string', value: 'new middle' } }]);
  const reopened = await assertPreserved(source, bytes, [['A1', 'B1', 'C1'], ['A2', 'C2']]);
  expect(reopened.getWorksheet('Inputs')!.getCell('B1').value).toBe('new middle'); expect(reopened.getWorksheet('Inputs')!.getCell('C1').value).toBe(3);
});
it('styles an absent blank field without moving or changing any row extension metadata', async () => {
  const source = await fixture();
  const bytes = await patchWorkbookStyles(source, [{ sheetId: '1', row: 0, column: 1, bold: true }]);
  const reopened = await assertPreserved(source, bytes, [['A1', 'B1', 'C1'], ['A2', 'C2']], true);
  expect(reopened.getWorksheet('Inputs')!.getCell('B1').value).toBeNull(); expect(reopened.getWorksheet('Inputs')!.getCell('B1').font.bold).toBe(true);
});
