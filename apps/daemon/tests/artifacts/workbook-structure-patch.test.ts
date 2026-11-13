import { expect, it } from 'vitest';
import ExcelJS from 'exceljs-community';
import { execFileSync } from 'node:child_process';
import { readXlsxWorkbook } from '../../src/artifacts/workbook/reader.js';
import { calculateWorkbookCellEdits } from '../../src/artifacts/workbook/calculated-patch.js';
import { patchWorkbookStructure, assertWorkbookStructureSupported } from '../../src/artifacts/workbook/structure-patch.js';
import { child, children, xmlPart } from '../../src/artifacts/workbook/parts.js';
import { writeWorkbookPackage } from '../../src/artifacts/workbook/package.js';
import { writeWorkbookXml } from '../../src/artifacts/workbook/xml.js';
async function fixture() {
  const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('Budget'), dependent = book.addWorksheet("Bob's plan");
  sheet.views = [{ state: 'normal' }];
  sheet.getCell('A1').value = 'Header'; sheet.getCell('B2').value = 12; sheet.getCell('B2').font = { bold: true, color: { argb: 'FF123456' } };
  sheet.getCell('C3').value = { formula: 'SUM($B$2:B3)', result: 12 };
  dependent.getCell('A1').value = { formula: 'Budget!$B$2', result: 12 };
  sheet.getRow(2).height = 30; sheet.getColumn(2).width = 24; sheet.mergeCells('D4:E5'); sheet.getCell('D4').value = 'Merged';
  const source = await readXlsxWorkbook(Buffer.from(await book.xlsx.writeBuffer()));
  return source;
}
const insert = (count: number, at: number) => Array.from({ length: count + 1 }, (_, index) => index < at ? index : index === at ? null : index - 1);
const remove = (count: number, at: number) => Array.from({ length: count - 1 }, (_, index) => index < at ? index : index + 1);
it('inserts axes preserving raw styles/shared strings and rewrites local/qualified formulas and merges without reserializing unrelated ZIP members', async () => {
  const source = await fixture(), sheet = source.model.sheets[0]!;
  const bytes = await patchWorkbookStructure(source, [{ sheetId: sheet.id, sourceRows: sheet.rowCount, sourceColumns: sheet.columnCount, rows: insert(sheet.rowCount, 1), columns: insert(sheet.columnCount, 1) }]);
  const saved = await readXlsxWorkbook(bytes), cells = saved.model.sheets[0]!.cells;
  expect(cells.find(cell => cell.row === 2 && cell.column === 2)).toMatchObject({ value: 12, style: source.model.sheets[0]!.cells.find(cell => cell.row === 1 && cell.column === 1)!.style });
  expect(cells.find(cell => cell.row === 3 && cell.column === 3)?.formula).toBe('=SUM($C$3:C4)');
  expect(saved.model.sheets[1]!.cells[0]!.formula).toBe('=Budget!$C$3');
  expect(saved.model.sheets[0]!.merges).toEqual([{ startRow: 4, endRow: 5, startColumn: 4, endColumn: 5 }]);
  expect(saved.model.sheets[0]!.rowDimensions.find(row => row.index === 2)?.height).toBe(30);
  expect(saved.model.sheets[0]!.columnDimensions.find(column => column.index === 2)?.width).toBe(24);
  expect(saved.model.sheets[0]!.columnDimensions.find(column => column.index === 1)).toBeUndefined();
  for (const [part, original] of source.parts) if (!part.startsWith('xl/worksheets/sheet')) expect(saved.parts.get(part), part).toEqual(original);
  const independent = new ExcelJS.Workbook(); await independent.xlsx.load(Uint8Array.from(bytes).buffer);
  expect(independent.getWorksheet('Budget')!.getCell('C3').value).toBe(12);
  expect(independent.getWorksheet('Budget')!.getCell('D4').formula).toBe('SUM($C$3:C4)');
  const raw = JSON.parse(execFileSync('python3', ['-c', `import io,json,sys,zipfile,xml.etree.ElementTree as E
with zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())) as z:
 root=E.fromstring(z.read('xl/worksheets/sheet1.xml'))
 print(json.dumps({c.get('r'):{'style':c.get('s'),'formula':c.findtext('{*}f'),'value':c.findtext('{*}v')} for c in root.findall('{*}sheetData/{*}row/{*}c')}))`], { input: bytes, encoding: 'utf8' }));
  expect(raw.C3.style).toBe(String(source.model.sheets[0]!.cells.find(cell => cell.row === 1 && cell.column === 1)!.style));
  expect(raw.D4.formula).toBe('SUM($C$3:C4)'); expect(raw.D4.value).toBeNull();
});
it('deletes source cells and shrinks surviving references, preserving deleted references as REF rather than retargeting a neighbor', async () => {
  const source = await fixture(), sheet = source.model.sheets[0]!;
  const saved = await readXlsxWorkbook(await patchWorkbookStructure(source, [{ sheetId: sheet.id, sourceRows: sheet.rowCount, sourceColumns: sheet.columnCount, rows: remove(sheet.rowCount, 1), columns: Array.from({ length: sheet.columnCount }, (_, index) => index) }]));
  expect(saved.model.sheets[0]!.cells.some(cell => cell.value === 12 && !cell.formula)).toBe(false);
  expect(saved.model.sheets[0]!.cells.find(cell => cell.formula)?.formula).toBe('=SUM($B$2:B2)');
  expect(saved.model.sheets[1]!.cells[0]!.formula).toBe('=#REF!');
});
it('refuses unsupported coordinate owners and merged-anchor deletion instead of dropping metadata', async () => {
  const source = await fixture(), sheet = source.model.sheets[0]!;
  await expect(patchWorkbookStructure(source, [{ sheetId: sheet.id, sourceRows: sheet.rowCount, sourceColumns: sheet.columnCount, rows: remove(sheet.rowCount, 3), columns: Array.from({ length: sheet.columnCount }, (_, index) => index) }])).rejects.toThrow('merged anchor');
  const part = source.sheetParts.get(sheet.id)!, doc = xmlPart(source.parts, part), root = doc.documentElement!;
  const validation = doc.createElementNS(root.namespaceURI, 'dataValidations'); root.appendChild(validation);
  const parts = new Map(source.parts); parts.set(part, writeWorkbookXml(doc));
  expect(() => assertWorkbookStructureSupported({ ...source, parts })).toThrow('metadata');
  const unknown = new Map(source.parts); unknown.set('customXml/item1.xml', Buffer.from('<bindings ref="A2"/>'));
  expect(() => assertWorkbookStructureSupported({ ...source, parts: unknown })).toThrow('unowned');
});
it('maps view selections when cells are deleted and keeps XML selection indexes valid', async () => {
  const source = await fixture(), sheet = source.model.sheets[0]!, part = source.sheetParts.get(sheet.id)!;
  const doc = xmlPart(source.parts, part), root = doc.documentElement!, views = child(root, 'sheetViews')!, view = children(views, 'sheetView')[0]!;
  view.setAttribute('topLeftCell', 'B2'); const selection = doc.createElementNS(root.namespaceURI, 'selection'); selection.setAttribute('activeCell', 'B2'); selection.setAttribute('sqref', 'B2 B3'); selection.setAttribute('activeCellId', '1'); view.appendChild(selection);
  const parts = new Map(source.parts); parts.set(part, writeWorkbookXml(doc));
  const saved = await readXlsxWorkbook(await patchWorkbookStructure({ ...source, parts }, [{ sheetId: sheet.id, sourceRows: sheet.rowCount, sourceColumns: sheet.columnCount, rows: remove(sheet.rowCount, 1), columns: Array.from({ length: sheet.columnCount }, (_, index) => index) }]));
  const savedView = children(child(xmlPart(saved.parts, part).documentElement!, 'sheetViews')!, 'sheetView')[0]!, selected = children(savedView, 'selection').at(-1)!;
  expect(savedView.getAttribute('topLeftCell')).toBe('B2'); expect(selected.getAttribute('sqref')).toBe('B2'); expect(selected.getAttribute('activeCellId')).toBe('0');
  selection.setAttribute('activeCell', 'D6'); selection.setAttribute('sqref', 'B1 D6'); selection.setAttribute('activeCellId', '1'); parts.set(part, writeWorkbookXml(doc));
  const multiple = await readXlsxWorkbook(await patchWorkbookStructure({ ...source, parts }, [{ sheetId: sheet.id, sourceRows: sheet.rowCount, sourceColumns: sheet.columnCount, rows: remove(sheet.rowCount, 1), columns: Array.from({ length: sheet.columnCount }, (_, index) => index) }]));
  const active = children(children(child(xmlPart(multiple.parts, part).documentElement!, 'sheetViews')!, 'sheetView')[0]!, 'selection').at(-1)!;
  expect(active.getAttribute('sqref')).toBe('B1 D5'); expect(active.getAttribute('activeCell')).toBe('D5'); expect(active.getAttribute('activeCellId')).toBe('1');
});

it('preserves blank editor windows across repeated writes without confusing the reader minimum with source identity', async () => {
  const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('Sparse'); sheet.getCell('A1').value = { formula: 'A50', result: 0 }; sheet.getCell('B2').value = 12;
  let source = await readXlsxWorkbook(Buffer.from(await book.xlsx.writeBuffer()));
  const columns = Array.from({ length: 26 }, (_, index) => index);
  source = await readXlsxWorkbook(await patchWorkbookStructure(source, [{ sheetId: '1', sourceRows: 100, sourceColumns: 26, rows: insert(100, 1), columns }]));
  expect(source.model.sheets[0]!.rowCount).toBe(100); expect(source.model.sheets[0]!.cells.find(cell => cell.formula)?.formula).toBe('=A51');
  source = await readXlsxWorkbook(await patchWorkbookStructure(source, [{ sheetId: '1', sourceRows: 101, sourceColumns: 26, rows: remove(101, 1), columns }]));
  expect(source.model.sheets[0]!.cells.find(cell => cell.formula)?.formula).toBe('=A50');
  source = await readXlsxWorkbook(await patchWorkbookStructure(source, [{ sheetId: '1', sourceRows: 100, sourceColumns: 26, rows: remove(100, 1), columns }]));
  expect(source.model.sheets[0]!.cells.find(cell => cell.formula)?.formula).toBe('=A49');
  source = await readXlsxWorkbook(await patchWorkbookStructure(source, [{ sheetId: '1', sourceRows: 99, sourceColumns: 26, rows: remove(99, 1), columns }]));
  expect(source.model.sheets[0]!.cells.find(cell => cell.formula)?.formula).toBe('=A48');
});
it('recalculates and saves the source-preserving structural intermediate before admitting ordinary final-coordinate edits', async () => {
  const source = await fixture(), sheet = source.model.sheets[0]!;
  expect(source.model.worksheetStructureEditable).toBe(true);
  const prepared = await calculateWorkbookCellEdits(source, [{ sheetId: sheet.id, cell: { row: 2, column: 1, kind: 'number', value: 24, style: sheet.cells.find(cell => cell.row === 1 && cell.column === 1)!.style } }], [], [], [], [{ sheetId: sheet.id, sourceRows: 100, sourceColumns: 26, rows: insert(100, 1), columns: Array.from({ length: 26 }, (_, index) => index) }]);
  expect(prepared.model.sheets[0]!.cells.find(cell => cell.row === 3 && cell.column === 2)).toMatchObject({ formula: '=SUM($B$3:B4)', kind: 'number', value: 24 });
  expect(prepared.model.sheets[1]!.cells[0]).toMatchObject({ formula: '=Budget!$B$3', kind: 'number', value: 24 });
  const independent = new ExcelJS.Workbook(); await independent.xlsx.load(Uint8Array.from(prepared.bytes).buffer); expect(independent.getWorksheet('Budget')!.getCell('C4').result).toBe(24);
});

it('qualifies only bounded executable scalar sources and expands finite referenced cells without trusting authored dimensions', async () => {
  const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('Bounds'); sheet.getCell('A1').value = { formula: 'A101', result: 0 };
  const qualified = await readXlsxWorkbook(Buffer.from(await book.xlsx.writeBuffer()));
  expect(qualified.model.sheets[0]!.rowCount).toBe(101); expect(qualified.model.worksheetStructureEditable).toBe(true);
  for (const formula of ['DOESNOTEXIST(A1)', 'SUM(A:A)', 'IF(TRUE,A2:A3,1)', 'A2:A3+1', 'SEQUENCE(3)', 'A1048576']) {
    sheet.getCell('A1').value = { formula, result: 55 };
    const source = await readXlsxWorkbook(Buffer.from(await book.xlsx.writeBuffer()));
    expect(source.model.worksheetStructureEditable, formula).toBe(false);
    expect(source.model.sheets[0]!.cells.find(cell => cell.formula)?.value, formula).toBe(55);
    await expect(patchWorkbookStructure(source, [{ sheetId: '1', sourceRows: source.model.sheets[0]!.rowCount, sourceColumns: 26, rows: insert(source.model.sheets[0]!.rowCount, 1), columns: Array.from({ length: 26 }, (_, index) => index) }]), formula).rejects.toThrow();
  }
});

it('recalculates structural-only writes before inherited dimensions, formatting or visibility owners skip unnecessary ordinary calculation', async () => {
  const source = await fixture(), sheet = source.model.sheets[0]!;
  const prepared = await calculateWorkbookCellEdits(source, [], [{ sheetId: sheet.id, axis: 'row', index: 1, size: 30 }], [{ sheetId: sheet.id, row: 1, column: 0, bold: true }], [{ sheetId: source.model.sheets[1]!.id, visibility: 'hidden' }], [{ sheetId: sheet.id, sourceRows: 100, sourceColumns: 26, rows: insert(100, 1), columns: Array.from({ length: 26 }, (_, index) => index) }]);
  expect(prepared.model.sheets[0]!.cells.find(cell => cell.formula)).toMatchObject({ formula: '=SUM($B$3:B4)', kind: 'number', value: 12 });
  expect(prepared.model.sheets[1]!.cells[0]).toMatchObject({ formula: '=Budget!$B$3', kind: 'number', value: 12 });
  expect(prepared.model.sheets[1]!.visibility).toBe('hidden');
  expect(prepared.model.sheets[0]!.rowDimensions.find(row => row.index === 1)?.height).toBe(30);
  const independent = new ExcelJS.Workbook(); await independent.xlsx.load(Uint8Array.from(prepared.bytes).buffer); expect(independent.getWorksheet('Budget')!.getCell('C4').result).toBe(12);
});
