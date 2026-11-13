import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';
import ExcelJS from 'exceljs-community';
import { nameCharacterCheck } from '@univerjs/core';
import { workbookSheetProjectionSchema, workbookEditPlanSchema, type WorkbookSheetProjection } from '@open-design/contracts/runtime/workbook';
import { patchWorkbookSheets } from '../../src/artifacts/workbook/sheet-patch.js';
import { calculateWorkbookSheetEdits } from '../../src/artifacts/workbook/calculated-patch.js';
import { readXlsxWorkbook } from '../../src/artifacts/workbook/reader.js';
import { child, children, xmlPart } from '../../src/artifacts/workbook/parts.js';
import { writeWorkbookPackage } from '../../src/artifacts/workbook/package.js';
import { writeWorkbookXml } from '../../src/artifacts/workbook/xml.js';
async function fixture() {
  const book = new ExcelJS.Workbook(), first = book.addWorksheet("Bob's plan"), second = book.addWorksheet('Summary');
  first.getCell('B2').value = 12;
  second.getCell('A1').value = { formula: "'Bob''s plan'!$B$2+1", result: 999 };
  second.getCell('A2').value = { formula: 'IF(TRUE,"Bob\'s plan!B2","")', result: "Bob's plan!B2" };
  return readXlsxWorkbook(Buffer.from(await book.xlsx.writeBuffer()));
}
const projection = (source: Awaited<ReturnType<typeof fixture>>): WorkbookSheetProjection => source.model.sheets.map(sheet => ({ sheetId: sheet.id, name: sheet.name, origin: 'source' }));
it('renames parsed quoted references, preserves strings/source IDs and recalculates actual source bytes', async () => {
  const source = await fixture(), target = projection(source); target[0]!.name = "Quarter's plan";
  const saved = await readXlsxWorkbook((await calculateWorkbookSheetEdits(source, target)).bytes);
  expect(saved.model.sheets.map(sheet => [sheet.id, sheet.name])).toEqual([['1', "Quarter's plan"], ['2', 'Summary']]);
  expect(saved.model.sheets[1]!.cells.find(cell => cell.row === 0)).toMatchObject({ formula: "='Quarter''s plan'!$B$2+1", value: 13 });
  expect(saved.model.sheets[1]!.cells.find(cell => cell.row === 1)).toMatchObject({ formula: '=IF(TRUE,"Bob\'s plan!B2","")', value: "Bob's plan!B2" });
  expect(saved.sheetParts).toEqual(source.sheetParts);
  for (const name of ['xl/styles.xml', 'xl/sharedStrings.xml', 'docProps/core.xml']) expect(saved.parts.get(name)).toEqual(source.parts.get(name));
  const app = xmlPart(saved.parts, 'docProps/app.xml'); expect(app.toString()).toContain("Quarter's plan");
  const independent = new ExcelJS.Workbook(); await independent.xlsx.load(Uint8Array.from((await calculateWorkbookSheetEdits(source, target)).bytes).buffer);
  expect(independent.getWorksheet('Summary')!.getCell('A1').result).toBe(13);
});
it('deletes a worksheet with REF error semantics instead of retargeting its reference', async () => {
  const source = await fixture(), target = projection(source).slice(1);
  const result = await calculateWorkbookSheetEdits(source, target), saved = await readXlsxWorkbook(result.bytes);
  expect(saved.model.sheets).toHaveLength(1); expect(saved.model.sheets[0]!.id).toBe('2');
  expect(saved.model.sheets[0]!.cells.find(cell => cell.row === 0)).toMatchObject({ formula: '=#REF!+1', kind: 'error', value: '#REF!' });
  expect(saved.parts.has(source.sheetParts.get('1')!)).toBe(false);
  expect(xmlPart(saved.parts, '[Content_Types].xml').toString()).not.toContain('/xl/worksheets/sheet1.xml');
});
it('adds a genuinely blank sheet with stable numeric ID and source-preserving content ownership', async () => {
  const source = await fixture(), target = projection(source); target.push({ sheetId: '3', name: 'New notes', origin: 'new' });
  const result = await calculateWorkbookSheetEdits(source, target, [{ sheetId: '3', cell: { row: 0, column: 0, kind: 'number', value: 17 } }]);
  const saved = await readXlsxWorkbook(result.bytes);
  expect(saved.model.sheets.map(sheet => sheet.id)).toEqual(['1', '2', '3']);
  expect(saved.model.sheets[2]!.cells[0]).toMatchObject({ value: 17 });
  const again = await readXlsxWorkbook((await calculateWorkbookSheetEdits(saved, projection(saved))).bytes);
  expect(again.sheetParts).toEqual(saved.sheetParts); expect(again.model.sheets[2]!.id).toBe('3');
});
it('evaluates final visible membership together with visibility and refuses invalid IDs/order/names', async () => {
  const source = await fixture(), target = projection(source);
  await expect(patchWorkbookSheets(source, target.slice(0, 1), [{ sheetId: '1', visibility: 'hidden' }])).rejects.toThrow('visible');
  await expect(patchWorkbookSheets(source, [...target.slice(0, 1), { sheetId: '3', name: 'Visible', origin: 'new' }], [{ sheetId: '1', visibility: 'hidden' }])).resolves.toBeInstanceOf(Buffer);
  for (const invalid of [[...target].reverse(), [{ ...target[0]!, origin: 'new' as const }], [{ ...target[0]!, sheetId: '3' }], [...target, { sheetId: '65536', name: 'Overflow', origin: 'new' as const }], [...target, { sheetId: '3', name: 'summary', origin: 'new' as const }]]) await expect(patchWorkbookSheets(source, invalid)).rejects.toThrow();
});
it('uses the pinned UTF-16 name bound and keeps the public edit-plan wire closed', () => {
  for (const name of ['Simple', "Bob's plan", '🚀'.repeat(15), '🚀'.repeat(16), "'bad", 'bad]', 'x'.repeat(31), 'x'.repeat(32)]) expect(workbookSheetProjectionSchema.safeParse([{ sheetId: '1', name, origin: 'source' }]).success).toBe(nameCharacterCheck(name));
  expect(workbookEditPlanSchema.safeParse({ sourceSha256: 'a'.repeat(64), edits: [], sheets: [] }).success).toBe(false);
});
it('refuses unowned extended-property vectors before changing any source part', async () => {
  const source = await fixture(), document = xmlPart(source.parts, 'docProps/app.xml');
  const headings = child(document.documentElement!, 'HeadingPairs')!; headings.textContent = '';
  const parts = new Map(source.parts); parts.set('docProps/app.xml', writeWorkbookXml(document));
  const malformed = await readXlsxWorkbook(await writeWorkbookPackage(parts));
  await expect(patchWorkbookSheets(malformed, projection(malformed))).rejects.toThrow('metadata');
});
it('preserves exact package members and stale caches for an unchanged acknowledged projection', async () => {
  const source = await fixture(), saved = await readXlsxWorkbook((await calculateWorkbookSheetEdits(source, projection(source))).bytes);
  for (const [part, bytes] of source.parts) expect(saved.parts.get(part), part).toEqual(bytes);
  expect(saved.model.sheets[1]!.cells.find(cell => cell.row === 0)?.value).toBe(999);
});
it('removes derived calcChain owners without touching unrelated package members', async () => {
  const initial = await fixture(), parts = new Map(initial.parts);
  const relationships = xmlPart(parts, 'xl/_rels/workbook.xml.rels'), relation = relationships.createElementNS(relationships.documentElement!.namespaceURI, 'Relationship');
  relation.setAttribute('Id', 'rIdChain'); relation.setAttribute('Type', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/calcChain'); relation.setAttribute('Target', 'calcChain.xml'); relationships.documentElement!.appendChild(relation);
  parts.set('xl/_rels/workbook.xml.rels', writeWorkbookXml(relationships));
  const types = xmlPart(parts, '[Content_Types].xml'), type = types.createElementNS(types.documentElement!.namespaceURI, 'Override');
  type.setAttribute('PartName', '/xl/calcChain.xml'); type.setAttribute('ContentType', 'application/vnd.openxmlformats-officedocument.spreadsheetml.calcChain+xml'); types.documentElement!.appendChild(type); parts.set('[Content_Types].xml', writeWorkbookXml(types));
  parts.set('xl/calcChain.xml', Buffer.from('<calcChain xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><c r="A1" i="2"/></calcChain>'));
  const source = await readXlsxWorkbook(await writeWorkbookPackage(parts)), target = projection(source); target[0]!.name = 'Renamed';
  const saved = await readXlsxWorkbook((await calculateWorkbookSheetEdits(source, target)).bytes);
  expect(saved.parts.has('xl/calcChain.xml')).toBe(false);
  expect(xmlPart(saved.parts, 'xl/_rels/workbook.xml.rels').toString()).not.toContain('rIdChain');
  expect(xmlPart(saved.parts, '[Content_Types].xml').toString()).not.toContain('/xl/calcChain.xml');
  expect(saved.parts.get('docProps/core.xml')).toEqual(source.parts.get('docProps/core.xml'));
});
it('applies final membership and visibility before selecting a valid visible workbook view', async () => {
  const source = await fixture(), target = [{ ...projection(source)[1]! }, { sheetId: '3', name: 'Fresh', origin: 'new' as const }];
  const saved = await readXlsxWorkbook((await calculateWorkbookSheetEdits(source, target, [], [], [], [{ sheetId: '2', visibility: 'hidden' }])).bytes);
  expect(saved.model.sheets.map(sheet => [sheet.id, sheet.visibility])).toEqual([['2', 'hidden'], ['3', 'visible']]);
  expect(saved.model.activeSheetId).toBe('3');
});
it('keeps existing sheet IDs while combining an added sheet with real axis, dimension and style owners', async () => {
  const source = await fixture(), target = projection(source); target.push({ sheetId: '3', name: 'New', origin: 'new' });
  const result = await calculateWorkbookSheetEdits(source, target, [{ sheetId: '3', cell: { row: 1, column: 0, kind: 'number', value: 19 } }], [{ sheetId: '3', axis: 'row', index: 1, size: 33 }], [{ sheetId: '3', row: 1, column: 0, fontSize: 22.25 }], [], [{ sheetId: '3', sourceRows: 100, sourceColumns: 26, rows: [0, null, ...Array.from({ length: 99 }, (_, index) => index + 1)], columns: Array.from({ length: 26 }, (_, index) => index) }]);
  const saved = await readXlsxWorkbook(result.bytes), sheet = saved.model.sheets[2]!;
  expect(sheet.id).toBe('3'); expect(sheet.cells.find(cell => cell.row === 1 && cell.column === 0)).toMatchObject({ value: 19 });
  expect(sheet.rowDimensions.find(row => row.index === 1)?.height).toBe(33);
  expect(saved.model.styles[sheet.cells.find(cell => cell.row === 1 && cell.column === 0)!.style!]!.font?.size).toBe(22.25);
});
it('proves bounded importer-ID exhaustion on actual source bytes rather than wrapping a birth ID', async () => {
  const initial = await fixture(), parts = new Map(initial.parts), book = xmlPart(parts, 'xl/workbook.xml');
  children(child(book.documentElement!, 'sheets')!, 'sheet')[1]!.setAttribute('sheetId', '65535');
  parts.set('xl/workbook.xml', writeWorkbookXml(book));
  const source = await readXlsxWorkbook(await writeWorkbookPackage(parts));
  expect(source.model.sheets[1]!.id).toBe('65535');
  const target = projection(source); target.push({ sheetId: '3', name: 'Wrong birth', origin: 'new' });
  await expect(patchWorkbookSheets(source, target)).rejects.toThrow('above the source maximum');
  target[2]!.sheetId = '65536'; await expect(patchWorkbookSheets(source, target)).rejects.toThrow();
});
it('refuses a deleted-sheet visibility edit, unknown plan fields and unowned reference metadata atomically', async () => {
  const source = await fixture();
  await expect(patchWorkbookSheets(source, projection(source).slice(1), [{ sheetId: '1', visibility: 'visible' }])).rejects.toThrow('final sheet');
  await expect(patchWorkbookSheets(source, [{ ...projection(source)[0]!, surprise: true } as never])).rejects.toThrow();
  const parts = new Map(source.parts); parts.set('customXml/item1.xml', Buffer.from('<references sheet="Summary"/>'));
  await expect(patchWorkbookSheets({ ...source, parts }, projection(source))).rejects.toThrow('unowned');
  const before = source.parts.get('xl/workbook.xml');
  await expect(patchWorkbookSheets(source, [{ ...projection(source)[0]!, name: 'Bad/name' }])).rejects.toThrow();
  expect(source.parts.get('xl/workbook.xml')).toBe(before);
});

it('independently opens final ZIP membership, properties, references and caches without the product reader', async () => {
  const source = await fixture(), target = projection(source).slice(1); target.push({ sheetId: '3', name: "Fresh's sheet", origin: 'new' });
  const result = await calculateWorkbookSheetEdits(source, target);
  const proof = JSON.parse(execFileSync('python3', ['-c', `import io,json,sys,zipfile,xml.etree.ElementTree as E
with zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())) as z:
 book=E.fromstring(z.read('xl/workbook.xml'))
 sheets=[(n.get('sheetId'),n.get('name')) for n in book.findall('{*}sheets/{*}sheet')]
 cells=E.fromstring(z.read('xl/worksheets/sheet2.xml')).findall('{*}sheetData/{*}row/{*}c')
 a1=next(n for n in cells if n.get('r')=='A1')
 app=E.fromstring(z.read('docProps/app.xml'))
 titles=[n.text for n in app.findall('{*}TitlesOfParts/{*}vector/{*}lpstr')]
 print(json.dumps({'sheets':sheets,'formula':a1.findtext('{*}f'),'kind':a1.get('t'),'cache':a1.findtext('{*}v'),'titles':titles,'deleted':'xl/worksheets/sheet1.xml' not in z.namelist(),'new':'xl/worksheets/sheet3.xml' in z.namelist()}))`], { input: result.bytes, encoding: 'utf8' }));
  expect(proof).toEqual({ sheets: [['2', 'Summary'], ['3', "Fresh's sheet"]], formula: '#REF!+1', kind: 'e', cache: '#REF!', titles: ['Summary', "Fresh's sheet"], deleted: true, new: true });
});
