import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs-community';
import { readXlsxWorkbook } from '../../src/artifacts/workbook/reader.js';
import { calculateWorkbook } from '../../src/artifacts/workbook/calculate.js';
import { calculateWorkbookCellEdits } from '../../src/artifacts/workbook/calculated-patch.js';
import { readWorkbookPackage } from '../../src/artifacts/workbook/package.js';
import { parseWorkbookXml, writeWorkbookXml } from '../../src/artifacts/workbook/xml.js';

async function fixture(date1904 = false) {
  const book = new ExcelJS.Workbook(); book.properties.date1904 = date1904;
  const inputs = book.addWorksheet('Quarterly inputs'); inputs.getCell('B2').value = 12.5; inputs.getCell('B3').value = 38;
  inputs.getCell('C2').value = true; inputs.getCell('D2').value = '0123';
  const summary = book.addWorksheet('Summary');
  summary.getCell('B2').value = { formula: "SUM('Quarterly inputs'!B2:B3)", result: 999 };
  summary.getCell('B3').value = { formula: 'B2*2', result: 999 };
  summary.getCell('C2').value = { formula: "IF('Quarterly inputs'!C2,TRUE,FALSE)" };
  summary.getCell('D2').value = { formula: "'Quarterly inputs'!D2&\"abc\"" };
  summary.getCell('E2').value = { formula: 'DATE(2024,1,1)' };
  return (await readXlsxWorkbook(Buffer.from(await book.xlsx.writeBuffer()))).model;
}
describe('headless workbook calculation', () => {
  it.each(['table', 'name', 'external'])('refuses incomplete %s metadata adapters before preparing an export', async variant => {
    const book = new ExcelJS.Workbook(); book.addWorksheet('Inputs').getCell('A1').value = 1;
    const source = await readXlsxWorkbook(Buffer.from(await book.xlsx.writeBuffer())), parts = new Map(source.parts);
    if (variant === 'table') parts.set('xl/tables/table1.xml', Buffer.from('<table/>'));
    if (variant === 'external') source.model.features.externalLinks = 1;
    if (variant === 'name') {
      const main = parseWorkbookXml(parts.get('xl/workbook.xml')!), root = main.documentElement!;
      const names = main.createElementNS(root.namespaceURI, 'definedNames'), name = main.createElementNS(root.namespaceURI, 'definedName');
      name.setAttribute('name', 'Input'); name.appendChild(main.createTextNode('Inputs!$A$1')); names.appendChild(name); root.appendChild(names);
      parts.set('xl/workbook.xml', writeWorkbookXml(main));
    }
    await expect(calculateWorkbookCellEdits({ ...source, parts }, [{ sheetId: '1', cell: { row: 0, column: 0, kind: 'number', value: 2 } }])).rejects.toMatchObject({ code: 'WORKBOOK_UNSUPPORTED' });
    expect(source.model.sheets[0]!.cells[0]!.value).toBe(1);
  });
  it('rejects unmodeled spill results after calculation without emitting partial cached data', async () => {
    const input = await fixture(); input.sheets[1]!.cells[0]!.formula = '=SEQUENCE(2,2)';
    await expect(calculateWorkbook(input)).rejects.toMatchObject({ code: 'WORKBOOK_UNSUPPORTED' });
  });
  it('preserves package content while exporting genuinely recalculated typed XLSX caches', async () => {
    const book = new ExcelJS.Workbook(), inputs = book.addWorksheet('Inputs'), summary = book.addWorksheet('Summary');
    inputs.getCell('A1').value = 12.5; inputs.getCell('A2').value = 30; inputs.getCell('A1').numFmt = '$0.00';
    summary.getCell('A1').value = { formula: 'SUM(Inputs!A1:A2)', result: 999 };
    summary.getCell('A2').value = { formula: 'A1*2', result: 999 };
    summary.getCell('B1').value = { formula: 'A1>0', result: false };
    summary.getCell('C1').value = { formula: '"Total "&A1', result: 'stale' };
    summary.getCell('D1').value = { formula: '1/0' };
    summary.getCell('E1').value = { formula: '"#DIV/0!"' };
    const source = await readXlsxWorkbook(Buffer.from(await book.xlsx.writeBuffer()));
    const parts = new Map(source.parts); parts.set('custom/opaque.bin', Buffer.from([0, 255, 5]));
    const { bytes } = await calculateWorkbookCellEdits({ ...source, parts }, [{ sheetId: '1', cell: { row: 1, column: 0, kind: 'number', value: 38 } }]);
    const reopened = new ExcelJS.Workbook(); await reopened.xlsx.load(Uint8Array.from(bytes).buffer);
    const totals = reopened.getWorksheet('Summary')!;
    expect(totals.getCell('A1').value).toEqual({ formula: 'SUM(Inputs!A1:A2)', result: 50.5 });
    expect(totals.getCell('A2').value).toEqual({ formula: 'A1*2', result: 101 });
    expect(totals.getCell('B1').value).toEqual({ formula: 'A1>0', result: true });
    expect(totals.getCell('C1').value).toEqual({ formula: '"Total "&A1', result: 'Total 50.5' });
    expect(totals.getCell('D1').value).toEqual({ formula: '1/0', result: { error: '#DIV/0!' } });
    expect(totals.getCell('E1').value).toEqual({ formula: '"#DIV/0!"', result: '#DIV/0!' });
    expect(reopened.getWorksheet('Inputs')!.getCell('A1').numFmt).toBe('$0.00');
    const output = await readWorkbookPackage(bytes);
    expect(output.get('custom/opaque.bin')).toEqual(parts.get('custom/opaque.bin'));
    expect(source.model.sheets[0]!.cells.find(cell => cell.row === 1 && cell.column === 0)?.value).toBe(30);
    const reread = await readXlsxWorkbook(bytes);
    expect(reread.model.sheets[1]!.cells.find(cell => cell.row === 0 && cell.column === 1)).toMatchObject({ kind: 'boolean', value: true });
    expect(reread.model.sheets[1]!.cells.find(cell => cell.row === 0 && cell.column === 2)).toMatchObject({ kind: 'string', value: 'Total 50.5' });
  });
  it('distinguishes error-looking input text from errors in dependent formulas', async () => {
    const input = await fixture(), sheet = input.sheets[1]!;
    sheet.cells.push({ row: 5, column: 0, kind: 'string', value: '#DIV/0!' });
    sheet.cells.push({ row: 5, column: 1, kind: 'blank', value: null, formula: '=IFERROR(A6,"wrong")' });
    sheet.cells.push({ row: 5, column: 2, kind: 'blank', value: null, formula: '="#DIV/0!"' });
    sheet.cells.push({ row: 5, column: 3, kind: 'blank', value: null, formula: '=IFERROR(C6,"wrong")' });
    const output = await calculateWorkbook(input);
    expect(output.sheets[1]!.cells.find(cell => cell.row === 5 && cell.column === 1)).toMatchObject({ kind: 'string', value: '#DIV/0!' });
    expect(output.sheets[1]!.cells.find(cell => cell.row === 5 && cell.column === 3)).toMatchObject({ kind: 'string', value: '#DIV/0!' });
  });
  it('uses hidden row metadata for SUBTOTAL rather than summing invisible inputs', async () => {
    const input = await fixture();
    input.sheets[0]!.rowDimensions.push({ index: 2, hidden: true });
    input.sheets[1]!.cells.push({ row: 5, column: 0, kind: 'blank', value: null, formula: "=SUBTOTAL(109,'Quarterly inputs'!B2:B3)" });
    const output = await calculateWorkbook(input);
    expect(output.sheets[1]!.cells.find(cell => cell.row === 5 && cell.column === 0)).toMatchObject({ kind: 'number', value: 12.5 });
  });
  it.each([false, true])('calculates cross-sheet dependencies and typed caches with date1904=%s', async date1904 => {
    const input = await fixture(date1904), before = structuredClone(input);
    const output = await calculateWorkbook(input), cells = output.sheets[1]!.cells;
    expect(input).toEqual(before);
    const at = (row: number, column: number) => cells.find(cell => cell.row === row && cell.column === column);
    expect(at(1, 1)).toMatchObject({ kind: 'number', value: 50.5 });
    expect(at(2, 1)).toMatchObject({ kind: 'number', value: 101 });
    expect(at(1, 2)).toMatchObject({ kind: 'boolean', value: true });
    expect(at(1, 3)).toMatchObject({ kind: 'string', value: '0123abc' });
    expect(at(1, 4)).toMatchObject({ kind: 'number', value: date1904 ? 43830 : 45292 });
  });
  it.each([['=1/0', 'error'], ['="#DIV/0!"', 'string']])('preserves the actual result type for %s', async (formula, kind) => {
    const input = await fixture(); input.sheets[1]!.cells[0]!.formula = formula;
    const output = await calculateWorkbook(input);
    expect(output.sheets[1]!.cells.find(cell => cell.row === 1 && cell.column === 1)).toMatchObject({ kind, value: '#DIV/0!' });
  });
});
