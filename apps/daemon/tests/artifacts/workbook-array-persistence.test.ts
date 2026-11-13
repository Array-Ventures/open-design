import { expect, it, vi } from 'vitest';
import { CellValueType } from '@univerjs/core';
import { FWorkbook } from '@univerjs/sheets/facade';
import { functionMath, type BaseFunction } from '@univerjs/engine-formula';
import ExcelJS from 'exceljs-community';
import JSZip from 'jszip';
import { readXlsxWorkbook } from '../../src/artifacts/workbook/reader.js';
import { calculateWorkbookCellEdits } from '../../src/artifacts/workbook/calculated-patch.js';
import { verifiedDynamicArrayOwners } from '../../src/artifacts/workbook/dynamic-array-metadata.js';
import { formulaCellKey } from '../../src/artifacts/workbook/formula-cache-policy.js';

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
  ['http://schemas.openxmlformats.org/officeDocument/2006/relationships/sheetMetadata', 'https://fixture.invalid/sheetMetadata', 'xl/_rels/workbook.xml.rels'],
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
  expect(reopened.model.sheets[0]!.arrayFormulas).toEqual([{ kind: 'array', calculation: 'dynamic', row: 2, column: 3, range: { startRow: 2, endRow: 4, startColumn: 3, endColumn: 3 } }]);
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
it('retires verified dynamic ownership before applying a real follower input in the same batch', async () => {
  const source = await dynamicFixture();
  const { bytes } = await calculateWorkbookCellEdits(source, [
    { sheetId: '1', cell: { row: 2, column: 3, kind: 'blank', value: null } },
    { sheetId: '1', cell: { row: 3, column: 3, kind: 'number', value: 42, style: 1 } },
  ]);
  const book = new ExcelJS.Workbook(); await book.xlsx.load(Uint8Array.from(bytes).buffer);
  expect(book.worksheets[0]!.getCell('D3').value).toBeNull();
  expect(book.worksheets[0]!.getCell('D4').value).toBe(42);
  expect(book.worksheets[0]!.getCell('D4').font.italic).toBe(true);
  expect(book.worksheets[0]!.getCell('D5').value).toBeNull();
  expect(book.worksheets[1]!.getCell('A1').result).toBe(142);
  const reopened = await readXlsxWorkbook(bytes);
  expect(reopened.model.sheets[0]!.arrayFormulas).toEqual([]);
  expect(reopened.parts.get('xl/metadata.xml')).toEqual(source.parts.get('xl/metadata.xml'));
});
it('replaces a verified dynamic owner with a new server-calculated array without retaining old followers or supplied caches', async () => {
  const source = await dynamicFixture();
  const { bytes } = await calculateWorkbookCellEdits(source, [{ sheetId: '1', cell: { row: 2, column: 3, kind: 'number', value: 99999, formula: '=SEQUENCE(2,1,70)' } }]);
  const book = new ExcelJS.Workbook(); await book.xlsx.load(Uint8Array.from(bytes).buffer);
  expect(book.worksheets[0]!.getCell('D3').result).toBe(70);
  expect(book.worksheets[0]!.getCell('D4').value).toBe(71);
  expect(book.worksheets[0]!.getCell('D5').value).toBeNull();
  const reopened = await readXlsxWorkbook(bytes);
  expect(reopened.model.sheets[0]!.arrayFormulas?.[0]!.range.endRow).toBe(3);
  expect(reopened.parts.get('xl/metadata.xml')).toEqual(source.parts.get('xl/metadata.xml'));
  await expect(calculateWorkbookCellEdits(source, [{ sheetId: '1', cell: { row: 2, column: 3, kind: 'number', value: 7777, formula: '=MISSING(A1)' } }])).rejects.toMatchObject({ code: 'WORKBOOK_UNSUPPORTED' });
});
it('refuses direct follower mutation while an unchanged verified owner still owns it', async () => {
  const source = await dynamicFixture(), before = new Map(source.parts);
  await expect(calculateWorkbookCellEdits(source, [{ sheetId: '1', cell: { row: 3, column: 3, kind: 'number', value: 42, style: 1 } }])).rejects.toMatchObject({ code: 'WORKBOOK_UNSUPPORTED' });
  expect(source.parts).toEqual(before);
});
it('keeps a genuine follower input as a blocker when the owner formula changes in the same batch', async () => {
  const source = await dynamicFixture();
  const { bytes } = await calculateWorkbookCellEdits(source, [
    { sheetId: '1', cell: { row: 2, column: 3, kind: 'number', value: 8888, formula: '=SEQUENCE(4)' } },
    { sheetId: '1', cell: { row: 3, column: 3, kind: 'number', value: 42, style: 1 } },
  ]);
  const book = new ExcelJS.Workbook(); await book.xlsx.load(Uint8Array.from(bytes).buffer);
  expect(book.worksheets[0]!.getCell('D3').result).toEqual({ error: '#SPILL!' });
  expect(book.worksheets[0]!.getCell('D4').value).toBe(42);
  expect(book.worksheets[0]!.getCell('D5').value).toBeNull();
  expect(book.worksheets[1]!.getCell('A1').result).toBe(142);
});
it('grows beyond the imported used geometry without treating the viewport as an Excel boundary', async () => {
  const source = await dynamicFixture(); expect(source.model.sheets[0]!.rowCount).toBe(100);
  const { bytes } = await calculateWorkbookCellEdits(source, [{ sheetId: '1', cell: { row: 0, column: 0, kind: 'number', value: 200 } }]);
  const book = new ExcelJS.Workbook(); await book.xlsx.load(Uint8Array.from(bytes).buffer);
  expect(book.worksheets[0]!.getCell('D3').result).toBe(1);
  expect(book.worksheets[0]!.getCell('D202').value).toBe(200);
  const reopened = await readXlsxWorkbook(bytes);
  expect(reopened.model.sheets[0]!.rowCount).toBeGreaterThanOrEqual(202);
});

it('preserves unsupported spill-reference evidence against a genuinely recalculated owned source array', async () => {
  const initial = await dynamicFixture(), zip = new JSZip();
  for (const [name, bytes] of initial.parts) zip.file(name, bytes);
  const path = 'xl/worksheets/sheet2.xml';
  zip.file(path, (await zip.file(path)!.async('string')).replace('Inputs!D4+100', 'SUM(Inputs!D3#)'));
  const source = await readXlsxWorkbook(await zip.generateAsync({ type: 'nodebuffer' }));
  const { bytes } = await calculateWorkbookCellEdits(source, [{ sheetId: '1', cell: { row: 0, column: 0, kind: 'number', value: 3 } }]);
  const book = new ExcelJS.Workbook(); await book.xlsx.load(Uint8Array.from(bytes).buffer);
  expect(book.worksheets[0]!.getCell('D5').value).toBe(3);
  expect(book.worksheets[1]!.getCell('A1').result).toBe(111);
});
it('orders reverse-sheet whole-axis consumers after growth beyond the old used extent', async () => {
  const initial = await dynamicFixture(), zip = new JSZip();
  for (const [name, bytes] of initial.parts) zip.file(name, bytes);
  const workbook = 'xl/workbook.xml', summary = 'xl/worksheets/sheet2.xml';
  zip.file(workbook, (await zip.file(workbook)!.async('string')).replace(/<sheets>(.*?)<\/sheets>/, (_all, sheets: string) => `<sheets>${sheets.match(/<sheet\b[^>]*\/>/g)!.reverse().join('')}</sheets>`));
  zip.file(summary, (await zip.file(summary)!.async('string')).replace('Inputs!D4+100', 'SUM(Inputs!202:202)').replace('</row>', '<c r="B1"><f>SUM(Inputs!D:D)</f><v>112</v></c></row>'));
  const source = await readXlsxWorkbook(await zip.generateAsync({ type: 'nodebuffer' }));
  expect(source.model.sheets[0]!.name).toBe('Summary');
  const { bytes } = await calculateWorkbookCellEdits(source, [{ sheetId: '1', cell: { row: 0, column: 0, kind: 'number', value: 200 } }]);
  const book = new ExcelJS.Workbook(); await book.xlsx.load(Uint8Array.from(bytes).buffer);
  expect(book.getWorksheet('Inputs')!.getCell('D202').value).toBe(200);
  expect(book.getWorksheet('Summary')!.getCell('A1').result).toBe(200);
  expect(book.getWorksheet('Summary')!.getCell('B1').result).toBe(20100);
});
it('calculates a one-cell fixed array without inventing dynamic metadata or clearing outside literals', async () => {
  const initial = await fixture('SUM(A1)'), zip = new JSZip();
  for (const [name, bytes] of initial.parts) zip.file(name, bytes);
  const path = 'xl/worksheets/sheet1.xml'; zip.file(path, (await zip.file(path)!.async('string')).replace('ref="D3:D5"', 'ref="D3:D3"'));
  const source = await readXlsxWorkbook(await zip.generateAsync({ type: 'nodebuffer' }));
  const { bytes } = await calculateWorkbookCellEdits(source, [{ sheetId: '1', cell: { row: 0, column: 0, kind: 'number', value: 20 } }]);
  const book = new ExcelJS.Workbook(); await book.xlsx.load(Uint8Array.from(bytes).buffer);
  expect(book.worksheets[0]!.getCell('D3').result).toBe(20); expect(book.worksheets[0]!.getCell('D4').value).toBe(11);
  expect((await readXlsxWorkbook(bytes)).parts.has('xl/metadata.xml')).toBe(false);
});
it('returns the independently reopened model including inherited row formatting on new followers', async () => {
  const initial = await dynamicFixture(), zip = new JSZip();
  for (const [name, bytes] of initial.parts) zip.file(name, bytes);
  const path = 'xl/worksheets/sheet1.xml';
  zip.file(path, (await zip.file(path)!.async('string')).replace('</sheetData>', '<row r="6" s="1" customFormat="true"/></sheetData>'));
  const source = await readXlsxWorkbook(await zip.generateAsync({ type: 'nodebuffer' }));
  const { bytes, model } = await calculateWorkbookCellEdits(source, [{ sheetId: '1', cell: { row: 0, column: 0, kind: 'number', value: 5 } }]);
  const reopened = await readXlsxWorkbook(bytes); expect(model).toEqual(reopened.model);
  const cell = model.sheets[0]!.cells.find(cell => cell.row === 5 && cell.column === 3)!;
  expect(cell.value).toBe(4);
  const row = model.sheets[0]!.rowDimensions.find(row => row.index === 5)!;
  expect(model.styles[cell.style ?? row.style!]?.font?.italic).toBe(true);
  const saved = await JSZip.loadAsync(bytes), rowXml = (await saved.file(path)!.async('string')).match(/<row r="6"[^>]*>/)?.[0];
  expect(rowXml).toContain('customFormat="true"'); expect(rowXml).toContain('s="1"');
  expect(reopened.parts.get('xl/styles.xml')).toEqual(source.parts.get('xl/styles.xml'));
});

it('refuses a newly discovered array whose owner disappears in the fresh final calculation', async () => {
  const book = new ExcelJS.Workbook(); book.addWorksheet('Inputs').getCell('A1').value = 1;
  const source = await readXlsxWorkbook(Buffer.from(await book.xlsx.writeBuffer())), before = new Map(source.parts);
  const constructor = functionMath.find(entry => entry[1] === 'RANDBETWEEN')![0] as { prototype: BaseFunction }, calculate = constructor.prototype.calculate;
  let calls = 0;
  const spy = vi.spyOn(constructor.prototype, 'calculate').mockImplementation(function(this: BaseFunction, ...args) {
    const random = vi.spyOn(Math, 'random').mockReturnValue(calls++ < 2 ? 0 : 0.9999);
    try { return calculate.apply(this, args); } finally { random.mockRestore(); }
  });
  try {
    const error = await calculateWorkbookCellEdits(source, [{ sheetId: '1', cell: { row: 2, column: 3, kind: 'number', value: 99999, formula: '=IF(RANDBETWEEN(0,1)=0,SEQUENCE(2),42)' } }]).then(() => undefined, error => error as Error);
    expect({ error: error?.message, calls }).toEqual({ error: expect.stringContaining('owner set changed'), calls: 3 });
    expect(source.parts).toEqual(before);
  } finally { spy.mockRestore(); }
});

it('does not mistake a computed #SPILL! string for an error when an empty-string input is not a real engine blocker', async () => {
  const initial = await dynamicFixture(), zip = new JSZip();
  for (const [name, bytes] of initial.parts) zip.file(name, bytes);
  const path = 'xl/worksheets/sheet1.xml';
  zip.file(path, (await zip.file(path)!.async('string')).replace('SEQUENCE(A1)', 'IF(SEQUENCE(A1)=1,"#SPILL!",99)').replace('</sheetData>', '<row r="6"><c r="D6" t="str"><v></v></c></row></sheetData>'));
  const source = await readXlsxWorkbook(await zip.generateAsync({ type: 'nodebuffer' })), before = new Map(source.parts), save = vi.spyOn(FWorkbook.prototype, 'save');
  try {
    await expect(calculateWorkbookCellEdits(source, [{ sheetId: '1', cell: { row: 0, column: 0, kind: 'number', value: 4 } }])).rejects.toMatchObject({ code: 'WORKBOOK_UNSUPPORTED', message: expect.stringContaining('Empty-string') });
    const types = save.mock.results.filter(result => result.type === 'return').map(result => result.value.sheets['1']?.cellData?.[2]?.[3]).filter(cell => cell?.v === '#SPILL!').map(cell => cell?.t);
    expect(types).toContain(CellValueType.FORCE_STRING); expect(source.parts).toEqual(before);
  } finally { save.mockRestore(); }
});

it('persists an actual #SPILL! string array as text, with followers, rather than inventing an error', async () => {
  const initial = await dynamicFixture(), zip = new JSZip();
  for (const [name, bytes] of initial.parts) zip.file(name, bytes);
  const path = 'xl/worksheets/sheet1.xml';
  zip.file(path, (await zip.file(path)!.async('string')).replace('SEQUENCE(A1)', 'IF(SEQUENCE(A1)=1,"#SPILL!",99)'));
  const source = await readXlsxWorkbook(await zip.generateAsync({ type: 'nodebuffer' }));
  const { bytes } = await calculateWorkbookCellEdits(source, [{ sheetId: '1', cell: { row: 0, column: 0, kind: 'number', value: 4 } }]);
  const book = new ExcelJS.Workbook(); await book.xlsx.load(Uint8Array.from(bytes).buffer);
  expect(book.worksheets[0]!.getCell('D3').result).toBe('#SPILL!'); expect(book.worksheets[0]!.getCell('D6').value).toBe(99);
  expect((await readXlsxWorkbook(bytes)).model.sheets[0]!.cells.find(cell => cell.row === 2 && cell.column === 3)).toMatchObject({ kind: 'string', value: '#SPILL!' });
});
it('keeps a new ordinary one-cell reference ordinary instead of inventing array ownership', async () => {
  const book = new ExcelJS.Workbook(); book.addWorksheet('Inputs').getCell('A1').value = 7;
  const source = await readXlsxWorkbook(Buffer.from(await book.xlsx.writeBuffer()));
  const { bytes, model } = await calculateWorkbookCellEdits(source, [{ sheetId: '1', cell: { row: 0, column: 1, kind: 'number', value: 9999, formula: '=A1' } }]);
  expect(model.sheets[0]!.arrayFormulas).toEqual([]); expect((await readXlsxWorkbook(bytes)).parts.has('xl/metadata.xml')).toBe(false);
  expect(model.sheets[0]!.cells.find(cell => cell.row === 0 && cell.column === 1)).toMatchObject({ formula: '=A1', kind: 'number', value: 7 });
});
it('keeps genuine one-cell array identity so an initially single-cell SEQUENCE can later grow', async () => {
  const book = new ExcelJS.Workbook(); book.addWorksheet('Inputs').getCell('A1').value = 1;
  const source = await readXlsxWorkbook(Buffer.from(await book.xlsx.writeBuffer()));
  const first = await calculateWorkbookCellEdits(source, [{ sheetId: '1', cell: { row: 0, column: 1, kind: 'number', value: 9999, formula: '=SEQUENCE(A1)' } }]);
  const single = await readXlsxWorkbook(first.bytes);
  expect(single.model.sheets[0]!.arrayFormulas).toHaveLength(1);
  const next = await calculateWorkbookCellEdits(single, [{ sheetId: '1', cell: { row: 0, column: 0, kind: 'number', value: 3 } }]);
  const independent = new ExcelJS.Workbook(); await independent.xlsx.load(Uint8Array.from(next.bytes).buffer);
  expect(independent.worksheets[0]!.getCell('B3').value).toBe(3);
  expect((await readXlsxWorkbook(next.bytes)).parts.get('xl/metadata.xml')).toEqual(single.parts.get('xl/metadata.xml'));
});
it('creates array follower caches before an opaque row extension even without scalar edits', async () => {
  const initial = await fixture('SEQUENCE(1,2,A1)'), zip = new JSZip();
  for (const [name, bytes] of initial.parts) zip.file(name, bytes);
  const path = 'xl/worksheets/sheet1.xml', extension = '<extLst><ext uri="urn:test:row"><x:opaque xmlns:x="urn:test:opaque" marker="keep"/></ext></extLst>';
  zip.file(path, (await zip.file(path)!.async('string')).replace('ref="D3:D5"', 'ref="D3:E3"').replace(/(<row r="3"[^>]*>.*?)(<\/row>)/, `$1${extension}$2`));
  const source = await readXlsxWorkbook(await zip.generateAsync({ type: 'nodebuffer' }));
  const { bytes } = await calculateWorkbookCellEdits(source, []), saved = await JSZip.loadAsync(bytes);
  const row = (await saved.file(path)!.async('string')).match(/<row r="3"[^>]*>(.*?)<\/row>/)![1]!;
  expect(row.indexOf('r="E3"')).toBeLessThan(row.indexOf('<extLst>')); expect(row).toContain(extension);
  const independent = new ExcelJS.Workbook(); await independent.xlsx.load(Uint8Array.from(bytes).buffer);
  expect(independent.worksheets[0]!.getCell('E3').value).toBe(11);
});
it('preserves actual blank array members distinctly from numeric zero and a scalar empty-cell reference', async () => {
  const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('Inputs'), summary = book.addWorksheet('Summary');
  sheet.getCell('A1').value = 1; sheet.getCell('A3').value = 3;
  summary.getCell('A1').value = { formula: 'Inputs!E2+10', result: 100 };
  const source = await readXlsxWorkbook(Buffer.from(await book.xlsx.writeBuffer()));
  const { bytes, model } = await calculateWorkbookCellEdits(source, [
    { sheetId: '1', cell: { row: 0, column: 4, kind: 'number', value: 9999, formula: '=A1:A3' } },
    { sheetId: '1', cell: { row: 0, column: 5, kind: 'number', value: 9999, formula: '=A2' } },
  ]);
  const independent = new ExcelJS.Workbook(); await independent.xlsx.load(Uint8Array.from(bytes).buffer);
  expect(independent.worksheets[0]!.getCell('E2').value).toBeNull(); expect(independent.worksheets[0]!.getCell('E3').value).toBe(3);
  expect(independent.worksheets[0]!.getCell('F1').result).toBe(0); expect(independent.worksheets[1]!.getCell('A1').result).toBe(10);
  expect(model.sheets[0]!.cells.find(cell => cell.row === 1 && cell.column === 4)).toMatchObject({ kind: 'blank', value: null });
  expect(model.sheets[0]!.arrayFormulas).toHaveLength(1);
});
it('refuses overlapping array candidates without changing source ownership or caches', async () => {
  const source = await dynamicFixture(), before = new Map(source.parts);
  await expect(calculateWorkbookCellEdits(source, [{ sheetId: '1', cell: { row: 2, column: 2, kind: 'number', value: 99999, formula: '=SEQUENCE(3,2)' } }])).rejects.toMatchObject({ code: 'WORKBOOK_UNSUPPORTED', message: expect.stringContaining('Overlapping') });
  expect(source.parts).toEqual(before);
});
it('bounds the number of new array owners before metadata authoring', async () => {
  const book = new ExcelJS.Workbook(); book.addWorksheet('Inputs').getCell('A1').value = 1;
  const source = await readXlsxWorkbook(Buffer.from(await book.xlsx.writeBuffer())), before = new Map(source.parts);
  const edits = Array.from({ length: 4097 }, (_, index) => ({ sheetId: '1', cell: { row: 0, column: index + 1, kind: 'number' as const, value: 99999, formula: '=SEQUENCE(1)' } }));
  await expect(calculateWorkbookCellEdits(source, edits)).rejects.toMatchObject({ code: 'WORKBOOK_LIMIT' }); expect(source.parts).toEqual(before);
});
it('writes new reference-array ownership when the anchor remains blank and preserves unrelated package parts', async () => {
  const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('Inputs');
  sheet.getCell('A2').value = 2; sheet.getCell('A3').value = 3;
  book.addWorksheet('Unrelated').getCell('A1').value = 'keep';
  const zip = await JSZip.loadAsync(await book.xlsx.writeBuffer());
  zip.file('customXml/opaque.xml', '<opaque xmlns="urn:test:preserved" value="keep"/>');
  const source = await readXlsxWorkbook(await zip.generateAsync({ type: 'nodebuffer' }));
  const { bytes, model } = await calculateWorkbookCellEdits(source, [{ sheetId: '1', cell: { row: 0, column: 4, kind: 'number', value: 987654, formula: '=A1:A3' } }]);
  const reopened = await readXlsxWorkbook(bytes);
  expect(model).toEqual(reopened.model);
  expect(model.sheets[0]!.arrayFormulas).toEqual([{ kind: 'array', calculation: 'dynamic', row: 0, column: 4, range: { startRow: 0, endRow: 2, startColumn: 4, endColumn: 4 } }]);
  expect(model.sheets[0]!.cells.find(cell => cell.row === 0 && cell.column === 4)).toMatchObject({ formula: '=A1:A3', kind: 'blank', value: null });
  const saved = await JSZip.loadAsync(bytes), xml = await saved.file('xl/worksheets/sheet1.xml')!.async('string');
  const anchor = xml.match(/<c\b[^>]*\br="E1"[^>]*>.*?<\/c>/)![0]!;
  expect(anchor).toContain('cm="1"'); expect(anchor).toContain('<f t="array" ref="E1:E3">A1:A3</f>'); expect(anchor).not.toMatch(/<v(?:\s|\/|>)/);
  expect(verifiedDynamicArrayOwners(reopened)).toEqual(new Set([formulaCellKey('1', 0, 4)]));
  const independent = new ExcelJS.Workbook(); await independent.xlsx.load(Uint8Array.from(bytes).buffer);
  expect(independent.worksheets[0]!.getCell('E1').formula).toBe('A1:A3'); expect(independent.worksheets[0]!.getCell('E1').result).toBeUndefined();
  expect(independent.worksheets[0]!.getCell('E2').value).toBe(2); expect(independent.worksheets[0]!.getCell('E3').value).toBe(3);
  const changed = new Set(['xl/worksheets/sheet1.xml', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', '[Content_Types].xml']);
  for (const [name, part] of source.parts) if (!changed.has(name)) expect(reopened.parts.get(name), name).toEqual(part);
});
