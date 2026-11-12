import { expect, it, vi } from 'vitest';
import { functionMath, type BaseFunction } from '@univerjs/engine-formula';
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
const metadataXml = '<metadata xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:xda="http://schemas.microsoft.com/office/spreadsheetml/2017/dynamicarray"><metadataTypes count="1"><metadataType name="XLDAPR" minSupportedVersion="120000" cellMeta="1"/></metadataTypes><futureMetadata name="XLDAPR" count="1"><bk><extLst><ext uri="{BDBB8CDC-FA1E-496E-A857-3C3F30C029C3}"><xda:dynamicArrayProperties fDynamic="1" fCollapsed="0"/></ext></extLst></bk></futureMetadata><cellMetadata count="1"><bk><rc t="1" v="0"/></bk></cellMetadata></metadata>';
async function dynamicFixture() {
  const initial = await fixture('SEQUENCE(A1)'), zip = new JSZip();
  for (const [name, bytes] of initial.parts) zip.file(name, bytes);
  const sheet = 'xl/worksheets/sheet1.xml', rels = 'xl/_rels/workbook.xml.rels';
  zip.file(sheet, (await zip.file(sheet)!.async('string')).replace('r="D3"', 'r="D3" cm="1"'));
  zip.file('xl/metadata.xml', metadataXml);
  zip.file(rels, (await zip.file(rels)!.async('string')).replace('</Relationships>', '<Relationship Id="rIdArrayMetadata" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sheetMetadata" Target="metadata.xml"/></Relationships>'));
  zip.file('[Content_Types].xml', (await zip.file('[Content_Types].xml')!.async('string')).replace('</Types>', '<Override PartName="/xl/metadata.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheetMetadata+xml"/></Types>'));
  return readXlsxWorkbook(await zip.generateAsync({ type: 'nodebuffer' }));
}
it('grows and shrinks an explicitly verified dynamic source array while preserving its metadata and follower styles', async () => {
  const source = await dynamicFixture();
  const grown = await calculateWorkbookCellEdits(source, [{ sheetId: '1', cell: { row: 0, column: 0, kind: 'number', value: 5 } }]);
  let book = new ExcelJS.Workbook(); await book.xlsx.load(Uint8Array.from(grown.bytes).buffer);
  expect(book.worksheets[0]!.getCell('D7').value).toBe(5);
  const grownSource = await readXlsxWorkbook(grown.bytes);
  expect(grownSource.parts.get('xl/metadata.xml')).toEqual(source.parts.get('xl/metadata.xml'));
  const shrunk = await calculateWorkbookCellEdits(grownSource, [{ sheetId: '1', cell: { row: 0, column: 0, kind: 'number', value: 1 } }]);
  book = new ExcelJS.Workbook(); await book.xlsx.load(Uint8Array.from(shrunk.bytes).buffer);
  expect(book.worksheets[0]!.getCell('D3').result).toBe(1);
  expect(book.worksheets[0]!.getCell('D4').value).toBeNull();
  expect(book.worksheets[0]!.getCell('D4').font.italic).toBe(true);
  expect(book.worksheets[0]!.getCell('D7').value).toBeNull();
  expect(book.worksheets[1]!.getCell('A1').result).toBe(100);
  const reopened = await readXlsxWorkbook(shrunk.bytes);
  expect(reopened.model.sheets[0]!.arrayFormulas?.[0]!.range.endRow).toBe(2);
  expect(reopened.parts.get('xl/metadata.xml')).toEqual(source.parts.get('xl/metadata.xml'));
});
it('persists a verified dynamic collision as a genuine spill error and preserves its blocking literal', async () => {
  const initial = await dynamicFixture(), zip = new JSZip();
  for (const [name, bytes] of initial.parts) zip.file(name, bytes);
  const path = 'xl/worksheets/sheet1.xml';
  zip.file(path, (await zip.file(path)!.async('string')).replace('</sheetData>', '<row r="6"><c r="D6"><v>99</v></c></row></sheetData>'));
  const source = await readXlsxWorkbook(await zip.generateAsync({ type: 'nodebuffer' }));
  const { bytes } = await calculateWorkbookCellEdits(source, [{ sheetId: '1', cell: { row: 0, column: 0, kind: 'number', value: 5 } }]);
  const book = new ExcelJS.Workbook(); await book.xlsx.load(Uint8Array.from(bytes).buffer);
  expect(source.model.sheets[0]!.cells.find(cell => cell.row === 5 && cell.column === 3)?.value).toBe(99);
  expect(book.worksheets[0]!.getCell('D6').value).toBe(99);
  expect(book.worksheets[0]!.getCell('D3').result).toEqual({ error: '#SPILL!' });
  expect(book.worksheets[0]!.getCell('D4').value).toBeNull();
  expect(book.worksheets[0]!.getCell('D6').value).toBe(99);
});
it('uses discovery geometry to order a reverse-sheet consumer of a newly grown follower in a fresh final calculation', async () => {
  const initial = await dynamicFixture(), zip = new JSZip();
  for (const [name, bytes] of initial.parts) zip.file(name, bytes);
  const workbook = 'xl/workbook.xml', summary = 'xl/worksheets/sheet2.xml';
  zip.file(workbook, (await zip.file(workbook)!.async('string')).replace(/<sheets>(.*?)<\/sheets>/, (_all, sheets: string) => `<sheets>${sheets.match(/<sheet\b[^>]*\/>/g)!.reverse().join('')}</sheets>`));
  zip.file(summary, (await zip.file(summary)!.async('string')).replace('Inputs!D4+100', 'Inputs!D7+100'));
  const source = await readXlsxWorkbook(await zip.generateAsync({ type: 'nodebuffer' }));
  expect(source.model.sheets[0]!.name).toBe('Summary');
  const { bytes } = await calculateWorkbookCellEdits(source, [{ sheetId: '1', cell: { row: 0, column: 0, kind: 'number', value: 5 } }]);
  const book = new ExcelJS.Workbook(); await book.xlsx.load(Uint8Array.from(bytes).buffer);
  expect(book.getWorksheet('Summary')!.getCell('A1').result).toBe(105);
  expect(book.getWorksheet('Inputs')!.getCell('D7').value).toBe(5);
});
it.each([
  ['cm="1"', 'cm="01"', 'xl/worksheets/sheet1.xml'],
  ['t="1" v="0"', 't="2" v="0"', 'xl/metadata.xml'],
  ['fDynamic="1"', 'fDynamic="0"', 'xl/metadata.xml'],
  ['fCollapsed="0"', 'fCollapsed="1"', 'xl/metadata.xml'],
  ['2017/dynamicarray', '2017/unknown', 'xl/metadata.xml'],
])('refuses unresolved or unsupported dynamic metadata %s → %s', async (before, after, path) => {
  const initial = await dynamicFixture(), zip = new JSZip();
  for (const [name, bytes] of initial.parts) zip.file(name, bytes);
  zip.file(path, (await zip.file(path)!.async('string')).replace(before, after));
  const source = await readXlsxWorkbook(await zip.generateAsync({ type: 'nodebuffer' })), parts = new Map(source.parts);
  await expect(calculateWorkbookCellEdits(source, [{ sheetId: '1', cell: { row: 0, column: 0, kind: 'number', value: 5 } }])).rejects.toMatchObject({ code: 'WORKBOOK_UNSUPPORTED' });
  expect(source.parts).toEqual(parts);
});
it('authors and reuses genuine dynamic ownership for newly entered array formulas, with no browser cache authority', async () => {
  const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('Inputs'), summary = book.addWorksheet('Summary');
  sheet.getCell('A1').value = 10;
  summary.getCell('A1').value = { formula: 'Inputs!D5+100', result: 100 };
  const source = await readXlsxWorkbook(Buffer.from(await book.xlsx.writeBuffer()));
  const created = await calculateWorkbookCellEdits(source, [{ sheetId: '1', cell: { row: 2, column: 3, kind: 'number', value: 987654, formula: '=SEQUENCE(3,1,A1)' } }]);
  const reopened = await readXlsxWorkbook(created.bytes), independent = new ExcelJS.Workbook(); await independent.xlsx.load(Uint8Array.from(created.bytes).buffer);
  expect(independent.worksheets[0]!.getCell('D3').result).toBe(10);
  expect(independent.worksheets[0]!.getCell('D5').value).toBe(12);
  expect(independent.worksheets[1]!.getCell('A1').result).toBe(112);
  expect(reopened.model.sheets[0]!.arrayFormulas).toEqual([{ kind: 'array', row: 2, column: 3, range: { startRow: 2, endRow: 4, startColumn: 3, endColumn: 3 } }]);
  expect(reopened.parts.get('xl/metadata.xml')?.toString()).toContain('name="XLDAPR"');
  const next = await calculateWorkbookCellEdits(reopened, [{ sheetId: '1', cell: { row: 2, column: 5, kind: 'number', value: 7654, formula: '=SEQUENCE(2,1,50)' } }]);
  const twice = await readXlsxWorkbook(next.bytes);
  expect(twice.parts.get('xl/metadata.xml')).toEqual(reopened.parts.get('xl/metadata.xml'));
  expect(twice.model.sheets[0]!.cells.find(cell => cell.row === 3 && cell.column === 5)).toMatchObject({ kind: 'number', value: 51 });
});

it('refuses a real volatile array whose geometry changes between discovery and final calculation', async () => {
  const initial = await dynamicFixture(), zip = new JSZip();
  for (const [name, bytes] of initial.parts) zip.file(name, bytes);
  const path = 'xl/worksheets/sheet1.xml';
  zip.file(path, (await zip.file(path)!.async('string')).replace('SEQUENCE(A1)', 'SEQUENCE(RANDBETWEEN(1,2))'));
  const source = await readXlsxWorkbook(await zip.generateAsync({ type: 'nodebuffer' })), before = new Map(source.parts);
  const constructor = functionMath.find(entry => entry[1] === 'RANDBETWEEN')![0] as { prototype: BaseFunction };
  const calculate = constructor.prototype.calculate;
  let calls = 0;
  const spy = vi.spyOn(constructor.prototype, 'calculate').mockImplementation(function(this: BaseFunction, ...args) {
    const random = vi.spyOn(Math, 'random').mockReturnValue(calls++ < 2 ? 0 : 0.9999);
    try { return calculate.apply(this, args); } finally { random.mockRestore(); }
  });
  try {
    const error = await calculateWorkbookCellEdits(source, [{ sheetId: '1', cell: { row: 0, column: 0, kind: 'number', value: 5 } }]).then(() => undefined, error => error as Error & { code: string });
    expect({ error: error?.message, calls }).toEqual({ error: expect.stringContaining('geometry changed'), calls: 4 });
    expect(source.parts).toEqual(before);
  } finally { spy.mockRestore(); }
});
