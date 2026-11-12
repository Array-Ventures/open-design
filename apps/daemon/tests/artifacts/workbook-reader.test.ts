import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs-community';
import JSZip from 'jszip';
import { readXlsxWorkbook } from '../../src/artifacts/workbook/reader.js';
import { address, relationshipTarget } from '../../src/artifacts/workbook/parts.js';
import { parseWorkbookXml, writeWorkbookXml } from '../../src/artifacts/workbook/xml.js';

async function fixture() {
  const book = new ExcelJS.Workbook();
  const inputs = book.addWorksheet('Inputs');
  inputs.getCell('A1').value = 'Quarterly inputs'; inputs.mergeCells('A1:C1');
  inputs.getCell('A1').font = { bold: true, size: 18, color: { argb: 'FF123456' } };
  inputs.getCell('C5').value = 12.5; inputs.getCell('C5').numFmt = '$#,##0.00';
  inputs.getCell('D7').value = true;
  inputs.getCell('E9').value = { richText: [{ text: 'One ', font: { bold: true } }, { text: 'two' }] };
  inputs.getCell('F10').value = { error: '#DIV/0!' };
  inputs.getCell('G11').numFmt = '0.00';
  inputs.getRow(1).height = 28; inputs.getRow(20).hidden = true; inputs.getCell('A20').numFmt = '0.00';
  inputs.getColumn('C').width = 18; inputs.getColumn('H').hidden = true;
  inputs.getColumn('J').numFmt = '0%';
  inputs.views = [{ state: 'frozen', xSplit: 1, ySplit: 1 }];
  const summary = book.addWorksheet('Summary');
  summary.getCell('B2').value = { formula: 'Inputs!C5*2', result: 25 };
  const hidden = book.addWorksheet('Details', { state: 'veryHidden' }); hidden.getCell('A1').value = 'Retain hidden data';
  return Buffer.from(await book.xlsx.writeBuffer());
}
async function alter(input: Buffer, change: (zip: JSZip) => Promise<void> | void) {
  const zip = await JSZip.loadAsync(input); await change(zip); return zip.generateAsync({ type: 'nodebuffer' });
}
describe('workbook source reader', () => {
  it('reads sparse typed cells, cached formulas, formatting, ranges, dimensions and hidden sheets', async () => {
    const input = await fixture(), before = Buffer.from(input);
    const { model, parts, sheetParts } = await readXlsxWorkbook(input);
    expect(input).toEqual(before);
    expect(model.sheets.map(sheet => sheet.name)).toEqual(['Inputs', 'Summary', 'Details']);
    expect(model.themeColors).toHaveLength(12);
    expect(model.themeColors?.slice(0, 2)).toEqual(['FFFFFFFF', 'FF000000']);
    const sheet = model.sheets[0]!;
    const cell = sheet.cells.find(cell => cell.row === 4 && cell.column === 2)!;
    expect(cell).toMatchObject({ kind: 'number', value: 12.5 });
    expect(model.styles[cell.style!]?.numberFormat).toBe('$#,##0.00');
    expect(sheet.cells.some(cell => cell.row === 3 && cell.column === 1)).toBe(false);
    expect(sheet.cells.find(cell => cell.row === 6 && cell.column === 3)).toMatchObject({ kind: 'boolean', value: true });
    expect(sheet.cells.find(cell => cell.row === 8 && cell.column === 4)).toMatchObject({ kind: 'string', value: 'One two', runs: [{ text: 'One ', font: { bold: true } }, { text: 'two' }] });
    expect(sheet.cells.find(cell => cell.row === 9 && cell.column === 5)).toMatchObject({ kind: 'error', value: '#DIV/0!' });
    expect(sheet.cells.find(cell => cell.row === 10 && cell.column === 6)).toMatchObject({ kind: 'blank', value: null });
    expect(model.sheets[1]!.cells.find(cell => cell.row === 1 && cell.column === 1)).toMatchObject({ formula: '=Inputs!C5*2', kind: 'number', value: 25 });
    expect(model.sheets[2]!.visibility).toBe('veryHidden');
    expect(sheet.merges).toEqual([{ startRow: 0, endRow: 0, startColumn: 0, endColumn: 2 }]);
    expect(sheet.rowDimensions).toContainEqual({ index: 0, height: 28 });
    expect(sheet.rowDimensions).toContainEqual({ index: 19, hidden: true });
    expect(sheet.columnDimensions.find(column => column.index === 2)?.width).toBe(18);
    expect(sheet.columnDimensions.find(column => column.index === 7)?.hidden).toBe(true);
    expect(model.styles[sheet.columnDimensions.find(column => column.index === 9)!.style!]?.numberFormat).toBe('0%');
    expect(sheet).toMatchObject({ frozenRows: 1, frozenColumns: 1, defaultRowHeight: 15 });
    expect(parts.get(sheetParts.get(sheet.id)!)).toBeInstanceOf(Buffer);
  });
  it('expands shared formulas with relative and absolute references without inventing caches', async () => {
    const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('Shared');
    sheet.getCell('A1').value = 2; sheet.getCell('A2').value = 3;
    sheet.fillFormula('C1:C2', 'A1+$A$1', [4, 5]);
    sheet.getCell('D1').value = { formula: 'A1*10' };
    const { model } = await readXlsxWorkbook(Buffer.from(await book.xlsx.writeBuffer()));
    expect(model.sheets[0]!.cells.find(cell => cell.row === 1 && cell.column === 2)).toMatchObject({ formula: '=A2+$A$1', value: 5 });
    expect(model.sheets[0]!.cells.find(cell => cell.row === 0 && cell.column === 3)).toMatchObject({ formula: '=A1*10', kind: 'blank', value: null });
  });
  it.each([false, true])('retains raw date serials and the date1904=%s epoch', async date1904 => {
    const book = new ExcelJS.Workbook(); book.properties.date1904 = date1904;
    const sheet = book.addWorksheet('Dates'); sheet.getCell('A1').value = 60; sheet.getCell('A1').numFmt = 'yyyy-mm-dd';
    const { model } = await readXlsxWorkbook(Buffer.from(await book.xlsx.writeBuffer()));
    expect(model.date1904).toBe(date1904); expect(model.sheets[0]!.cells[0]).toMatchObject({ kind: 'number', value: 60 });
  });
  it('counts and retains chart/drawing parts instead of saving through the lossy importer', async () => {
    const input = await alter(await fixture(), zip => { zip.file('xl/charts/chart1.xml', '<chartSpace/>'); zip.file('xl/drawings/drawing1.xml', '<drawing/>'); });
    const result = await readXlsxWorkbook(input);
    expect(result.model.features).toMatchObject({ charts: 1, drawings: 1 });
    expect(result.parts.get('xl/charts/chart1.xml')?.toString()).toBe('<chartSpace/>');
  });
  it('retains gradient colors and geometry in the typed style model', async () => {
    const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('Gradient');
    sheet.getCell('A1').value = 'Gradient';
    sheet.getCell('A1').fill = { type: 'gradient', gradient: 'angle', degree: 45, stops: [{ position: 0, color: { argb: 'FF123456' } }, { position: 1, color: { argb: 'FFABCDEF' } }] };
    const { model } = await readXlsxWorkbook(Buffer.from(await book.xlsx.writeBuffer()));
    expect(model.styles[model.sheets[0]!.cells[0]!.style!]?.fill).toEqual({ gradient: 'angle', degree: 45, stops: [{ position: 0, color: { kind: 'rgb', argb: 'FF123456' } }, { position: 1, color: { kind: 'rgb', argb: 'FFABCDEF' } }] });
  });
  it.each(['missing', 'external', 'escape'])('rejects a %s worksheet relationship', async variant => {
    const input = await alter(await fixture(), async zip => {
      const file = 'xl/_rels/workbook.xml.rels'; const document = parseWorkbookXml(await zip.file(file)!.async('nodebuffer'));
      const item = Array.from(document.getElementsByTagName('Relationship')).find(node => node.getAttribute('Type')?.endsWith('/worksheet'))!;
      item.setAttribute('Target', variant === 'missing' ? 'worksheets/absent.xml' : variant === 'escape' ? '../../../outside.xml' : 'https://fixture.invalid/data.xml');
      if (variant === 'external') item.setAttribute('TargetMode', 'External');
      zip.file(file, writeWorkbookXml(document));
    });
    await expect(readXlsxWorkbook(input)).rejects.toMatchObject({ code: 'WORKBOOK_INVALID' });
  });
  it('rejects invalid shared string indexes and nonfinite numeric values', async () => {
    for (const content of ['<c r="C5" t="s"><v>999999</v></c>', '<c r="C5"><v>Infinity</v></c>']) {
      const input = await alter(await fixture(), async zip => {
        const file = 'xl/worksheets/sheet1.xml'; const xml = await zip.file(file)!.async('string');
        zip.file(file, xml.replace(/<c r="C5"[^>]*>.*?<\/c>/, content));
      });
      await expect(readXlsxWorkbook(input)).rejects.toMatchObject({ code: 'WORKBOOK_INVALID' });
    }
  });
  it('rejects repeated overlapping column ranges before an importer can expand them', async () => {
    const input = await alter(await fixture(), async zip => {
      const file = 'xl/worksheets/sheet1.xml'; const xml = await zip.file(file)!.async('string');
      zip.file(file, xml.replace('</cols>', '<col min="1" max="16384"/></cols>'));
    });
    await expect(readXlsxWorkbook(input)).rejects.toMatchObject({ code: 'WORKBOOK_UNSUPPORTED' });
  });
  it.each(['merge', 'column', 'cell', 'duplicate-row'])('rejects an expanding or invalid %s before importer allocation', async variant => {
    const input = await alter(await fixture(), async zip => {
      const file = 'xl/worksheets/sheet1.xml'; const xml = await zip.file(file)!.async('string');
      zip.file(file, variant === 'merge' ? xml.replace('ref="A1:C1"', 'ref="A1:XFD1048576"')
        : variant === 'column' ? xml.replace(/(<col[^>]*\bmax=")[^"]+/, (_match, prefix: string) => `${prefix}999999`)
          : variant === 'cell' ? xml.replace('r="C5"', 'r="XFE5"')
            : xml.replace('</sheetData>', '<row r="1"/></sheetData>'));
    });
    await expect(readXlsxWorkbook(input)).rejects.toMatchObject({ code: variant === 'merge' ? 'WORKBOOK_LIMIT' : 'WORKBOOK_INVALID' });
  });
});
describe('package coordinate and relationship mapping', () => {
  it('resolves relative/absolute targets and escaped literal filename characters inside the package', () => {
    expect(relationshipTarget('xl/workbook.xml', 'worksheets/sheet1.xml')).toBe('xl/worksheets/sheet1.xml');
    expect(relationshipTarget('xl/worksheets/sheet1.xml', '../drawings/drawing1.xml')).toBe('xl/drawings/drawing1.xml');
    expect(relationshipTarget('xl/workbook.xml', '/xl/worksheets/sheet1.xml')).toBe('xl/worksheets/sheet1.xml');
    expect(relationshipTarget('xl/workbook.xml', 'worksheets/sheet%231.xml')).toBe('xl/worksheets/sheet#1.xml');
    expect(address('XFD1048576')).toEqual({ row: 1048575, column: 16383 });
  });
  it.each(['../../../outside', 'https://outside', '//outside/path', 'file%3A/outside', '..%2F..%2Foutside', 'sheet.xml#fragment', 'sheet.xml?query', 'xl\\sheet.xml'])('rejects the relationship target %s', target => {
    expect(() => relationshipTarget('xl/workbook.xml', target)).toThrow();
  });
});
