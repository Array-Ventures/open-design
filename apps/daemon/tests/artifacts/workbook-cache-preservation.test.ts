import { expect, it } from 'vitest';
import ExcelJS from 'exceljs-community';
import JSZip from 'jszip';
import { readXlsxWorkbook } from '../../src/artifacts/workbook/reader.js';
import { calculateWorkbookCellEdits } from '../../src/artifacts/workbook/calculated-patch.js';
import { parseWorkbookXml, writeWorkbookXml } from '../../src/artifacts/workbook/xml.js';
import { address, child, children, xmlPart } from '../../src/artifacts/workbook/parts.js';
async function fixture() {
  const book = new ExcelJS.Workbook(), inputs = book.addWorksheet('Inputs'), summary = book.addWorksheet('Summary');
  inputs.getCell('A1').value = 2;
  inputs.getCell('B1').value = { formula: 'DOESNOTEXIST(A1)', result: 55 };
  inputs.getCell('C1').value = { formula: 'B1+1', result: 56 };
  inputs.getCell('D1').value = { formula: 'IFERROR(B1,999)', result: 57 };
  inputs.getCell('E1').value = { formula: 'A1*2', result: 4 };
  inputs.getCell('F1').value = { formula: 'ISO.CEILING(A1)', result: 72 };
  summary.getCell('A1').value = { formula: 'Inputs!C1*2', result: 112 };
  summary.getCell('B1').value = { formula: 'A1+1', result: 113 };
  return readXlsxWorkbook(Buffer.from(await book.xlsx.writeBuffer()));
}
it('preserves genuine unsupported caches and their masked/cross-sheet dependents while recalculating independent branches', async () => {
  const source = await fixture();
  const { bytes } = await calculateWorkbookCellEdits(source, [{ sheetId: '1', cell: { row: 0, column: 0, kind: 'number', value: 3 } }]);
  const independent = new ExcelJS.Workbook(); await independent.xlsx.load(Uint8Array.from(bytes).buffer);
  expect(independent.getWorksheet('Inputs')!.getCell('B1').value).toEqual({ formula: 'DOESNOTEXIST(A1)', result: 55 });
  expect(independent.getWorksheet('Inputs')!.getCell('C1').result).toBe(56);
  expect(independent.getWorksheet('Inputs')!.getCell('D1').result).toBe(57);
  expect(independent.getWorksheet('Inputs')!.getCell('F1').result).toBe(72);
  expect(independent.getWorksheet('Inputs')!.getCell('E1').result).toBe(6);
  expect(independent.getWorksheet('Summary')!.getCell('A1').result).toBe(112);
  expect(independent.getWorksheet('Summary')!.getCell('B1').result).toBe(113);
  const reopened = await readXlsxWorkbook(bytes);
  for (const [sheetId, part] of source.sheetParts) {
    const before = xmlPart(source.parts, part), after = xmlPart(reopened.parts, part);
    const cells = (document: typeof before) => children(child(document.documentElement!, 'sheetData')!, 'row').flatMap(row => children(row, 'c'));
    const saved = new Map(cells(after).map(cell => [cell.getAttribute('r'), cell]));
    for (const cell of cells(before)) if (child(cell, 'f') && !(sheetId === '1' && address(cell.getAttribute('r')!).column === 4)) expect(saved.get(cell.getAttribute('r'))?.toString()).toBe(cell.toString());
  }
});

it.each([
  { row: 0, column: 1, formula: '=DOESNOTEXIST(A1)+1' },
  { row: 0, column: 2, formula: '=B1+2' },
  { row: 0, column: 6, formula: '=MISSING(A1)' },
])('rejects a changed/new unsupported formula or dependent at $column without using a supplied cache', async position => {
  const source = await fixture(), before = new Map(source.parts);
  await expect(calculateWorkbookCellEdits(source, [{ sheetId: '1', cell: { ...position, kind: 'number', value: 987654 } }])).rejects.toMatchObject({ code: 'WORKBOOK_UNSUPPORTED', message: expect.stringContaining('new or changed unsupported') });
  expect(source.parts).toEqual(before);
});
it('calculates a genuinely supported replacement instead of retaining its unrelated old unsupported cache', async () => {
  const source = await fixture();
  const { bytes } = await calculateWorkbookCellEdits(source, [{ sheetId: '1', cell: { row: 0, column: 1, kind: 'number', value: 987654, formula: '=A1*10' } }]);
  const book = new ExcelJS.Workbook(); await book.xlsx.load(Uint8Array.from(bytes).buffer);
  expect(book.getWorksheet('Inputs')!.getCell('B1').result).toBe(20); expect(book.getWorksheet('Inputs')!.getCell('C1').result).toBe(21);
  expect(book.getWorksheet('Summary')!.getCell('A1').result).toBe(42);
});
it('keeps an unchanged cacheless unsupported formula cacheless while preserving its dependent source cache', async () => {
  const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('Inputs'); sheet.getCell('A1').value = 2;
  sheet.getCell('B1').value = { formula: 'MISSING(A1)' }; sheet.getCell('C1').value = { formula: 'IFERROR(B1,999)', result: 56 }; sheet.getCell('D1').value = { formula: 'A1*2', result: 4 };
  const source = await readXlsxWorkbook(Buffer.from(await book.xlsx.writeBuffer()));
  const { bytes, model } = await calculateWorkbookCellEdits(source, [{ sheetId: '1', cell: { row: 0, column: 0, kind: 'number', value: 3 } }]);
  const independent = new ExcelJS.Workbook(); await independent.xlsx.load(Uint8Array.from(bytes).buffer);
  expect(independent.worksheets[0]!.getCell('B1').result).toBeUndefined(); expect(independent.worksheets[0]!.getCell('C1').result).toBe(56); expect(independent.worksheets[0]!.getCell('D1').result).toBe(6);
  expect(model.sheets[0]!.cells.find(cell => cell.column === 1)).toMatchObject({ kind: 'blank', value: null, formula: '=MISSING(A1)' });
});
it('keeps genuine NAME errors and error-looking strings typed instead of treating error text as an unsupported function', async () => {
  const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('Errors'); sheet.getCell('A1').value = { error: '#NAME?' };
  sheet.getCell('B1').value = { formula: 'IFERROR(A1,99)', result: 1 };
  sheet.getCell('C1').value = { formula: '"#NAME?"', result: 'old' };
  sheet.getCell('D1').value = { formula: 'IFERROR(C1,999)', result: 'old' };
  sheet.getCell('E1').value = { formula: '#NAME?', result: 1 };
  sheet.getCell('F1').value = { formula: 'IFERROR(E1,777)', result: 1 };
  sheet.getCell('G1').value = { formula: 'FALSE', result: true };
  const source = await readXlsxWorkbook(Buffer.from(await book.xlsx.writeBuffer())), { bytes } = await calculateWorkbookCellEdits(source, []);
  const independent = new ExcelJS.Workbook(); await independent.xlsx.load(Uint8Array.from(bytes).buffer); const saved = independent.worksheets[0]!;
  expect(saved.getCell('B1').result).toBe(99); expect(saved.getCell('C1').result).toBe('#NAME?'); expect(saved.getCell('D1').result).toBe('#NAME?');
  expect(saved.getCell('E1').result).toEqual({ error: '#NAME?' }); expect(saved.getCell('F1').result).toBe(777); expect(saved.getCell('G1').result).toBe(false);
});
it('preserves dependency closure through a real bound name while supported qualified names still calculate', async () => {
  const book = new ExcelJS.Workbook(), inputs = book.addWorksheet('Inputs'), summary = book.addWorksheet('Summary'); inputs.getCell('A1').value = 2;
  inputs.getCell('B1').value = { formula: 'MISSING(A1)', result: 55 }; book.definedNames.add('Inputs!$B$1', 'LimitedRange'); book.definedNames.add('Inputs!$A$1', 'SupportedRange');
  summary.getCell('A1').value = { formula: 'SUM(LimitedRange)', result: 56 }; summary.getCell('B1').value = { formula: "'Inputs'!SupportedRange*2", result: 4 };
  const source = await readXlsxWorkbook(Buffer.from(await book.xlsx.writeBuffer())), { bytes } = await calculateWorkbookCellEdits(source, [{ sheetId: '1', cell: { row: 0, column: 0, kind: 'number', value: 3 } }]);
  const independent = new ExcelJS.Workbook(); await independent.xlsx.load(Uint8Array.from(bytes).buffer);
  expect(independent.getWorksheet('Summary')!.getCell('A1').result).toBe(56); expect(independent.getWorksheet('Summary')!.getCell('B1').result).toBe(6);
});
it('keeps unaffected shared formula XML and expands only a shared group touched by a formula edit', async () => {
  const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('Shared'); sheet.getCell('A1').value = 2; sheet.getCell('A2').value = 3;
  sheet.fillFormula('B1:B2', 'MISSING(A1)', [55, 56]);
  sheet.getCell('C1').value = { formula: 'A1*2', result: 4 };
  const source = await readXlsxWorkbook(Buffer.from(await book.xlsx.writeBuffer()));
  const first = await calculateWorkbookCellEdits(source, [{ sheetId: '1', cell: { row: 0, column: 0, kind: 'number', value: 4 } }]);
  const original = xmlPart(source.parts, 'xl/worksheets/sheet1.xml'), changed = xmlPart((await readXlsxWorkbook(first.bytes)).parts, 'xl/worksheets/sheet1.xml');
  const shared = (doc: typeof original) => children(child(doc.documentElement!, 'sheetData')!, 'row').flatMap(row => children(row, 'c')).filter(cell => cell.getAttribute('r')?.startsWith('B')).map(cell => cell.toString());
  expect(shared(changed)).toEqual(shared(original));
  const second = await calculateWorkbookCellEdits(source, [{ sheetId: '1', cell: { row: 0, column: 1, kind: 'blank', value: null, formula: '=A1*3' } }]);
  const independent = new ExcelJS.Workbook(); await independent.xlsx.load(Uint8Array.from(second.bytes).buffer);
  expect(independent.worksheets[0]!.getCell('B1').result).toBe(6); expect(independent.worksheets[0]!.getCell('B2').formula).toBe('MISSING(A2)'); expect(independent.worksheets[0]!.getCell('B2').result).toBe(56);
});

it('preserves an unsupported function inside an actual defined-name expression and its dependent closure', async () => {
  const book = new ExcelJS.Workbook(), inputs = book.addWorksheet('Inputs'), summary = book.addWorksheet('Summary'); inputs.getCell('A1').value = 2;
  book.definedNames.add('Inputs!$A$1', 'Seed');
  summary.getCell('A1').value = { formula: 'LimitedName+1', result: 56 }; summary.getCell('A2').value = { formula: 'IFERROR(A1,999)', result: 57 };
  summary.getCell('B1').value = { formula: 'SUM(Seed)', result: 2 };
  const zip = await JSZip.loadAsync(await book.xlsx.writeBuffer()), main = parseWorkbookXml(Buffer.from(await zip.file('xl/workbook.xml')!.async('uint8array')));
  const node = main.createElementNS(main.documentElement!.namespaceURI, 'definedName'); node.setAttribute('name', 'LimitedName'); node.appendChild(main.createTextNode('=MISSING(Inputs!A1)'));
  child(main.documentElement!, 'definedNames')!.appendChild(node); zip.file('xl/workbook.xml', writeWorkbookXml(main));
  const source = await readXlsxWorkbook(await zip.generateAsync({ type: 'nodebuffer' }));
  const { bytes } = await calculateWorkbookCellEdits(source, [{ sheetId: '1', cell: { row: 0, column: 0, kind: 'number', value: 3 } }]);
  const independent = new ExcelJS.Workbook(); await independent.xlsx.load(Uint8Array.from(bytes).buffer);
  expect(independent.getWorksheet('Summary')!.getCell('A1').result).toBe(56); expect(independent.getWorksheet('Summary')!.getCell('A2').result).toBe(57); expect(independent.getWorksheet('Summary')!.getCell('B1').result).toBe(3);
});
it('retains the existing whole-save refusal for external-link packages', async () => {
  const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('Inputs'); sheet.getCell('A1').value = 2;
  const zip = await JSZip.loadAsync(await book.xlsx.writeBuffer());
  zip.file('xl/externalLinks/externalLink1.xml', '<externalLink xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><externalBook><sheetNames><sheetName val="Remote"/></sheetNames></externalBook></externalLink>');
  const source = await readXlsxWorkbook(await zip.generateAsync({ type: 'nodebuffer' })); expect(source.model.features.externalLinks).toBe(1);
  await expect(calculateWorkbookCellEdits(source, [{ sheetId: '1', cell: { row: 0, column: 0, kind: 'number', value: 3 } }])).rejects.toMatchObject({ code: 'WORKBOOK_UNSUPPORTED', message: expect.stringContaining('External reference') });
});

it('ignores supplied caches for unchanged formula identities and keeps retained source cells exact', async () => {
  const source = await fixture();
  const { bytes } = await calculateWorkbookCellEdits(source, [
    { sheetId: '1', cell: { row: 0, column: 1, kind: 'number', value: 987654, formula: '=DOESNOTEXIST(A1)' } },
    { sheetId: '1', cell: { row: 0, column: 4, kind: 'number', value: 987654, formula: '=A1*2' } },
  ]);
  const independent = new ExcelJS.Workbook(); await independent.xlsx.load(Uint8Array.from(bytes).buffer);
  expect(independent.getWorksheet('Inputs')!.getCell('B1').result).toBe(55); expect(independent.getWorksheet('Inputs')!.getCell('E1').result).toBe(4);
});
it('preserves limited closure through table references while recalculating independent table-workbook formulas', async () => {
  const book = new ExcelJS.Workbook(), inputs = book.addWorksheet('Inputs'), summary = book.addWorksheet('Summary'); inputs.getCell('A1').value = 2;
  inputs.addTable({ name: 'Sales', ref: 'C4', headerRow: true, columns: [{ name: 'Amount' }], rows: [[{ formula: 'MISSING(A1)', result: 55 }], [5]] });
  summary.getCell('A1').value = { formula: 'SUM(Sales[Amount])', result: 60 }; summary.getCell('B1').value = { formula: 'Inputs!A1*2', result: 4 };
  const source = await readXlsxWorkbook(Buffer.from(await book.xlsx.writeBuffer()));
  const { bytes } = await calculateWorkbookCellEdits(source, [{ sheetId: '1', cell: { row: 0, column: 0, kind: 'number', value: 3 } }]);
  const independent = new ExcelJS.Workbook(); await independent.xlsx.load(Uint8Array.from(bytes).buffer);
  expect(independent.getWorksheet('Summary')!.getCell('A1').result).toBe(60); expect(independent.getWorksheet('Summary')!.getCell('B1').result).toBe(6);
});

it.each([false, 0, '#NAME?', { error: '#VALUE!' as const }])('retains the exact typed source cache %j for an unsupported formula', async result => {
  const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('Typed'); sheet.getCell('A1').value = 2;
  sheet.getCell('B1').value = { formula: 'MISSING(A1)', result };
  const source = await readXlsxWorkbook(Buffer.from(await book.xlsx.writeBuffer()));
  const { bytes } = await calculateWorkbookCellEdits(source, [{ sheetId: '1', cell: { row: 0, column: 0, kind: 'number', value: 3 } }]);
  const independent = new ExcelJS.Workbook(); await independent.xlsx.load(Uint8Array.from(bytes).buffer);
  expect(independent.worksheets[0]!.getCell('B1').result).toEqual(result);
});
it('distinguishes an actual empty string cache from absence of a cache', async () => {
  const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('Empty'); sheet.getCell('A1').value = 2;
  sheet.getCell('B1').value = { formula: 'MISSING(A1)', result: 'old' }; sheet.getCell('C1').value = { formula: 'MISSING(A1)' };
  const zip = await JSZip.loadAsync(await book.xlsx.writeBuffer());
  const document = parseWorkbookXml(Buffer.from(await zip.file('xl/worksheets/sheet1.xml')!.async('uint8array')));
  const b = children(children(child(document.documentElement!, 'sheetData')!, 'row')[0]!, 'c').find(cell => cell.getAttribute('r') === 'B1')!;
  child(b, 'v')!.textContent = ''; b.setAttribute('t', 'str'); zip.file('xl/worksheets/sheet1.xml', writeWorkbookXml(document));
  const source = await readXlsxWorkbook(await zip.generateAsync({ type: 'nodebuffer' }));
  const { bytes, model } = await calculateWorkbookCellEdits(source, [{ sheetId: '1', cell: { row: 0, column: 0, kind: 'number', value: 3 } }]);
  expect(model.sheets[0]!.cells.find(cell => cell.column === 1)).toMatchObject({ kind: 'string', value: '' });
  expect(model.sheets[0]!.cells.find(cell => cell.column === 2)).toMatchObject({ kind: 'blank', value: null });
  const output = xmlPart((await readXlsxWorkbook(bytes)).parts, 'xl/worksheets/sheet1.xml');
  const saved = children(children(child(output.documentElement!, 'sheetData')!, 'row')[0]!, 'c').find(cell => cell.getAttribute('r') === 'B1')!;
  expect(saved.toString()).toBe(b.toString());
});

it('refuses the pinned non-scalar ambiguity between a table name and an unsupported call', async () => {
  const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('Collision'); sheet.getCell('A1').value = 2;
  sheet.addTable({ name: 'MISSING', ref: 'D4', headerRow: true, columns: [{ name: 'Amount' }], rows: [[1], [2]] });
  sheet.getCell('B1').value = { formula: 'MISSING(A1)', result: 55 }; sheet.getCell('C1').value = { formula: 'SUM(MISSING[Amount])', result: 3 };
  const source = await readXlsxWorkbook(Buffer.from(await book.xlsx.writeBuffer()));
  // In this pinned engine MISSING(A1) with a same-named table resolves through
  // a non-scalar table-reference path. The existing array boundary must refuse
  // it, rather than writing either a fabricated NAME error or a scalar cache.
  const before = new Map(source.parts);
  await expect(calculateWorkbookCellEdits(source, [{ sheetId: '1', cell: { row: 0, column: 0, kind: 'number', value: 3 } }])).rejects.toMatchObject({ code: 'WORKBOOK_UNSUPPORTED', message: expect.stringContaining('Array formulas') });
  expect(source.parts).toEqual(before);
});

it('does not mistake an unbound name for a supported function merely because their tokens match', async () => {
  const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('Name'); sheet.getCell('A1').value = 2;
  sheet.getCell('B1').value = { formula: 'SUM', result: 55 }; sheet.getCell('C1').value = { formula: 'SUM(A1)', result: 2 };
  const source = await readXlsxWorkbook(Buffer.from(await book.xlsx.writeBuffer()));
  const { bytes } = await calculateWorkbookCellEdits(source, [{ sheetId: '1', cell: { row: 0, column: 0, kind: 'number', value: 3 } }]);
  const independent = new ExcelJS.Workbook(); await independent.xlsx.load(Uint8Array.from(bytes).buffer);
  expect(independent.worksheets[0]!.getCell('B1').result).toBe(55); expect(independent.worksheets[0]!.getCell('C1').result).toBe(3);
});
