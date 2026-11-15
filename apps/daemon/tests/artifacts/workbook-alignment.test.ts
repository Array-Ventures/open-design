import { expect, it } from 'vitest';
import ExcelJS from 'exceljs-community';
import JSZip from 'jszip';
import { readXlsxWorkbook } from '../../src/artifacts/workbook/reader.js';
import { calculateWorkbookCellEdits } from '../../src/artifacts/workbook/calculated-patch.js';
import { patchWorkbookStyles } from '../../src/artifacts/workbook/style-patch.js';
import { child, children, xmlPart } from '../../src/artifacts/workbook/parts.js';

async function fixture() {
  const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('Alignment');
  sheet.getCell('A1').value = 2;
  sheet.getCell('A1').font = { name: 'Arial', size: 14, italic: true, color: { theme: 4 } };
  sheet.getCell('A1').alignment = { horizontal: 'right', vertical: 'top', wrapText: true, textRotation: 30, indent: 2, shrinkToFit: true };
  sheet.getCell('A1').numFmt = '$0.00';
  sheet.getCell('A1').border = { bottom: { style: 'thin', color: { argb: 'FF123456' } } };
  sheet.getCell('A1').protection = { locked: false };
  sheet.getCell('B1').value = { formula: 'A1*2', result: 4 };
  sheet.getCell('C1').value = { richText: [{ text: 'Retained', font: { bold: true } }] };
  sheet.getColumn(4).alignment = { horizontal: 'right', vertical: 'bottom', wrapText: true };
  const zip = await JSZip.loadAsync(await book.xlsx.writeBuffer());
  zip.file('custom/opaque.bin', Buffer.from([1, 2, 255]));
  return readXlsxWorkbook(await zip.generateAsync({ type: 'nodebuffer' }));
}
function xfs(source: Awaited<ReturnType<typeof fixture>>) { return children(child(xmlPart(source.parts, 'xl/styles.xml').documentElement!, 'cellXfs')!, 'xf'); }
function cellXf(source: Awaited<ReturnType<typeof fixture>>, address = 'A1') {
  const cell = xmlPart(source.parts, 'xl/worksheets/sheet1.xml').getElementsByTagName('c');
  const entry = Array.from(cell).find(cell => cell.getAttribute('r') === address)!;
  return xfs(source)[Number(entry.getAttribute('s') ?? 0)]!;
}
it.each(['general', 'left', 'center', 'right'] as const)('writes %s through the save adapter preserving all other style and package owners', async horizontalAlignment => {
  const source = await fixture(), original = cellXf(source);
  const result = await calculateWorkbookCellEdits(source, [], [], [{ sheetId: '1', row: 0, column: 0, horizontalAlignment }]);
  const reopened = await readXlsxWorkbook(result.bytes), actual = cellXf(reopened);
  expect(child(actual, 'alignment')!.getAttribute('horizontal')).toBe(horizontalAlignment);
  const expected = original.cloneNode(true) as typeof original;
  child(expected, 'alignment')!.setAttribute('horizontal', horizontalAlignment); expected.setAttribute('applyAlignment', '1');
  expect(actual.toString()).toBe(expected.toString());
  expect(xfs(reopened).slice(0, xfs(source).length).map(x => x.toString())).toEqual(xfs(source).map(x => x.toString()));
  for (const [part, bytes] of source.parts) if (!['xl/styles.xml', 'xl/worksheets/sheet1.xml'].includes(part)) expect(reopened.parts.get(part), part).toEqual(bytes);
  const independent = new ExcelJS.Workbook(); await independent.xlsx.load(Uint8Array.from(result.bytes).buffer);
  const a1 = independent.worksheets[0]!.getCell('A1');
  expect(a1.alignment).toEqual({ horizontal: horizontalAlignment, vertical: 'top', wrapText: true, textRotation: 30, indent: 2, shrinkToFit: true });
  expect(a1.font).toEqual({ name: 'Arial', size: 14, italic: true, color: { theme: 4 } });
  expect(a1.numFmt).toBe('$0.00'); expect(a1.protection.locked).toBe(false);
  expect(independent.worksheets[0]!.getCell('B1').value).toEqual({ formula: 'A1*2', result: 4 });
  expect(independent.worksheets[0]!.getCell('C1').value).toEqual({ richText: [{ text: 'Retained', font: { bold: true } }] });
});
it('deduplicates identical alignment XFs and repeated saves, including inherited blank column cells', async () => {
  const source = await fixture(), edits = [4, 5].map(row => ({ sheetId: '1', row, column: 3, horizontalAlignment: 'left' as const }));
  const first = await readXlsxWorkbook(await patchWorkbookStyles(source, edits));
  const second = await readXlsxWorkbook(await patchWorkbookStyles(first, edits));
  expect(cellXf(first, 'D5').toString()).toBe(cellXf(first, 'D6').toString());
  expect(child(cellXf(first, 'D5'), 'alignment')!.getAttribute('wrapText')).toBe('1');
  expect(child(cellXf(first, 'D5'), 'alignment')!.getAttribute('vertical')).toBe('bottom');
  expect(second.parts.get('xl/styles.xml')).toEqual(first.parts.get('xl/styles.xml'));
  expect(second.parts.get('xl/worksheets/sheet1.xml')).toEqual(first.parts.get('xl/worksheets/sheet1.xml'));
});

it('refuses malformed alignment flags', async () => {
  const source = await fixture(), styles = xmlPart(source.parts, 'xl/styles.xml');
  const id = xfs(source).findIndex(x => x.toString() === cellXf(source).toString());
  children(child(styles.documentElement!, 'cellXfs')!, 'xf')[id]!.setAttribute('applyAlignment', 'invalid');
  const parts = new Map(source.parts); parts.set('xl/styles.xml', Buffer.from(styles.toString()));
  await expect(patchWorkbookStyles({ ...source, parts }, [{ sheetId: '1', row: 0, column: 0, horizontalAlignment: 'center' }])).rejects.toThrow('alignment application flag');
});

it('combines scalar calculation and alignment without allowing style-index assignment', async () => {
  const source = await fixture(), cell = source.model.sheets[0]!.cells.find(c => c.row === 0 && c.column === 0)!;
  const styles = [{ sheetId: '1', row: 0, column: 0, horizontalAlignment: 'center' as const }];
  const saved = await calculateWorkbookCellEdits(source, [{ sheetId: '1', cell: { ...cell, kind: 'number', value: 7 } }], [], styles);
  const independent = new ExcelJS.Workbook(); await independent.xlsx.load(Uint8Array.from(saved.bytes).buffer);
  expect(independent.worksheets[0]!.getCell('A1').value).toBe(7);
  expect(independent.worksheets[0]!.getCell('B1').result).toBe(14);
  expect(independent.worksheets[0]!.getCell('A1').alignment.horizontal).toBe('center');
  await expect(calculateWorkbookCellEdits(source, [{ sheetId: '1', cell: { ...cell, kind: 'number', style: 999, value: 7 } }], [], styles)).rejects.toThrow();
});

it.each(['false', 'omitted'] as const)('materializes effective named-style alignment (%s) without changing the sibling or dormant source XF', async mode => {
  const source = await fixture(), styles = xmlPart(source.parts, 'xl/styles.xml'), root = styles.documentElement!;
  const id = xfs(source).findIndex(x => x.toString() === cellXf(source).toString());
  const xf = children(child(root, 'cellXfs')!, 'xf')[id]!, alignment = child(xf, 'alignment')!;
  const parent = child(root, 'cellStyleXfs')!.firstChild!;
  const inherited = alignment.cloneNode(true) as typeof alignment;
  inherited.setAttribute('horizontal', 'left'); inherited.setAttribute('vertical', 'center'); inherited.setAttribute('textRotation', '45');
  parent.appendChild(inherited);
  if (mode === 'false') xf.setAttribute('applyAlignment', 'false');
  else { xf.removeAttribute('applyAlignment'); xf.removeChild(alignment); }
  const sheet = xmlPart(source.parts, 'xl/worksheets/sheet1.xml');
  const sibling = Array.from(sheet.getElementsByTagName('c')).find(c => c.getAttribute('r') === 'B1')!;
  sibling.setAttribute('s', String(id));
  const parts = new Map(source.parts); parts.set('xl/styles.xml', Buffer.from(styles.toString())); parts.set('xl/worksheets/sheet1.xml', Buffer.from(sheet.toString()));
  const { writeWorkbookPackage } = await import('../../src/artifacts/workbook/package.js');
  const actualSource = await readXlsxWorkbook(await writeWorkbookPackage(parts));
  const sourceCell = actualSource.model.sheets[0]!.cells.find(c => c.row === 0 && c.column === 0)!;
  expect(actualSource.model.styles[sourceCell.style ?? 0]?.alignment).toMatchObject({ horizontal: 'left', vertical: 'middle', rotation: 45 });
  const result = await patchWorkbookStyles(actualSource, [{ sheetId: '1', row: 0, column: 0, horizontalAlignment: 'right' }]);
  const reopened = await readXlsxWorkbook(result), output = cellXf(reopened);
  const expected = inherited.cloneNode(true) as typeof inherited; expected.setAttribute('horizontal', 'right');
  expect(child(output, 'alignment')!.toString()).toBe(expected.toString());
  expect(xfs(reopened).slice(0, xfs(actualSource).length).map(x => x.toString())).toEqual(xfs(actualSource).map(x => x.toString()));
  const outputSibling = Array.from(xmlPart(reopened.parts, 'xl/worksheets/sheet1.xml').getElementsByTagName('c')).find(c => c.getAttribute('r') === 'B1')!;
  expect(outputSibling.toString()).toBe(sibling.toString());
  const independent = new ExcelJS.Workbook(); await independent.xlsx.load(Uint8Array.from(result).buffer);
  expect(independent.worksheets[0]!.getCell('A1').alignment).toMatchObject({ horizontal: 'right', vertical: 'middle', wrapText: true, textRotation: 45, indent: 2, shrinkToFit: true });
});

it('retains an implicit local alignment instead of replacing it with named-style alignment', async () => {
  const source = await fixture(), styles = xmlPart(source.parts, 'xl/styles.xml'), root = styles.documentElement!;
  const id = xfs(source).findIndex(x => x.toString() === cellXf(source).toString());
  const xf = children(child(root, 'cellXfs')!, 'xf')[id]!;
  xf.removeAttribute('applyAlignment');
  const parent = child(root, 'cellStyleXfs')!.firstChild!, inherited = child(xf, 'alignment')!.cloneNode(true) as typeof xf;
  inherited.setAttribute('vertical', 'bottom'); parent.appendChild(inherited);
  const parts = new Map(source.parts); parts.set('xl/styles.xml', Buffer.from(styles.toString()));
  const { writeWorkbookPackage } = await import('../../src/artifacts/workbook/package.js');
  const actual = await readXlsxWorkbook(await writeWorkbookPackage(parts));
  const cell = actual.model.sheets[0]!.cells.find(c => c.row === 0 && c.column === 0)!;
  expect(actual.model.styles[cell.style ?? 0]?.alignment?.vertical).toBe('top');
  const saved = await readXlsxWorkbook(await patchWorkbookStyles(actual, [{ sheetId: '1', row: 0, column: 0, horizontalAlignment: 'center' }]));
  expect(child(cellXf(saved), 'alignment')!.getAttribute('vertical')).toBe('top');
});

it('refuses missing parents, ambiguous alignments and malformed parent tables before importing or writing', async () => {
  const source = await fixture();
  for (const mutate of [
    (root: ReturnType<typeof xmlPart>['documentElement']) => children(child(root!, 'cellXfs')!, 'xf')[0]!.setAttribute('xfId', '999'),
    (root: ReturnType<typeof xmlPart>['documentElement']) => child(root!, 'cellStyleXfs')!.setAttribute('count', '999'),
    (root: ReturnType<typeof xmlPart>['documentElement']) => root!.appendChild(child(root!, 'cellStyleXfs')!.cloneNode(true)),
    (root: ReturnType<typeof xmlPart>['documentElement']) => {
      const xf = children(child(root!, 'cellXfs')!, 'xf').find(x => child(x, 'alignment'))!;
      xf.appendChild(child(xf, 'alignment')!.cloneNode(true));
    },
  ]) {
    const styles = xmlPart(source.parts, 'xl/styles.xml'); mutate(styles.documentElement);
    const parts = new Map(source.parts); parts.set('xl/styles.xml', Buffer.from(styles.toString()));
    const { writeWorkbookPackage } = await import('../../src/artifacts/workbook/package.js');
    await expect(readXlsxWorkbook(await writeWorkbookPackage(parts))).rejects.toThrow();
    await expect(patchWorkbookStyles({ ...source, parts }, [{ sheetId: '1', row: 0, column: 0, horizontalAlignment: 'left' }])).rejects.toThrow();
  }
});

it('uses the actual custom-row alignment and refuses intersecting row/column owners', async () => {
  const source = await fixture(), part = 'xl/worksheets/sheet1.xml', document = xmlPart(source.parts, part);
  const row = children(child(document.documentElement!, 'sheetData')!, 'row')[0]!;
  const cell = children(row, 'c').find(c => c.getAttribute('r') === 'A1')!;
  row.setAttribute('s', cell.getAttribute('s')!); row.setAttribute('customFormat', 'true'); cell.removeAttribute('s');
  const parts = new Map(source.parts); parts.set(part, Buffer.from(document.toString()));
  const saved = await readXlsxWorkbook(await patchWorkbookStyles({ ...source, parts }, [{ sheetId: '1', row: 0, column: 0, horizontalAlignment: 'general' }]));
  expect(child(cellXf(saved), 'alignment')!.getAttribute('horizontal')).toBe('general');
  expect(child(cellXf(saved), 'alignment')!.getAttribute('textRotation')).toBe('30');
  const d1 = children(row, 'c').find(c => c.getAttribute('r') === 'D1')!; d1.removeAttribute('s');
  parts.set(part, Buffer.from(document.toString()));
  await expect(patchWorkbookStyles({ ...source, parts }, [{ sheetId: '1', row: 0, column: 3, horizontalAlignment: 'left' }])).rejects.toMatchObject({ code: 'WORKBOOK_UNSUPPORTED' });
});
