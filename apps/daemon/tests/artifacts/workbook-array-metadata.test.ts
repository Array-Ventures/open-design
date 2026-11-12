import { expect, it } from 'vitest';
import ExcelJS from 'exceljs-community';
import JSZip from 'jszip';
import { readXlsxWorkbook } from '../../src/artifacts/workbook/reader.js';
import { patchWorkbookCells } from '../../src/artifacts/workbook/cell-patch.js';
import { calculateWorkbook } from '../../src/artifacts/workbook/calculate.js';
import { parseWorkbookXml, writeWorkbookXml } from '../../src/artifacts/workbook/xml.js';
import { children, child } from '../../src/artifacts/workbook/parts.js';

async function fixture(kind: 'array' | 'dataTable' = 'array', ref = 'C3:C5') {
  const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('Inputs');
  sheet.getCell('A1').value = 10;
  sheet.getCell('C3').value = kind === 'array' ? { formula: '_xlfn.SEQUENCE(3)', result: 1 } : 1;
  sheet.getCell('C4').value = 2; sheet.getCell('C5').value = 3;
  const zip = await JSZip.loadAsync(await book.xlsx.writeBuffer());
  const source = await zip.file('xl/worksheets/sheet1.xml')!.async('nodebuffer');
  const xml = parseWorkbookXml(source), root = xml.documentElement!;
  const anchor = children(child(root, 'sheetData')!, 'row').flatMap(row => children(row, 'c')).find(cell => cell.getAttribute('r') === 'C3')!;
  const f = child(anchor, 'f') ?? xml.createElementNS(root.namespaceURI, 'f');
  if (!f.parentNode) anchor.insertBefore(f, anchor.firstChild);
  f.setAttribute('t', kind); f.setAttribute('ref', ref);
  if (kind === 'dataTable') { f.setAttribute('r1', 'A1'); f.setAttribute('dt2D', '0'); }
  const bytes = writeWorkbookXml(xml); zip.file('xl/worksheets/sheet1.xml', bytes);
  return { bytes: await zip.generateAsync({ type: 'nodebuffer' }), sourcePart: bytes };
}

it.each(['array', 'dataTable'] as const)('retains explicit %s ownership and every original cached value without changing source bytes', async kind => {
  const f = await fixture(kind), source = await readXlsxWorkbook(f.bytes), sheet = source.model.sheets[0]!;
  expect(sheet.arrayFormulas).toEqual([{ kind, row: 2, column: 2, range: { startRow: 2, endRow: 4, startColumn: 2, endColumn: 2 } }]);
  expect(sheet.cells.filter(cell => cell.column === 2).map(cell => cell.value)).toEqual([1, 2, 3]);
  expect(sheet.cells.find(cell => cell.row === 2 && cell.column === 2)?.formula).toBe(kind === 'array' ? '=_xlfn.SEQUENCE(3)' : undefined);
  expect(source.parts.get('xl/worksheets/sheet1.xml')).toEqual(f.sourcePart);
  // Metadata admission must not turn array editing into a supported save.
  await expect(patchWorkbookCells(source, [{ sheetId: sheet.id, cell: { row: 3, column: 2, kind: 'number', value: 99 } }])).rejects.toMatchObject({ code: 'WORKBOOK_UNSUPPORTED' });
});

it('refuses invalid owners, reversed references and oversized ranges before importer expansion', async () => {
  for (const ref of ['', 'B2:C5', 'C3:C2', 'C3:XFD1048576']) {
    const f = await fixture('array', ref);
    await expect(readXlsxWorkbook(f.bytes)).rejects.toMatchObject({ code: ref.endsWith('XFD1048576') ? 'WORKBOOK_LIMIT' : 'WORKBOOK_INVALID' });
  }
});

it('refuses overlapping array ownership instead of guessing which cache owns a follower', async () => {
  const f = await fixture(), zip = await JSZip.loadAsync(f.bytes);
  const xml = parseWorkbookXml(await zip.file('xl/worksheets/sheet1.xml')!.async('nodebuffer')), root = xml.documentElement!;
  const cell = children(child(root, 'sheetData')!, 'row').flatMap(row => children(row, 'c')).find(cell => cell.getAttribute('r') === 'C4')!;
  const formula = xml.createElementNS(root.namespaceURI, 'f'); formula.setAttribute('t', 'array'); formula.setAttribute('ref', 'C4:C6'); formula.textContent = '1+1';
  cell.insertBefore(formula, cell.firstChild); zip.file('xl/worksheets/sheet1.xml', writeWorkbookXml(xml));
  await expect(readXlsxWorkbook(await zip.generateAsync({ type: 'nodebuffer' }))).rejects.toMatchObject({ code: 'WORKBOOK_INVALID' });
});

it('reports verified empty ownership for ordinary workbooks rather than an old pin’s unknown absence', async () => {
  const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('Inputs');
  sheet.getCell('A1').value = { formula: '1+1', result: 2 }; sheet.getCell('A2').value = 3;
  const source = await readXlsxWorkbook(Buffer.from(await book.xlsx.writeBuffer()));
  expect(source.model.sheets[0]!.arrayFormulas).toEqual([]);
});

it('does not confuse a shared-formula ref with source array ownership', async () => {
  const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('Inputs');
  sheet.getCell('A1').value = 10; sheet.fillFormula('C3:C5', 'A1+1', [11, 12, 13]);
  const source = await readXlsxWorkbook(Buffer.from(await book.xlsx.writeBuffer()));
  expect(source.model.sheets[0]!.arrayFormulas).toEqual([]);
  expect(source.model.sheets[0]!.cells.filter(cell => cell.formula).map(cell => cell.formula)).toEqual(['=A1+1', '=A2+1', '=A3+1']);
});

it('refuses outside-input recalculation of a cached data table without changing its source package', async () => {
  const f = await fixture('dataTable'), source = await readXlsxWorkbook(f.bytes);
  const originalParts = new Map([...source.parts].map(([name, bytes]) => [name, Buffer.from(bytes)]));
  const updated = await patchWorkbookCells(source, [{ sheetId: source.model.sheets[0]!.id, cell: { row: 0, column: 0, kind: 'number', value: 20 } }]);
  const pending = await readXlsxWorkbook(updated);
  await expect(calculateWorkbook(pending.model)).rejects.toMatchObject({ code: 'WORKBOOK_UNSUPPORTED', message: expect.stringContaining('data tables cannot be recalculated') });
  await expect(calculateWorkbook(source.model)).rejects.toMatchObject({ code: 'WORKBOOK_UNSUPPORTED' });
  expect(source.parts).toEqual(originalParts); expect(source.parts.get('xl/worksheets/sheet1.xml')).toEqual(f.sourcePart);
  expect(source.model.sheets[0]!.cells.filter(cell => cell.column === 2).map(cell => cell.value)).toEqual([1, 2, 3]);
});
