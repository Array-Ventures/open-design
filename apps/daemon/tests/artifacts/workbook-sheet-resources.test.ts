import { expect, it } from 'vitest';
import ExcelJS from 'exceljs-community';
import { readXlsxWorkbook, type ReadWorkbook } from '../../src/artifacts/workbook/reader.js';
import { calculateWorkbookCellEdits, calculateWorkbookSheetEdits } from '../../src/artifacts/workbook/calculated-patch.js';
import { workbookStyleComponentSignature } from '../../src/artifacts/workbook/style-patch.js';
import { assertWorkbookSheetResourceContinuity } from '../../src/artifacts/workbook/sheet-resources.js';
import { child, children, xmlPart } from '../../src/artifacts/workbook/parts.js';
import { writeWorkbookPackage, WORKBOOK_PACKAGE_LIMITS } from '../../src/artifacts/workbook/package.js';
import { writeWorkbookXml } from '../../src/artifacts/workbook/xml.js';
async function fixture() {
  const book = new ExcelJS.Workbook(), first = book.addWorksheet('Inputs'), removed = book.addWorksheet('Restore me'), last = book.addWorksheet('Other');
  first.getCell('A1').value = 12; first.getCell('B2').value = { formula: 'A1+1', result: 13 };
  removed.getCell('A1').value = 'Shared historical text'; removed.getCell('A1').font = { name: 'Arial', bold: true, size: 12 };
  removed.getCell('A1').numFmt = '0.00'; removed.getCell('B2').value = 4.5; removed.getCell('B2').numFmt = '0.0000" units"'; removed.getRow(2).height = 33; removed.getColumn(2).width = 19;
  removed.mergeCells('D4:E5'); removed.getCell('D4').value = 'Merged'; removed.headerFooter.oddHeader = 'Historical header';
  removed.pageSetup.orientation = 'landscape'; last.getCell('A1').value = 10;
  return readXlsxWorkbook(Buffer.from(await book.xlsx.writeBuffer({ useSharedStrings: true })));
}
async function modified(source: ReadWorkbook, part: string, change: (document: ReturnType<typeof xmlPart>) => void) {
  const parts = new Map(source.parts), document = xmlPart(parts, part); change(document); parts.set(part, writeWorkbookXml(document));
  return readXlsxWorkbook(await writeWorkbookPackage(parts));
}
it('proves prefix/string/theme continuity through every currently qualified source writer', async () => {
  const historical = await fixture(); expect(historical.parts.has('xl/sharedStrings.xml')).toBe(true);
  let current = historical;
  const accept = async (bytes: Buffer) => { current = await readXlsxWorkbook(bytes); expect(() => assertWorkbookSheetResourceContinuity(historical, current)).not.toThrow(); };
  expect(() => assertWorkbookSheetResourceContinuity(historical, historical)).not.toThrow();
  await accept((await calculateWorkbookCellEdits(current, [{ sheetId: '1', cell: { row: 0, column: 0, kind: 'number', value: 21 } }])).bytes);
  await accept((await calculateWorkbookCellEdits(current, [{ sheetId: '3', cell: { row: 2, column: 1, kind: 'string', value: 'Rich text', runs: [{ text: 'Rich ', font: { bold: true } }, { text: 'text', font: { italic: true } }] } }])).bytes);
  await accept((await calculateWorkbookCellEdits(current, [], [], [{ sheetId: '3', row: 0, column: 0, fontSize: 22.25, bold: true, italic: true, fillColor: 'FF123456', fontColor: 'FF345678' }])).bytes);
  await accept((await calculateWorkbookCellEdits(current, [], [{ sheetId: '3', axis: 'column', index: 1, size: 28 }])).bytes);
  await accept((await calculateWorkbookCellEdits(current, [], [], [], [{ sheetId: '2', visibility: 'hidden' }])).bytes);
  const first = current.model.sheets[0]!;
  await accept((await calculateWorkbookCellEdits(current, [], [], [], [], [{ sheetId: '1', sourceRows: first.rowCount, sourceColumns: first.columnCount, rows: [null, ...Array.from({ length: first.rowCount }, (_, index) => index)], columns: Array.from({ length: first.columnCount }, (_, index) => index) }])).bytes);
  await accept((await calculateWorkbookSheetEdits(current, [{ sheetId: '1', name: 'Renamed inputs', origin: 'source' }, { sheetId: '3', name: 'Other', origin: 'source' }, { sheetId: '4', name: 'New', origin: 'new' }])).bytes);
  expect(current.parts.has(historical.sheetParts.get('2')!)).toBe(false);
  expect(children(child(xmlPart(current.parts, 'xl/styles.xml').documentElement!, 'cellXfs')!, 'xf').length).toBeGreaterThan(children(child(xmlPart(historical.parts, 'xl/styles.xml').documentElement!, 'cellXfs')!, 'xf').length);
});
it.each(['font', 'strings', 'theme', 'date-system'])('refuses a real replacement of historical %s ownership', async owner => {
  const historical = await fixture();
  const current = owner === 'font' ? await modified(historical, 'xl/styles.xml', document => { children(child(document.documentElement!, 'fonts')!, 'font')[0]!.appendChild(document.createElementNS(document.documentElement!.namespaceURI, 'outline')); })
    : owner === 'strings' ? await modified(historical, 'xl/sharedStrings.xml', document => { children(document.documentElement!, 'si')[0]!.textContent = 'Changed historical string'; })
    : owner === 'theme' ? await modified(historical, 'xl/theme/theme1.xml', document => { document.documentElement!.setAttribute('name', 'Different theme'); })
    : await modified(historical, 'xl/workbook.xml', document => { child(document.documentElement!, 'workbookPr')!.setAttribute('date1904', '1'); });
  expect(() => assertWorkbookSheetResourceContinuity(historical, current)).toThrow('resources');
});
it('rechecks used XML indices instead of trusting a previously decoded model', async () => {
  const source = await fixture(), parts = new Map(source.parts), sheet = xmlPart(parts, source.sheetParts.get('2')!);
  children(children(child(sheet.documentElement!, 'sheetData')!, 'row')[0]!, 'c')[0]!.setAttribute('s', '999');
  parts.set(source.sheetParts.get('2')!, writeWorkbookXml(sheet));
  expect(() => assertWorkbookSheetResourceContinuity({ ...source, parts }, source)).toThrow('resources');
  const styles = xmlPart(source.parts, 'xl/styles.xml'); children(child(styles.documentElement!, 'cellXfs')!, 'xf')[0]!.setAttribute('fontId', '999');
  const sameInvalid = { ...source, parts: new Map(source.parts).set('xl/styles.xml', writeWorkbookXml(styles)) };
  expect(() => assertWorkbookSheetResourceContinuity(sameInvalid, sameInvalid)).toThrow('resources');
});

it.each(['format-id', 'style-name', 'builtin-style'])('refuses a shadowing appended current owner: %s', async kind => {
  const historical = await fixture();
  const current = await modified(historical, 'xl/styles.xml', document => {
    const root = document.documentElement!;
    if (kind === 'format-id') {
      const formats = child(root, 'numFmts')!, entries = children(formats, 'numFmt'); expect(entries.length).toBeGreaterThan(0);
      const duplicate = entries[0]!.cloneNode(true) as typeof root; duplicate.setAttribute('formatCode', '0.0%'); formats.appendChild(duplicate); formats.setAttribute('count', String(entries.length + 1));
    } else {
      const styles = child(root, 'cellStyles')!, entries = children(styles, 'cellStyle'), duplicate = entries[0]!.cloneNode(true) as typeof root;
      if (kind === 'style-name') duplicate.removeAttribute('builtinId'); else duplicate.setAttribute('name', 'Another builtin alias');
      styles.appendChild(duplicate); styles.setAttribute('count', String(entries.length + 1));
    }
  });
  expect(() => assertWorkbookSheetResourceContinuity(historical, current)).toThrow('resources');
});

it('keeps XML structure distinct from text that happens to contain its encoded signature', async () => {
  const document = xmlPart((await fixture()).parts, 'xl/styles.xml'), namespace = document.documentElement!.namespaceURI;
  const font = document.createElementNS(namespace, 'font'), name = document.createElementNS(namespace, 'name'); name.setAttribute('val', 'Arial'); font.appendChild(name);
  const text = document.createElementNS(namespace, 'font'); text.textContent = workbookStyleComponentSignature(name);
  expect(workbookStyleComponentSignature(font) === workbookStyleComponentSignature(text)).toBe(false);
});
it('serializes a bounded nested XML component once rather than repeatedly escaping child signatures', async () => {
  const document = xmlPart((await fixture()).parts, 'xl/styles.xml'), namespace = document.documentElement!.namespaceURI;
  const font = document.createElementNS(namespace, 'font'); let cursor = font;
  for (let depth = 0; depth < 12; depth++) { const child = document.createElementNS(namespace, 'nested'); cursor.appendChild(child); cursor = child; }
  cursor.setAttribute('val', 'bounded');
  expect(workbookStyleComponentSignature(font).length).toBeLessThan(10_000);
});
it('refuses actual XML replacing retained font elements with signature-shaped CDATA', async () => {
  const historical = await fixture();
  const current = await modified(historical, 'xl/styles.xml', document => {
    const font = children(child(document.documentElement!, 'fonts')!, 'font')[0]!;
    const encoded = Array.from(font.childNodes).filter(node => node.nodeType === 1).map(node => workbookStyleComponentSignature(node as typeof font));
    while (font.firstChild) font.removeChild(font.firstChild);
    for (const text of encoded) font.appendChild(document.createCDATASection(text));
  });
  expect(() => assertWorkbookSheetResourceContinuity(historical, current)).toThrow('resources');
});

it('bounds constructed style trees and distinguishes comments from source text', async () => {
  const document = xmlPart((await fixture()).parts, 'xl/styles.xml'), namespace = document.documentElement!.namespaceURI;
  const text = document.createElementNS(namespace, 'font'), comment = document.createElementNS(namespace, 'font');
  text.appendChild(document.createTextNode('preserve')); comment.appendChild(document.createComment('preserve'));
  expect(workbookStyleComponentSignature(text) === workbookStyleComponentSignature(comment)).toBe(false);
  const deep = document.createElementNS(namespace, 'font'); let cursor = deep;
  for (let index = 0; index < 128; index++) { const child = document.createElementNS(namespace, 'nested'); cursor.appendChild(child); cursor = child; }
  expect(() => workbookStyleComponentSignature(deep)).toThrow('structural limit');
  text.textContent = 'x'.repeat(Math.floor(WORKBOOK_PACKAGE_LIMITS.partBytes / 6));
  expect(() => workbookStyleComponentSignature(text)).toThrow('byte budget');
});
