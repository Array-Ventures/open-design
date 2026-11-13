import { expect, it } from 'vitest';
import ExcelJS from 'exceljs-community';
import type { Element } from '@xmldom/xmldom';
import { readXlsxWorkbook, type ReadWorkbook } from '../../src/artifacts/workbook/reader.js';
import { patchWorkbookVisibility } from '../../src/artifacts/workbook/visibility-patch.js';
import { calculateWorkbookCellEdits } from '../../src/artifacts/workbook/calculated-patch.js';
import { writeWorkbookPackage } from '../../src/artifacts/workbook/package.js';
import { child, children, xmlPart } from '../../src/artifacts/workbook/parts.js';
import { writeWorkbookXml } from '../../src/artifacts/workbook/xml.js';

async function fixture(): Promise<ReadWorkbook> {
  const book = new ExcelJS.Workbook();
  const first = book.addWorksheet('Inputs'); first.getCell('A1').value = 2;
  first.getCell('B1').value = { formula: 'A1*2', result: 4 }; first.views = [{ state: 'normal', tabSelected: true }];
  book.addWorksheet('Summary').getCell('A1').value = { formula: 'Inputs!B1', result: 4 };
  book.addWorksheet('Hidden', { state: 'hidden' }); book.addWorksheet('Internal', { state: 'veryHidden' });
  book.views = [{ x: 0, y: 0, width: 800, height: 600, visibility: 'visible', activeTab: 0, firstSheet: 0 }];
  const source = await readXlsxWorkbook(Buffer.from(await book.xlsx.writeBuffer()));
  const parts = new Map(source.parts); parts.set('custom/opaque.bin', Buffer.from([1, 7, 255]));
  return readXlsxWorkbook(await writeWorkbookPackage(parts));
}
async function alter(source: ReadWorkbook, part: string, edit: (root: Element) => void): Promise<ReadWorkbook> {
  const parts = new Map(source.parts), document = xmlPart(parts, part); edit(document.documentElement!);
  parts.set(part, writeWorkbookXml(document)); return readXlsxWorkbook(await writeWorkbookPackage(parts));
}
it('hides and unhides without changing cells, formula caches, relationships or unrelated part bytes', async () => {
  const source = await fixture();
  const hidden = await readXlsxWorkbook(await calculateWorkbookCellEdits(source, [], [], [], [{ sheetId: '2', visibility: 'hidden' }]));
  expect(hidden.model.sheets[1]!.visibility).toBe('hidden');
  for (const [name, bytes] of source.parts) if (name !== 'xl/workbook.xml') expect(hidden.parts.get(name), name).toEqual(bytes);
  expect(hidden.model.sheets.map(sheet => sheet.cells)).toEqual(source.model.sheets.map(sheet => sheet.cells));
  const shown = await readXlsxWorkbook(await patchWorkbookVisibility(hidden, [{ sheetId: '2', visibility: 'visible' }]));
  expect(shown.model.sheets.map(sheet => sheet.visibility)).toEqual(['visible', 'visible', 'hidden', 'veryHidden']);
  expect(shown.parts.get('xl/worksheets/sheet4.xml')).toEqual(source.parts.get('xl/worksheets/sheet4.xml'));
});
it('reconciles activeTab, firstSheet and tab selection when the active worksheet is hidden', async () => {
  const source = await fixture(), saved = await readXlsxWorkbook(await patchWorkbookVisibility(source, [{ sheetId: '1', visibility: 'hidden' }]));
  expect(saved.model.activeSheetId).toBe('2');
  const view = child(child(xmlPart(saved.parts, 'xl/workbook.xml').documentElement!, 'bookViews')!, 'workbookView')!;
  expect(view.getAttribute('activeTab')).toBe('1'); expect(view.getAttribute('firstSheet')).toBe('1');
  const old = child(child(xmlPart(saved.parts, 'xl/worksheets/sheet1.xml').documentElement!, 'sheetViews')!, 'sheetView')!;
  expect(old.hasAttribute('tabSelected')).toBe(false);
  const next = child(child(xmlPart(saved.parts, 'xl/worksheets/sheet2.xml').documentElement!, 'sheetViews')!, 'sheetView')!;
  expect(next.getAttribute('tabSelected')).toBe('1');
  expect(saved.model.sheets.map(sheet => sheet.cells)).toEqual(source.model.sheets.map(sheet => sheet.cells));
});
it('creates missing views in OOXML order when default active sheet becomes hidden', async () => {
  let source = await fixture();
  source = await alter(source, 'xl/workbook.xml', root => { const view = child(root, 'bookViews'); if (view) root.removeChild(view); });
  source = await alter(source, 'xl/worksheets/sheet2.xml', root => { const view = child(root, 'sheetViews'); if (view) root.removeChild(view); });
  const saved = await readXlsxWorkbook(await patchWorkbookVisibility(source, [{ sheetId: '1', visibility: 'hidden' }]));
  expect(saved.model.activeSheetId).toBe('2');
  const root = xmlPart(saved.parts, 'xl/worksheets/sheet2.xml').documentElement!;
  expect(children(root, 'sheetViews')).toHaveLength(1);
  const tags = Array.from(root.childNodes).filter(node => node.nodeType === 1).map(node => (node as Element).localName);
  expect(tags.indexOf('sheetViews')).toBeLessThan(tags.indexOf('sheetData'));
});
it('reconciles every workbook view independently', async () => {
  const source = await alter(await fixture(), 'xl/workbook.xml', root => {
    const views = child(root, 'bookViews')!, second = child(views, 'workbookView')!.cloneNode(true) as Element;
    second.setAttribute('activeTab', '1'); second.setAttribute('firstSheet', '1'); views.appendChild(second);
  });
  const saved = await readXlsxWorkbook(await patchWorkbookVisibility(source, [{ sheetId: '1', visibility: 'hidden' }]));
  const views = children(child(xmlPart(saved.parts, 'xl/workbook.xml').documentElement!, 'bookViews')!, 'workbookView');
  expect(views.map(view => view.getAttribute('activeTab'))).toEqual(['1', '1']);
  const selected = children(child(xmlPart(saved.parts, 'xl/worksheets/sheet2.xml').documentElement!, 'sheetViews')!, 'sheetView');
  expect(selected.find(view => view.getAttribute('workbookViewId') === '0')?.getAttribute('tabSelected')).toBe('1');
});
it.each([
  { edits: [{ sheetId: '1', visibility: 'hidden' }, { sheetId: '2', visibility: 'hidden' }] },
  { edits: [{ sheetId: '4', visibility: 'visible' }] },
  { edits: [{ sheetId: 'unknown', visibility: 'hidden' }] },
  { edits: [{ sheetId: '1', visibility: 'hidden' }, { sheetId: '1', visibility: 'visible' }] },
] as const)('refuses invalid visibility plans without mutating source parts ($edits)', async ({ edits }) => {
  const source = await fixture(), before = [...source.parts].map(([name, bytes]) => [name, Buffer.from(bytes)]);
  await expect(patchWorkbookVisibility(source, edits)).rejects.toThrow();
  expect([...source.parts]).toEqual(before);
});
it.each(['workbookProtection', 'customWorkbookViews'])('refuses source-owned %s despite a forged capability flag', async tag => {
  const source = await alter(await fixture(), 'xl/workbook.xml', root => root.insertBefore(root.ownerDocument!.createElementNS(root.namespaceURI, tag), child(root, 'sheets')!));
  expect(source.model.worksheetVisibilityEditable).toBe(false);
  source.model.worksheetVisibilityEditable = true;
  await expect(patchWorkbookVisibility(source, [{ sheetId: '2', visibility: 'hidden' }])).rejects.toMatchObject({ code: 'WORKBOOK_UNSUPPORTED' });
});
it('refuses signatures and combines ordinary cell saves with visibility through the same candidate', async () => {
  const source = await fixture();
  await expect(patchWorkbookVisibility({ ...source, model: { ...source.model, features: { ...source.model.features, signed: true } } }, [{ sheetId: '2', visibility: 'hidden' }])).rejects.toMatchObject({ code: 'WORKBOOK_UNSUPPORTED' });
  const saved = await calculateWorkbookCellEdits(source, [{ sheetId: '1', cell: { row: 0, column: 0, kind: 'number', value: 7 } }], [], [], [{ sheetId: '2', visibility: 'hidden' }]);
  expect(saved.model.sheets[0]!.cells.find(cell => cell.column === 1)?.value).toBe(14);
  expect(saved.model.sheets[1]!.visibility).toBe('hidden');
});
it('keeps unsupported stored formula caches byte-identical on a visibility-only save', async () => {
  const source = await alter(await fixture(), 'xl/worksheets/sheet1.xml', root => {
    const cell = children(children(child(root, 'sheetData')!, 'row')[0]!, 'c').find(cell => cell.getAttribute('r') === 'B1')!;
    child(cell, 'f')!.textContent = 'UNAVAILABLE_VENDOR(A1)';
  });
  const saved = await calculateWorkbookCellEdits(source, [], [], [], [{ sheetId: '2', visibility: 'hidden' }]);
  expect(saved.model.sheets[0]!.cells.find(cell => cell.column === 1)).toMatchObject({ formula: '=UNAVAILABLE_VENDOR(A1)', value: 4 });
  const reopened = await readXlsxWorkbook(saved.bytes);
  expect(reopened.parts.get('xl/worksheets/sheet1.xml')).toEqual(source.parts.get('xl/worksheets/sheet1.xml'));
});
