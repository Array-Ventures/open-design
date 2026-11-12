import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs-community';
import JSZip from 'jszip';
import { readXlsxWorkbook } from '../../src/artifacts/workbook/reader.js';
import { calculateWorkbookCellEdits } from '../../src/artifacts/workbook/calculated-patch.js';
import { readWorkbookPackage } from '../../src/artifacts/workbook/package.js';
import { parseWorkbookXml, writeWorkbookXml } from '../../src/artifacts/workbook/xml.js';

async function fixture() {
  const book = new ExcelJS.Workbook(), inputs = book.addWorksheet('Inputs'), summary = book.addWorksheet('Summary');
  inputs.addTable({ name: 'Sales', ref: 'C4', headerRow: true, totalsRow: true,
    columns: [{ name: 'Amount', totalsRowFunction: 'sum' }, { name: 'Flag', totalsRowLabel: 'Total' }], rows: [[12.5, true], [30, false]] });
  // ExcelJS retains totalsRowFunction in the table definition but does not
  // materialize a worksheet formula. Supply that real source formula explicitly.
  inputs.getCell('C7').value = { formula: 'SUBTOTAL(109,Sales[Amount])' };
  book.definedNames.add('Inputs!$C$5:$C$6', 'Amounts');
  summary.getCell('A1').value = { formula: 'SUM(Sales[Amount])' };
  summary.getCell('A2').value = { formula: 'SUM(Amounts)' };
  summary.getCell('A3').value = { formula: 'Rate*10' };
  summary.getCell('A4').value = { formula: 'SUM(sAlEs[aMoUnT])' };
  inputs.getCell('A1').value = { formula: 'Rate*10' };
  const zip = await JSZip.loadAsync(await book.xlsx.writeBuffer());
  const main = parseWorkbookXml(Buffer.from(await zip.file('xl/workbook.xml')!.async('uint8array'))), root = main.documentElement!;
  const names = Array.from(root.childNodes).find(node => node.nodeType === 1 && node.localName === 'definedNames')!;
  for (const [scope, value] of [[undefined, '3'], ['1', '2']] as const) {
    const name = main.createElementNS(root.namespaceURI, 'definedName'); name.setAttribute('name', 'Rate');
    if (scope !== undefined) name.setAttribute('localSheetId', scope);
    name.appendChild(main.createTextNode(value)); names.appendChild(name);
  }
  zip.file('xl/workbook.xml', writeWorkbookXml(main));
  return zip.generateAsync({ type: 'nodebuffer' });
}
describe('workbook names and table metadata', () => {
  it.each(['Sales[@Amount]*2', 'Sales[@[Amount]]*2', '[@Amount]*2'])('keeps %s tied to its actual row after an input edit', async formula => {
    const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('Inputs');
    sheet.addTable({ name: 'Sales', ref: 'C4', headerRow: true,
      columns: [{ name: 'Amount' }, { name: 'Flag' }, { name: 'Double' }],
      rows: [[12.5, true, { formula }], [30, false, { formula }]] });
    const source = await readXlsxWorkbook(Buffer.from(await book.xlsx.writeBuffer()));
    const { bytes } = await calculateWorkbookCellEdits(source, [{ sheetId: '1', cell: { row: 5, column: 2, kind: 'number', value: 38 } }]);
    const reopened = new ExcelJS.Workbook(); await reopened.xlsx.load(Uint8Array.from(bytes).buffer);
    expect(reopened.getWorksheet('Inputs')!.getCell('E5').result).toBe(25);
    expect(reopened.getWorksheet('Inputs')!.getCell('E6').result).toBe(76);
    expect(reopened.getWorksheet('Inputs')!.getCell('E6').formula).toBe(formula);
  });
  it('reads table bounds, columns, totals and workbook/sheet-scoped names', async () => {
    const { model } = await readXlsxWorkbook(await fixture());
    expect(model.tables).toEqual([{ name: 'Sales', sheetId: '1', range: { startRow: 3, endRow: 6, startColumn: 2, endColumn: 3 }, columns: ['Amount', 'Flag'], header: true, totals: true }]);
    expect(model.definedNames).toContainEqual({ name: 'Amounts', formula: 'Inputs!$C$5:$C$6' });
    expect(model.definedNames).toContainEqual({ name: 'Rate', formula: '2', sheetId: '2' });
  });
  it('recalculates named and structured references after an edit and preserves table XML', async () => {
    const source = await readXlsxWorkbook(await fixture());
    expect(source.model.sheets[0]!.cells.find(cell => cell.row === 6 && cell.column === 2)?.formula).toBe('=SUBTOTAL(109,Sales[Amount])');
    const previous = source.model.sheets[0]!.cells.find(cell => cell.row === 5 && cell.column === 2)!;
    const { bytes } = await calculateWorkbookCellEdits(source, [{ sheetId: '1', cell: { ...previous, kind: 'number', value: 38 } }]);
    const book = new ExcelJS.Workbook(); await book.xlsx.load(Uint8Array.from(bytes).buffer);
    const summary = book.getWorksheet('Summary')!;
    expect(summary.getCell('A1').result).toBe(50.5); expect(summary.getCell('A2').result).toBe(50.5);
    expect(summary.getCell('A3').result).toBe(20); expect(book.getWorksheet('Inputs')!.getCell('A1').result).toBe(30);
    expect(summary.getCell('A4').result).toBe(50.5);
    expect(book.getWorksheet('Inputs')!.getCell('C7').result).toBe(50.5);
    const output = await readWorkbookPackage(bytes);
    expect(output.get('xl/tables/table1.xml')).toEqual(source.parts.get('xl/tables/table1.xml'));
    expect((await readXlsxWorkbook(bytes)).model.definedNames).toEqual(source.model.definedNames);
  });
  it.each(['scope', 'missing-table', 'external-table', 'column-count'])('rejects invalid %s metadata', async variant => {
    const zip = await JSZip.loadAsync(await fixture());
    if (variant === 'scope') zip.file('xl/workbook.xml', (await zip.file('xl/workbook.xml')!.async('string')).replace('localSheetId="1"', 'localSheetId="99"'));
    if (variant === 'missing-table') zip.remove('xl/tables/table1.xml');
    if (variant === 'external-table') zip.file('xl/worksheets/_rels/sheet1.xml.rels', (await zip.file('xl/worksheets/_rels/sheet1.xml.rels')!.async('string')).replace('Target="../tables/table1.xml"', 'Target="https://outside/table.xml" TargetMode="External"'));
    if (variant === 'column-count') zip.file('xl/tables/table1.xml', (await zip.file('xl/tables/table1.xml')!.async('string')).replace('ref="C4:D7"', 'ref="C4:E7"'));
    await expect(readXlsxWorkbook(await zip.generateAsync({ type: 'nodebuffer' }))).rejects.toMatchObject({ code: 'WORKBOOK_INVALID' });
  });
});
