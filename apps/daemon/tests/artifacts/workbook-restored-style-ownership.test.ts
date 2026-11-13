import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import ExcelJS from 'exceljs-community';
import { expect, it } from 'vitest';
import type { WorkbookSheetTemplateEntry } from '../../src/artifacts/workbook/sheet-template.js';
import { child, children, xmlPart } from '../../src/artifacts/workbook/parts.js';
import { writeWorkbookPackage } from '../../src/artifacts/workbook/package.js';
import { writeWorkbookXml } from '../../src/artifacts/workbook/xml.js';
import { readXlsxWorkbook } from '../../src/artifacts/workbook/reader.js';
import { calculateWorkbookCellEdits, calculateWorkbookSheetEdits } from '../../src/artifacts/workbook/calculated-patch.js';
import { calculateWorkbookRestoredSheetEdits } from '../../src/artifacts/workbook/sheet-restoration.js';

async function restorationFixture() {
  const book = new ExcelJS.Workbook(); book.addWorksheet('Survivor').getCell('A1').value = 3;
  const restoring = book.addWorksheet('Restored'); restoring.getCell('A1').value = 12; restoring.getCell('A1').font = { name: 'Arial', bold: true, size: 11 };
  restoring.getCell('B1').value = 4; restoring.getCell('B1').font = { italic: true, size: 13 };
  restoring.getCell('C1').value = 5; restoring.getCell('C1').font = { underline: true, size: 14 };
  const bytes = Buffer.from(await book.xlsx.writeBuffer()), source = await readXlsxWorkbook(bytes);
  const original = source.model.sheets[1]!.cells[0]!;
  expect(original.style).toBe(1);
  if (original.kind !== 'number') throw new Error('The owned fixture needs a numeric source cell.');
  const current = await readXlsxWorkbook((await calculateWorkbookSheetEdits(source, [{ sheetId: '1', name: 'Survivor', origin: 'source' }], [], [], [{ sheetId: '1', row: 0, column: 0, fontSize: 22.25 }])).bytes);
  expect(current.model.sheets[0]!.cells[0]!.style).toBe(1);
  expect(current.model.styles[1]!.font?.size).toBe(22.25); // same ordinal, different source style
  const target: WorkbookSheetTemplateEntry[] = [{ sheetId: '1', name: 'Survivor', origin: 'source' }, { sheetId: '2', name: 'Restored', origin: 'restore' }];
  const templates = [{ sheetId: '2', bytes, sourceSha256: createHash('sha256').update(bytes).digest('hex') }];
  return { current, original, target, templates };
}
it('applies a restored styled scalar edit without treating a historical compact style ordinal as current ownership', async () => {
  const { current, original, target, templates } = await restorationFixture();
  const edit = { sheetId: '2', cell: { ...original, value: 17 } };
  const result = await calculateWorkbookRestoredSheetEdits(current, target, templates, [edit]);
  expect(edit.cell.style).toBe(1); // Keep the caller's retained plan/hash untouched.
  const saved = await readXlsxWorkbook(result.bytes), cell = saved.model.sheets[1]!.cells[0]!;
  expect(cell.value).toBe(17); expect(saved.model.styles[cell.style!]!.font).toMatchObject({ name: 'Arial', bold: true, size: 11 });
  expect(saved.model.styles[saved.model.sheets[0]!.cells[0]!.style!]!.font?.size).toBe(22.25);
  // Inspect the actual emitted XLSX independently of the production reader and
  // compact-style guard: historical ink and current survivor ink must coexist.
  const independent = new ExcelJS.Workbook(); await independent.xlsx.load(Uint8Array.from(result.bytes).buffer);
  expect(independent.getWorksheet('Restored')!.getCell('A1').value).toBe(17);
  expect(independent.getWorksheet('Restored')!.getCell('A1').font).toMatchObject({ name: 'Arial', bold: true, size: 11 });
  expect(independent.getWorksheet('Survivor')!.getCell('A1').value).toBe(3);
  // Pinned ExcelJS reads <sz> through IntegerXform/parseInt. Inspect the raw
  // emitted font ownership independently to qualify fractional size losslessly.
  const size = execFileSync('python3', ['-c', `
import io,sys,zipfile,xml.etree.ElementTree as E
z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()));n={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
cell=E.fromstring(z.read('xl/worksheets/sheet1.xml')).find('.//s:c[@r="A1"]',n)
styles=E.fromstring(z.read('xl/styles.xml'));xf=styles.find('s:cellXfs',n)[int(cell.get('s','0'))]
print(styles.find('s:fonts',n)[int(xf.get('fontId','0'))].find('s:sz',n).get('val'))
`], { input: result.bytes, encoding: 'utf8' });
  expect(size.trim()).toBe('22.25');
});

it('retains a surviving styled scalar edit when deleting an earlier style owner compacts the reader table', async () => {
  const book = new ExcelJS.Workbook(), removed = book.addWorksheet('Removed'), survivor = book.addWorksheet('Survivor');
  removed.getCell('A1').value = 12; removed.getCell('A1').font = { bold: true, size: 11 };
  survivor.getCell('A1').value = 20; survivor.getCell('A1').font = { size: 22.25 };
  const source = await readXlsxWorkbook(Buffer.from(await book.xlsx.writeBuffer())), before = source.model.sheets[1]!.cells[0]!;
  expect(before.style).toBe(2); if (before.kind !== 'number') throw new Error('Numeric source required.');
  const result = await calculateWorkbookSheetEdits(source, [{ sheetId: '2', name: 'Survivor', origin: 'source' }], [{ sheetId: '2', cell: { ...before, value: 21 } }]);
  const saved = await readXlsxWorkbook(result.bytes), cell = saved.model.sheets[0]!.cells[0]!;
  expect(cell.value).toBe(21); expect(saved.model.styles[cell.style!]!.font?.size).toBe(22.25);
});

it('rebinds the exact surviving coordinate after ordinary row deletion and structural reparse', async () => {
  const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('Sheet');
  sheet.getCell('A1').value = 12; sheet.getCell('A1').font = { bold: true, size: 11 };
  sheet.getCell('A2').value = 20; sheet.getCell('A2').font = { size: 22.25 };
  const source = await readXlsxWorkbook(Buffer.from(await book.xlsx.writeBuffer())), before = source.model.sheets[0]!.cells.find(cell => cell.row === 1)!;
  expect(before.style).toBe(2); if (before.kind !== 'number') throw new Error('Numeric source required.');
  const result = await calculateWorkbookCellEdits(source, [{ sheetId: '1', cell: { ...before, row: 0, value: 21 } }], [], [], [], [{ sheetId: '1', sourceRows: 100, sourceColumns: 26, rows: Array.from({ length: 99 }, (_, index) => index + 1), columns: Array.from({ length: 26 }, (_, index) => index) }]);
  const saved = await readXlsxWorkbook(result.bytes), cell = saved.model.sheets[0]!.cells[0]!;
  expect(cell).toMatchObject({ row: 0, column: 0, value: 21 }); expect(saved.model.styles[cell.style!]!.font?.size).toBe(22.25);
});

it('retains exact prepared-preview guards and routes intentional formatting through its separate adapter', async () => {
  const { current, original, target, templates } = await restorationFixture();
  const baseline = await calculateWorkbookRestoredSheetEdits(current, target, templates);
  const preparedStyle = baseline.model.sheets[1]!.cells.find(cell => cell.row === 0 && cell.column === 0)!.style;
  expect(preparedStyle).toBe(2);
  const result = await calculateWorkbookRestoredSheetEdits(current, target, templates, [{ sheetId: '2', cell: { ...original, style: preparedStyle!, value: 17 } }], [], [{ sheetId: '2', row: 0, column: 0, fontSize: 18 }]);
  const cell = result.model.sheets[1]!.cells.find(cell => cell.row === 0 && cell.column === 0)!;
  expect(cell.value).toBe(17); expect(result.model.styles[cell.style!]!.font).toMatchObject({ name: 'Arial', bold: true, size: 18 });
});

it('rebinds a restored source guard only after the validated row projection without replaying geometry', async () => {
  const { current, original, target, templates } = await restorationFixture();
  const result = await calculateWorkbookRestoredSheetEdits(current, target, templates, [{ sheetId: '2', cell: { ...original, row: 1, value: 17 } }], [], [], [], [{ sheetId: '2', sourceRows: 100, sourceColumns: 26, rows: [null, ...Array.from({ length: 100 }, (_, index) => index)], columns: Array.from({ length: 26 }, (_, index) => index) }]);
  const sheet = result.model.sheets[1]!, cell = sheet.cells.find(cell => cell.row === 1 && cell.column === 0)!;
  expect(cell.value).toBe(17); expect(result.model.styles[cell.style!]!.font).toMatchObject({ name: 'Arial', bold: true, size: 11 });
  expect(sheet.cells.some(cell => cell.row === 0 && cell.column === 0)).toBe(false);
  expect(sheet.cells.some(cell => cell.row === 2 && cell.column === 0)).toBe(false);
});

it('refuses wrong or unknown style guards and never borrows a neighboring style for a new cell', async () => {
  const { current, original, target, templates } = await restorationFixture();
  const styles = Buffer.from(current.parts.get('xl/styles.xml')!);
  for (const cell of [{ ...original, style: 3, value: 17 }, { ...original, style: 999, value: 17 }, { ...original, row: 5, column: 5, value: 17 }]) await expect(calculateWorkbookRestoredSheetEdits(current, target, templates, [{ sheetId: '2', cell }])).rejects.toThrow('formatting patch');
  await expect(calculateWorkbookRestoredSheetEdits(current, target, templates, [{ sheetId: '2', cell: { ...original, row: 0, value: 17 } }], [], [], [], [{ sheetId: '2', sourceRows: 100, sourceColumns: 26, rows: [null, ...Array.from({ length: 100 }, (_, index) => index)], columns: Array.from({ length: 26 }, (_, index) => index) }])).rejects.toThrow('formatting patch');
  expect(current.parts.get('xl/styles.xml')).toEqual(styles);
});

it('refuses a changed historical raw style prefix instead of declaring a new equivalence', async () => {
  const { current, original, target, templates } = await restorationFixture();
  const styles = xmlPart(current.parts, 'xl/styles.xml'), fonts = child(styles.documentElement!, 'fonts')!;
  const size = child(children(fonts, 'font')[1]!, 'sz')!; size.setAttribute('val', '12');
  const changed = await readXlsxWorkbook(await writeWorkbookPackage(new Map(current.parts).set('xl/styles.xml', writeWorkbookXml(styles))));
  await expect(calculateWorkbookRestoredSheetEdits(changed, target, templates, [{ sheetId: '2', cell: { ...original, value: 17 } }])).rejects.toThrow('resources');
});
