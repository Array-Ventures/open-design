import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs-community';
import JSZip from 'jszip';
import { readXlsxWorkbook } from '../../src/artifacts/workbook/reader.js';
import { patchWorkbookCells } from '../../src/artifacts/workbook/cell-patch.js';
import { readWorkbookPackage } from '../../src/artifacts/workbook/package.js';
import { parseWorkbookXml, writeWorkbookXml } from '../../src/artifacts/workbook/xml.js';

async function fixture() {
  const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('Inputs');
  sheet.getCell('A1').value = 2; sheet.getCell('A1').numFmt = '0.00';
  sheet.getCell('A2').value = 3;
  sheet.fillFormula('C1:C2', 'A1+$A$1', [4, 5]);
  const summary = book.addWorksheet('Summary');
  summary.getCell('A1').value = { formula: 'Inputs!A1*2', result: 4 };
  const zip = await JSZip.loadAsync(await book.xlsx.writeBuffer());
  // Unknown application/chart content is deliberately opaque to the writer.
  zip.file('xl/charts/chart1.xml', '<chart xmlns="urn:test"><opaque>retain</opaque></chart>');
  zip.file('custom/opaque.bin', Buffer.from([0, 1, 255, 4]));
  return readXlsxWorkbook(await zip.generateAsync({ type: 'nodebuffer' }));
}
describe('workbook cell preservation patches', () => {
  it('removes obsolete calculation-chain parts and their package references', async () => {
    const source = await fixture(), parts = new Map(source.parts);
    const rels = parseWorkbookXml(parts.get('xl/_rels/workbook.xml.rels')!);
    const relation = rels.createElementNS(rels.documentElement!.namespaceURI, 'Relationship');
    relation.setAttribute('Id', 'calc-chain'); relation.setAttribute('Type', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/calcChain'); relation.setAttribute('Target', 'calcChain.xml');
    rels.documentElement!.appendChild(relation); parts.set('xl/_rels/workbook.xml.rels', writeWorkbookXml(rels));
    const types = parseWorkbookXml(parts.get('[Content_Types].xml')!);
    const type = types.createElementNS(types.documentElement!.namespaceURI, 'Override');
    type.setAttribute('PartName', '/xl/calcChain.xml'); type.setAttribute('ContentType', 'application/vnd.openxmlformats-officedocument.spreadsheetml.calcChain+xml');
    types.documentElement!.appendChild(type); parts.set('[Content_Types].xml', writeWorkbookXml(types));
    parts.set('xl/calcChain.xml', Buffer.from('<calcChain xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><c r="C1" i="1"/></calcChain>'));
    const output = await readWorkbookPackage(await patchWorkbookCells({ ...source, parts }, [{ sheetId: '1', cell: { row: 1, column: 0, kind: 'number', value: 8 } }]));
    expect(output.has('xl/calcChain.xml')).toBe(false);
    expect(output.get('xl/_rels/workbook.xml.rels')!.toString()).not.toContain('calcChain');
    expect(output.get('[Content_Types].xml')!.toString()).not.toContain('calcChain');
  });
  it.each(['protected', 'array', 'merged'])('refuses unsupported %s edits instead of corrupting workbook structure', async variant => {
    const source = await fixture(), parts = new Map(source.parts);
    const document = parseWorkbookXml(parts.get('xl/worksheets/sheet1.xml')!), root = document.documentElement!;
    const tag = (name: string) => document.createElementNS(root.namespaceURI, name);
    if (variant === 'protected') root.appendChild(tag('sheetProtection'));
    if (variant === 'array') {
      const formula = Array.from(document.getElementsByTagName('f'))[0]!;
      formula.setAttribute('t', 'array'); formula.setAttribute('ref', 'A1:C2');
    }
    if (variant === 'merged') {
      const merges = tag('mergeCells'), merge = tag('mergeCell'); merge.setAttribute('ref', 'A1:B2'); merges.appendChild(merge); root.appendChild(merges);
    }
    parts.set('xl/worksheets/sheet1.xml', writeWorkbookXml(document));
    await expect(patchWorkbookCells({ ...source, parts }, [{ sheetId: '1', cell: { row: 1, column: 0, kind: 'number', value: 8 } }])).rejects.toMatchObject({ code: variant === 'merged' ? 'WORKBOOK_INVALID' : 'WORKBOOK_UNSUPPORTED' });
  });
  it('reopens real typed edits, preserves styles/opaque parts and clears stale dependent caches', async () => {
    const source = await fixture(), original = new Map([...source.parts].map(([name, bytes]) => [name, Buffer.from(bytes)]));
    const previous = source.model.sheets[0]!.cells.find(cell => cell.row === 0 && cell.column === 0)!;
    const bytes = await patchWorkbookCells(source, [
      { sheetId: '1', cell: { ...previous, kind: 'number', value: 42 } },
      { sheetId: '1', cell: { row: 20, column: 10, kind: 'string', value: ' <hello> & trailing  ' } },
      { sheetId: '1', cell: { row: 3, column: 0, kind: 'boolean', value: true } },
    ]);
    const book = new ExcelJS.Workbook(); await book.xlsx.load(Uint8Array.from(bytes).buffer);
    const sheet = book.getWorksheet('Inputs')!;
    expect(sheet.getCell('A1').value).toBe(42); expect(sheet.getCell('A1').numFmt).toBe('0.00');
    expect(sheet.getCell('K21').value).toBe(' <hello> & trailing  '); expect(sheet.getCell('A4').value).toBe(true);
    expect(sheet.getCell('C2').formula).toBe('A2+$A$1'); expect(sheet.getCell('C2').result).toBeUndefined();
    expect(book.getWorksheet('Summary')!.getCell('A1').result).toBeUndefined();
    const output = await readWorkbookPackage(bytes);
    for (const [name, value] of original) {
      expect(source.parts.get(name), `source ${name}`).toEqual(value);
      if (!['xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml', 'xl/workbook.xml'].includes(name)) expect(output.get(name), name).toEqual(value);
    }
    expect(output.get('xl/workbook.xml')!.toString()).toContain('fullCalcOnLoad="1"');
  });
  it('can clear a shared-formula master without breaking a remaining follower', async () => {
    const source = await fixture();
    const bytes = await patchWorkbookCells(source, [{ sheetId: '1', cell: { row: 0, column: 2, kind: 'blank', value: null } }]);
    const book = new ExcelJS.Workbook(); await book.xlsx.load(Uint8Array.from(bytes).buffer);
    expect(book.getWorksheet('Inputs')!.getCell('C1').value).toBeNull();
    expect(book.getWorksheet('Inputs')!.getCell('C2').formula).toBe('A2+$A$1');
  });
  it('does not trust supplied caches for new formulas', async () => {
    const source = await fixture();
    const bytes = await patchWorkbookCells(source, [{ sheetId: '1', cell: { row: 4, column: 1, kind: 'number', value: 999, formula: '=A1*2' } }]);
    const reread = await readXlsxWorkbook(bytes);
    expect(reread.model.sheets[0]!.cells.find(cell => cell.row === 4 && cell.column === 1)).toMatchObject({ formula: '=A1*2', kind: 'blank', value: null });
  });
  it('rejects duplicate edits and unimplemented formatting changes without mutating the source', async () => {
    const source = await fixture(), before = Buffer.from(source.parts.get('xl/worksheets/sheet1.xml')!);
    const edit = { sheetId: '1', cell: { row: 1, column: 0, kind: 'number' as const, value: 8 } };
    await expect(patchWorkbookCells(source, [edit, edit])).rejects.toMatchObject({ code: 'WORKBOOK_INVALID' });
    await expect(patchWorkbookCells(source, [{ ...edit, cell: { ...edit.cell, style: 1 } }])).rejects.toMatchObject({ code: 'WORKBOOK_UNSUPPORTED' });
    expect(source.parts.get('xl/worksheets/sheet1.xml')).toEqual(before);
  });
  it('refuses to invalidate signed workbooks', async () => {
    const source = await fixture(); source.model.features.signed = true;
    await expect(patchWorkbookCells(source, [{ sheetId: '1', cell: { row: 1, column: 0, kind: 'number', value: 8 } }])).rejects.toMatchObject({ code: 'WORKBOOK_UNSUPPORTED' });
  });
  it.each(['bad\u0001text', 'unpaired\ud800'])('rejects non-XML text without emitting a corrupt archive', async value => {
    const source = await fixture();
    await expect(patchWorkbookCells(source, [{ sheetId: '1', cell: { row: 10, column: 0, kind: 'string', value } }])).rejects.toMatchObject({ code: 'WORKBOOK_INVALID' });
  });
  it('preserves emoji and sorts new row/cell coordinates when edits arrive out of order', async () => {
    const source = await fixture();
    const bytes = await patchWorkbookCells(source, [
      { sheetId: '1', cell: { row: 15, column: 8, kind: 'string', value: 'Hello 👋' } },
      { sheetId: '1', cell: { row: 10, column: 7, kind: 'number', value: 7 } },
      { sheetId: '1', cell: { row: 10, column: 2, kind: 'number', value: 2 } },
    ]);
    const parts = await readWorkbookPackage(bytes), xml = parts.get('xl/worksheets/sheet1.xml')!.toString();
    expect(xml.indexOf('r="11"')).toBeLessThan(xml.indexOf('r="16"'));
    expect(xml.indexOf('r="C11"')).toBeLessThan(xml.indexOf('r="H11"'));
    const book = new ExcelJS.Workbook(); await book.xlsx.load(Uint8Array.from(bytes).buffer);
    expect(book.getWorksheet('Inputs')!.getCell('I16').value).toBe('Hello 👋');
  });
});
