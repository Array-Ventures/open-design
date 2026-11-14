import { expect, it } from 'vitest';
import ExcelJS from 'exceljs-community';
import { readXlsxWorkbook } from '../../src/artifacts/workbook/reader.js';
import { readWorkbookPackage, writeWorkbookPackage } from '../../src/artifacts/workbook/package.js';
import { parseWorkbookXml, writeWorkbookXml } from '../../src/artifacts/workbook/xml.js';
import { MAIN_NAMESPACES } from '../../src/artifacts/workbook/parts.js';
import type { Element } from '@xmldom/xmldom';

async function fixture() {
  const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('Inputs');
  sheet.getCell('A1').value = 12;
  sheet.getCell('A1').font = { bold: true, size: 22.25 };
  sheet.getCell('A1').numFmt = '0.00';
  sheet.getCell('A2').value = 3;
  sheet.fillFormula('B1:B2', 'A1*2', [24, 6]);
  sheet.getCell('C1').value = { richText: [{ text: ' α ', font: { bold: true } }, { text: '😀', font: { italic: true } }] };
  sheet.getCell('C2').value = sheet.getCell('C1').value;
  const parts = new Map(await readWorkbookPackage(Buffer.from(await book.xlsx.writeBuffer({ useSharedStrings: true }))));
  const document = parseWorkbookXml(parts.get('xl/worksheets/sheet1.xml')!);
  document.documentElement!.setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns:x14ac', 'http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac');
  document.documentElement!.setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns:mc', 'http://schemas.openxmlformats.org/markup-compatibility/2006');
  document.documentElement!.setAttributeNS('http://schemas.openxmlformats.org/markup-compatibility/2006', 'mc:Ignorable', 'x14ac');
  parts.set('xl/worksheets/sheet1.xml', writeWorkbookXml(document));
  parts.set('custom/opaque.bin', Buffer.from([0, 255, 1]));
  return writeWorkbookPackage(parts);
}

function alias(bytes: Buffer): Buffer {
  const document = parseWorkbookXml(bytes);
  function replace(element: Element): Element {
    const result = document.createElementNS(element.namespaceURI, MAIN_NAMESPACES.has(element.namespaceURI ?? '') ? `ss:${element.localName}` : element.tagName);
    for (const attribute of Array.from(element.attributes)) {
      const relationship = attribute.namespaceURI === 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
      result.setAttributeNS(attribute.namespaceURI, relationship ? `link:${attribute.localName}` : attribute.name, attribute.value);
      if (relationship) result.setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns:link', attribute.namespaceURI!);
    }
    for (const node of Array.from(element.childNodes)) result.appendChild(node.nodeType === 1 ? replace(node as Element) : node.cloneNode(true));
    return result;
  }
  document.replaceChild(replace(document.documentElement!), document.documentElement!);
  document.documentElement!.setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns:ss', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main');
  // Keep QName-valued compatibility tokens valid; renaming element prefixes
  // does not rename the x14ac token inside mc:Ignorable.
  return writeWorkbookXml(document);
}

it('reads valid aliased workbook, sheets, styles and shared strings exactly like their default namespace source', async () => {
  const bytes = await fixture(), canonical = await readXlsxWorkbook(bytes), parts = new Map(canonical.parts);
  for (const name of ['xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/styles.xml', 'xl/sharedStrings.xml']) parts.set(name, alias(parts.get(name)!));
  const prefixed = await readXlsxWorkbook(await writeWorkbookPackage(parts));
  expect(prefixed.model).toEqual(canonical.model);
  expect(prefixed.parts).toEqual(parts);
});

it('patches the original aliased sheet while preserving unrelated bytes and independently readable cell/style ownership', async () => {
  const { patchWorkbookCells } = await import('../../src/artifacts/workbook/cell-patch.js');
  const { spawnSync } = await import('node:child_process');
  const parts = new Map(await readWorkbookPackage(await fixture()));
  for (const name of ['xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/styles.xml', 'xl/sharedStrings.xml']) parts.set(name, alias(parts.get(name)!));
  const source = await readXlsxWorkbook(await writeWorkbookPackage(parts));
  const cell = source.model.sheets[0]!.cells.find(cell => cell.row === 0 && cell.column === 0)!;
  const output = await patchWorkbookCells(source, [{ sheetId: '1', cell: { ...cell, kind: 'number', value: 19 } }]);
  const saved = await readWorkbookPackage(output);
  for (const [name, bytes] of parts) {
    expect(source.parts.get(name), `unchanged source ${name}`).toEqual(bytes);
    if (!['xl/workbook.xml', 'xl/worksheets/sheet1.xml'].includes(name)) expect(saved.get(name), name).toEqual(bytes);
  }
  const independent = spawnSync('python3', ['-c', `
import sys,io,zipfile,xml.etree.ElementTree as E,json
with zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())) as z:
 ns={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
 sheet=E.fromstring(z.read('xl/worksheets/sheet1.xml'))
 a=sheet.find('.//s:c[@r="A1"]',ns)
 styles=E.fromstring(z.read('xl/styles.xml'))
 xf=styles.find('s:cellXfs',ns)[int(a.attrib['s'])]
 font=styles.find('s:fonts',ns)[int(xf.attrib['fontId'])]
 print(json.dumps({'value':a.find('s:v',ns).text,'bold':font.find('s:b',ns) is not None,'size':font.find('s:sz',ns).attrib['val'],'sharedFollower':sheet.find('.//s:c[@r="B2"]/s:f',ns).text}))
`], { input: output, encoding: 'utf8' });
  expect(independent.status, independent.stderr).toBe(0);
  expect(JSON.parse(independent.stdout)).toEqual({ value: '19', bold: true, size: '22.25', sharedFollower: 'A2*2' });
  expect((await readXlsxWorkbook(output)).model.sheets[0]!.cells.find(cell => cell.row === 0 && cell.column === 0)?.value).toBe(19);
});

it('does not interpret foreign namespace cell lookalikes as SpreadsheetML', async () => {
  const bytes = await fixture(), parts = new Map(await readWorkbookPackage(bytes));
  const doc = parseWorkbookXml(parts.get('xl/worksheets/sheet1.xml')!);
  const row = doc.getElementsByTagNameNS('http://schemas.openxmlformats.org/spreadsheetml/2006/main', 'row')[0]!;
  const fake = doc.createElementNS('urn:foreign', 'c');
  fake.setAttribute('r', 'D1');
  const value = doc.createElementNS('urn:foreign', 'v'); value.appendChild(doc.createTextNode('999')); fake.appendChild(value); row.appendChild(fake);
  parts.set('xl/worksheets/sheet1.xml', writeWorkbookXml(doc));
  await expect(readXlsxWorkbook(await writeWorkbookPackage(parts))).rejects.toThrow('Foreign workbook importer element');
});

it('refuses unresolved QName-valued compatibility prefixes rather than silently repairing invalid aliases', async () => {
  const parts = new Map(await readWorkbookPackage(await fixture()));
  const doc = parseWorkbookXml(parts.get('xl/worksheets/sheet1.xml')!);
  doc.documentElement!.setAttributeNS('http://schemas.openxmlformats.org/markup-compatibility/2006', 'mc:Ignorable', 'undeclared');
  doc.documentElement!.setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns:mc', 'http://schemas.openxmlformats.org/markup-compatibility/2006');
  parts.set('xl/worksheets/sheet1.xml', writeWorkbookXml(doc));
  await expect(readXlsxWorkbook(await writeWorkbookPackage(parts))).rejects.toThrow('Unresolved workbook compatibility namespace');
});

it('refuses a rebound main prefix on style records rather than importing foreign formatting', async () => {
  const parts = new Map(await readWorkbookPackage(await fixture()));
  const doc = parseWorkbookXml(alias(parts.get('xl/styles.xml')!));
  const owner = doc.getElementsByTagNameNS('http://schemas.openxmlformats.org/spreadsheetml/2006/main', 'cellXfs')[0]!;
  const foreign = doc.createElementNS('urn:rebound', 'ss:xf');
  foreign.setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns:ss', 'urn:rebound');
  foreign.setAttribute('fontId', '0');
  owner.appendChild(foreign);
  parts.set('xl/styles.xml', writeWorkbookXml(doc));
  await expect(readXlsxWorkbook(await writeWorkbookPackage(parts))).rejects.toThrow('Foreign workbook importer element');
});

it('does not canonicalize main-vocabulary descendants through a foreign owner', async () => {
  const parts = new Map(await readWorkbookPackage(await fixture()));
  const doc = parseWorkbookXml(parts.get('xl/worksheets/sheet1.xml')!);
  const row = doc.getElementsByTagNameNS('http://schemas.openxmlformats.org/spreadsheetml/2006/main', 'row')[0]!;
  const wrapper = doc.createElementNS('urn:foreign', 'x:opaque');
  wrapper.appendChild(row.firstChild!.cloneNode(true)); row.appendChild(wrapper);
  parts.set('xl/worksheets/sheet1.xml', writeWorkbookXml(doc));
  await expect(readXlsxWorkbook(await writeWorkbookPackage(parts))).rejects.toThrow('Foreign workbook importer ownership');
});

it.each([false, true])('preserves foreign r:id while resolving the exact owning relationship (foreign first: %s)', async foreignFirst => {
  const { workbookImportView } = await import('../../src/artifacts/workbook/import-view.js');
  const parts = new Map(await readWorkbookPackage(await fixture()));
  const doc = parseWorkbookXml(parts.get('xl/workbook.xml')!);
  const sheet = doc.getElementsByTagNameNS('http://schemas.openxmlformats.org/spreadsheetml/2006/main', 'sheet')[0]!;
  const relationship = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const id = sheet.getAttributeNS(relationship, 'id')!;
  sheet.removeAttributeNS(relationship, 'id');
  sheet.setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns:q', relationship);
  sheet.setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns:r', 'urn:foreign');
  const owning = () => sheet.setAttributeNS(relationship, 'q:id', id);
  const foreign = () => sheet.setAttributeNS('urn:foreign', 'r:id', 'not-the-owner');
  if (foreignFirst) { foreign(); owning(); } else { owning(); foreign(); }
  parts.set('xl/workbook.xml', writeWorkbookXml(doc));
  sheet.setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns:mc', 'http://schemas.openxmlformats.org/markup-compatibility/2006');
  sheet.setAttributeNS('http://schemas.openxmlformats.org/markup-compatibility/2006', 'mc:Ignorable', 'r');
  parts.set('xl/workbook.xml', writeWorkbookXml(doc));
  const before = new Map(parts);
  const view = workbookImportView(parts, ['xl/workbook.xml']);
  const viewed = parseWorkbookXml(view.get('xl/workbook.xml')!).getElementsByTagNameNS('http://schemas.openxmlformats.org/spreadsheetml/2006/main', 'sheet')[0]!;
  expect(viewed.getAttributeNS(relationship, 'id')).toBe(id);
  expect(viewed.getAttributeNS('urn:foreign', 'id')).toBe('not-the-owner');
  expect(viewed.getAttribute('r:id')).toBe(id);
  const ignored = viewed.getAttributeNS('http://schemas.openxmlformats.org/markup-compatibility/2006', 'Ignorable')!;
  expect(viewed.lookupNamespaceURI(ignored)).toBe('urn:foreign');
  const actual = await readXlsxWorkbook(await writeWorkbookPackage(parts));
  expect(actual.model.sheets[0]!.name).toBe('Inputs');
  expect(actual.model.sheets[0]!.cells.find(cell => cell.row === 0 && cell.column === 0)?.value).toBe(12);
  expect(actual.sheetParts.get('1')).toBe('xl/worksheets/sheet1.xml');
  sheet.removeAttributeNS(relationship, 'id');
  sheet.removeAttributeNS('urn:foreign', 'id');
  sheet.setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns:r', relationship);
  sheet.setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns:x', 'urn:foreign');
  sheet.setAttributeNS(relationship, 'r:id', id);
  sheet.setAttributeNS('urn:foreign', 'x:id', 'not-the-owner');
  sheet.setAttributeNS('http://schemas.openxmlformats.org/markup-compatibility/2006', 'mc:Ignorable', 'x');
  const canonicalParts = new Map(parts);
  canonicalParts.set('xl/workbook.xml', writeWorkbookXml(doc));
  expect(actual.model).toEqual((await readXlsxWorkbook(await writeWorkbookPackage(canonicalParts))).model);
  expect(parts).toEqual(before);
});
