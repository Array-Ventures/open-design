import { expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs-community';
import JSZip from 'jszip';
import { readXlsxWorkbook } from '../../src/artifacts/workbook/reader.js';
import { calculateWorkbookCellEdits } from '../../src/artifacts/workbook/calculated-patch.js';
import { patchWorkbookStyles } from '../../src/artifacts/workbook/style-patch.js';
import { child, children, xmlPart } from '../../src/artifacts/workbook/parts.js';
async function fixture() {
  const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('Styled');
  sheet.getCell('A1').value = 2;
  sheet.getCell('B1').value = { formula: '[other.xlsx]Sheet1!A1', result: 71 };
  sheet.getCell('A1').font = { name: 'Arial', size: 14, color: { theme: 4 }, italic: true };
  sheet.getCell('A1').alignment = { horizontal: 'right', wrapText: true };
  sheet.getCell('A1').numFmt = '$0.00';
  sheet.getCell('C1').value = { richText: [{ text: 'Rich', font: { bold: true } }] };
  sheet.getColumn(4).font = { name: 'Courier New', italic: true };
  const zip = await JSZip.loadAsync(await book.xlsx.writeBuffer());
  zip.file('custom/opaque.bin', Buffer.from([1, 2, 255]));
  return readXlsxWorkbook(await zip.generateAsync({ type: 'nodebuffer' }));
}
it('changes point size without losing font identity, inherited styling, formula caches or other package parts', async () => {
  const source = await fixture();
  const saved = await calculateWorkbookCellEdits(source, [], [], [{ sheetId: '1', row: 0, column: 0, fontSize: 22.5 }]);
  const reopened = await readXlsxWorkbook(saved.bytes), cell = reopened.model.sheets[0]!.cells.find(cell => cell.row === 0 && cell.column === 0)!;
  expect(reopened.model.styles[cell.style!]).toMatchObject({ font: { name: 'Arial', size: 22.5, italic: true, color: { kind: 'theme', index: 4 } }, alignment: { horizontal: 'right', wrap: true }, numberFormat: '$0.00' });
  expect(reopened.model.sheets[0]!.cells.find(cell => cell.column === 1)).toEqual(source.model.sheets[0]!.cells.find(cell => cell.column === 1));
  for (const [part, bytes] of source.parts) if (!['xl/styles.xml', 'xl/worksheets/sheet1.xml'].includes(part)) expect(reopened.parts.get(part), part).toEqual(bytes);
  const independent = new ExcelJS.Workbook(); await independent.xlsx.load(Uint8Array.from(saved.bytes).buffer);
  // ExcelJS truncates fractional font sizes on read; inspect the retained OOXML
  // and the source-aware product model for precision, and this reader for other properties.
  expect(independent.worksheets[0]!.getCell('A1').font).toMatchObject({ name: 'Arial', italic: true, color: { theme: 4 } });
  const styleRoot = xmlPart(reopened.parts, 'xl/styles.xml').documentElement!;
  const targetXf = children(child(styleRoot, 'cellXfs')!, 'xf').at(-1)!;
  const targetFont = children(child(styleRoot, 'fonts')!, 'font')[Number(targetXf.getAttribute('fontId'))]!;
  expect(child(targetFont, 'sz')?.getAttribute('val')).toBe('22.5');
  expect(independent.worksheets[0]!.getCell('B1').result).toBe(71);
  for (const fontSize of [0, -1, 513, NaN, Infinity]) await expect(patchWorkbookStyles(source, [{ sheetId: '1', row: 0, column: 0, fontSize }])).rejects.toThrow();
});
it('patches real style components and retains formulas, caches, rich strings and opaque parts', async () => {
  const source = await fixture();
  const prepared = await calculateWorkbookCellEdits(source, [], [], [{ sheetId: '1', row: 0, column: 0, bold: true, italic: false, fontColor: 'FF123456', fillColor: 'FFABCDEF' }]);
  const reopened = await readXlsxWorkbook(prepared.bytes), cell = reopened.model.sheets[0]!.cells.find(c => c.row === 0 && c.column === 0)!;
  expect(reopened.model.styles[cell.style!]?.font?.italic).not.toBe(true);
  expect(reopened.model.styles[cell.style!]).toMatchObject({ font: { name: 'Arial', size: 14, bold: true, color: { kind: 'rgb', argb: 'FF123456' } }, alignment: { horizontal: 'right', wrap: true }, numberFormat: '$0.00', fill: { pattern: 'solid', foreground: { kind: 'rgb', argb: 'FFABCDEF' } } });
  for (const [part, bytes] of source.parts) if (!['xl/styles.xml', 'xl/worksheets/sheet1.xml'].includes(part)) expect(reopened.parts.get(part), part).toEqual(bytes);
  const originalXml = xmlPart(source.parts, 'xl/worksheets/sheet1.xml'), outputXml = xmlPart(reopened.parts, 'xl/worksheets/sheet1.xml');
  const originalCells = children(child(originalXml.documentElement!, 'sheetData')!.getElementsByTagName('row')[0]!, 'c');
  const outputCells = children(child(outputXml.documentElement!, 'sheetData')!.getElementsByTagName('row')[0]!, 'c');
  expect(outputCells.slice(1).map(c => c.toString())).toEqual(originalCells.slice(1).map(c => c.toString()));
  const independent = new ExcelJS.Workbook(); await independent.xlsx.load(Uint8Array.from(prepared.bytes).buffer);
  expect(independent.worksheets[0]!.getCell('A1').font).toMatchObject({ bold: true, name: 'Arial', color: { argb: 'FF123456' } });
  expect(independent.worksheets[0]!.getCell('A1').font.italic).not.toBe(true);
  expect(independent.worksheets[0]!.getCell('B1').result).toBe(71);
});
it('deduplicates identical edits and repeated saves; inherits a column font for a new blank cell', async () => {
  const source = await fixture(), edit = { sheetId: '1', row: 4, column: 3, bold: true };
  const first = await readXlsxWorkbook(await patchWorkbookStyles(source, [edit]));
  const second = await readXlsxWorkbook(await patchWorkbookStyles(first, [edit]));
  expect(child(xmlPart(first.parts, 'xl/worksheets/sheet1.xml').documentElement!, 'dimension')).toBeUndefined();
  expect(second.parts.get('xl/styles.xml')).toEqual(first.parts.get('xl/styles.xml'));
  expect(second.parts.get('xl/worksheets/sheet1.xml')).toEqual(first.parts.get('xl/worksheets/sheet1.xml'));
  const cell = second.model.sheets[0]!.cells.find(c => c.row === 4 && c.column === 3)!;
  expect(second.model.styles[cell.style!]?.font).toMatchObject({ name: 'Courier New', italic: true, bold: true });
  await expect(patchWorkbookStyles(source, [edit, edit])).rejects.toThrow('Duplicate');
  await expect(patchWorkbookStyles(source, [{ ...edit, row: 1048576 }])).rejects.toThrow();
  await expect(patchWorkbookStyles({ ...source, model: { ...source.model, features: { ...source.model.features, signed: true } } }, [edit])).rejects.toThrow('signatures');
});
it('imports authored Normal as deduplicated style zero for omitted cells and defaults', async () => {
  const source = await fixture(), styles = xmlPart(source.parts, 'xl/styles.xml');
  const normal = children(child(styles.documentElement!, 'fonts')!, 'font')[0]!;
  const name = child(normal, 'name')!; name.setAttribute('val', 'Aptos');
  const parts = new Map(source.parts); parts.set('xl/styles.xml', Buffer.from(styles.toString()));
  const { writeWorkbookPackage } = await import('../../src/artifacts/workbook/package.js');
  const reopened = await readXlsxWorkbook(await writeWorkbookPackage(parts));
  expect(reopened.model.styles[0]?.font?.name).toBe('Aptos');
  expect(reopened.model.sheets[0]!.cells.find(c => c.column === 1)?.style).toBeUndefined();
});

it('rejects ambiguous inherited row/column composition instead of dropping either source style', async () => {
  const source = await fixture(), part = 'xl/worksheets/sheet1.xml', document = xmlPart(source.parts, part);
  const row = children(child(document.documentElement!, 'sheetData')!, 'row')[0]!;
  row.setAttribute('s', '0'); row.setAttribute('customFormat', '1');
  // ExcelJS materializes a styled D1 while assigning the column font. Omit
  // that explicit XF to exercise actual row/column inheritance instead.
  children(row, 'c').find(cell => cell.getAttribute('r') === 'D1')?.removeAttribute('s');
  const parts = new Map(source.parts); parts.set(part, Buffer.from(document.toString()));
  await expect(patchWorkbookStyles({ ...source, parts }, [{ sheetId: '1', row: 0, column: 3, bold: true }])).rejects.toMatchObject({ code: 'WORKBOOK_UNSUPPORTED' });
});

it('accepts true row formatting flags and preserves inherited properties on a bold-only edit', async () => {
  const source = await fixture(), part = 'xl/worksheets/sheet1.xml', document = xmlPart(source.parts, part);
  const row = children(child(document.documentElement!, 'sheetData')!, 'row')[0]!;
  const sourceCell = children(row, 'c').find(cell => cell.getAttribute('r') === 'A1')!;
  row.setAttribute('s', sourceCell.getAttribute('s')!); row.setAttribute('customFormat', 'true'); sourceCell.removeAttribute('s');
  const parts = new Map(source.parts); parts.set(part, Buffer.from(document.toString()));
  const bytes = await patchWorkbookStyles({ ...source, parts }, [{ sheetId: '1', row: 0, column: 0, bold: true }]);
  const independent = new ExcelJS.Workbook(); await independent.xlsx.load(Uint8Array.from(bytes).buffer);
  expect(independent.worksheets[0]!.getCell('A1').font).toMatchObject({ name: 'Arial', size: 14, italic: true, bold: true, color: { theme: 4 } });
  expect(independent.worksheets[0]!.getCell('A1').alignment).toMatchObject({ horizontal: 'right', wrapText: true });
  expect(independent.worksheets[0]!.getCell('A1').numFmt).toBe('$0.00');
  row.setAttribute('customFormat', 'invalid'); parts.set(part, Buffer.from(document.toString()));
  await expect(patchWorkbookStyles({ ...source, parts }, [{ sheetId: '1', row: 0, column: 0, bold: true }])).rejects.toThrow('Invalid row formatting flag');
});

it('rejects malformed indices, counts and duplicate component tables before formatting', async () => {
  const source = await fixture();
  for (const mutate of [
    (parts: Map<string, Buffer>) => { const doc = xmlPart(parts, 'xl/worksheets/sheet1.xml'); children(children(child(doc.documentElement!, 'sheetData')!, 'row')[0]!, 'c')[0]!.setAttribute('s', ''); parts.set('xl/worksheets/sheet1.xml', Buffer.from(doc.toString())); },
    (parts: Map<string, Buffer>) => { const doc = xmlPart(parts, 'xl/styles.xml'); children(child(doc.documentElement!, 'cellXfs')!, 'xf')[0]!.setAttribute('fontId', '1.0'); parts.set('xl/styles.xml', Buffer.from(doc.toString())); },
    (parts: Map<string, Buffer>) => { const doc = xmlPart(parts, 'xl/styles.xml'); child(doc.documentElement!, 'fonts')!.setAttribute('count', '999'); parts.set('xl/styles.xml', Buffer.from(doc.toString())); },
    (parts: Map<string, Buffer>) => { const doc = xmlPart(parts, 'xl/styles.xml'); doc.documentElement!.appendChild(child(doc.documentElement!, 'fills')!.cloneNode(true)); parts.set('xl/styles.xml', Buffer.from(doc.toString())); },
  ]) {
    const parts = new Map(source.parts); mutate(parts);
    const error = await patchWorkbookStyles({ ...source, parts }, [{ sheetId: '1', row: 0, column: 0, bold: true }]).then(() => null, error => error);
    expect(error).toBeInstanceOf(Error);
  }
});
it('indexes source rows and component signatures once for a thousand-cell formatting selection', async () => {
  const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('Many');
  for (let row = 1; row <= 1000; row++) { sheet.getCell(row, 1).value = row; sheet.getCell(row, 1).font = { name: `Font${row % 10}`, size: 11 }; }
  const source = await readXlsxWorkbook(Buffer.from(await book.xlsx.writeBuffer()));
  const edits = Array.from({ length: 1000 }, (_, row) => ({ sheetId: '1', row, column: 0, bold: true }));
  // Array.from is the primitive used by both XML child scanning and structural
  // signatures. This checks work rather than imposing a machine-speed deadline.
  const scanned = vi.spyOn(Array, 'from'); let bytes: Buffer, operations: number;
  try { bytes = await patchWorkbookStyles(source, edits); operations = scanned.mock.calls.length; }
  finally { scanned.mockRestore(); }
  expect(operations).toBeLessThan(80_000);
  const independent = new ExcelJS.Workbook(); await independent.xlsx.load(Uint8Array.from(bytes!).buffer);
  expect(independent.worksheets[0]!.getCell('A1000').font).toMatchObject({ name: 'Font0', bold: true });
  const reopened = await readXlsxWorkbook(bytes!); expect(reopened.model.styles.length).toBeLessThan(30);
});

it('writes automatic font color and no fill as real OOXML rather than white paint', async () => {
  const source = await fixture(); const bytes = await patchWorkbookStyles(source, [{ sheetId: '1', row: 0, column: 0, fontColor: null, fillColor: null }]);
  const independent = new ExcelJS.Workbook(); await independent.xlsx.load(Uint8Array.from(bytes).buffer);
  expect(independent.worksheets[0]!.getCell('A1').font.color).toBeUndefined(); // pinned reader omits auto=1
  const reopened = await readXlsxWorkbook(bytes), cell = reopened.model.sheets[0]!.cells.find(cell => cell.row === 0 && cell.column === 0)!;
  expect(reopened.model.styles[cell.style!]?.font?.color).toEqual({ kind: 'auto' });
  expect(reopened.parts.get('xl/styles.xml')!.toString()).toContain('auto="1"');
  expect(independent.worksheets[0]!.getCell('A1').fill).toMatchObject({ type: 'pattern', pattern: 'none' });
  expect(independent.worksheets[0]!.getCell('B1').result).toBe(71);
});
