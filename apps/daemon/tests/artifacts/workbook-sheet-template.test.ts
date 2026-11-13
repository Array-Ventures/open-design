import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs-community';
import { expect, it } from 'vitest';
import { readXlsxWorkbook } from '../../src/artifacts/workbook/reader.js';
import { patchWorkbookSheets } from '../../src/artifacts/workbook/sheet-patch.js';
import { prepareWorkbookSheetTemplate, type WorkbookSheetTemplateEntry } from '../../src/artifacts/workbook/sheet-template.js';
import { child, children, xmlPart } from '../../src/artifacts/workbook/parts.js';
import { workbookSheetProjectionSchema } from '@open-design/contracts/runtime/workbook';

async function fixture() {
  const book = new ExcelJS.Workbook();
  book.addWorksheet('Inputs').getCell('A1').value = 2;
  const deleted = book.addWorksheet('Restore me');
  deleted.getCell('A1').value = 'Historical shared text'; deleted.getCell('A1').font = { name: 'Arial', bold: true };
  deleted.getCell('B2').value = { formula: `'Other old'!A1+Inputs!A1`, result: 12 };
  deleted.getCell('C3').value = { formula: `IF(1=1,"Other old!A1",'Other old'!A1)`, result: 'Other old!A1' };
  deleted.getRow(2).height = 37; deleted.getColumn(2).width = 24;
  deleted.mergeCells('D4:E5'); deleted.getCell('D4').value = 'Merged';
  deleted.headerFooter.oddHeader = 'Retained header'; deleted.pageSetup.orientation = 'landscape';
  book.addWorksheet('Other old').getCell('A1').value = 10;
  const bytes = Buffer.from(await book.xlsx.writeBuffer({ useSharedStrings: true })), historical = await readXlsxWorkbook(bytes);
  const current = await readXlsxWorkbook(await patchWorkbookSheets(historical, [{ sheetId: '1', name: 'Inputs', origin: 'source' }, { sheetId: '3', name: 'Other renamed', origin: 'source' }]));
  const target: WorkbookSheetTemplateEntry[] = [{ sheetId: '1', name: 'Inputs', origin: 'source' }, { sheetId: '2', name: 'Restored', origin: 'restore' }, { sheetId: '3', name: 'Other renamed', origin: 'source' }];
  return { bytes, historical, current, target, sha: createHash('sha256').update(bytes).digest('hex') };
}
it('retains raw historical metadata/indices and binds references by exact final IDs without mutating either source', async () => {
  const { bytes, historical, current, target, sha } = await fixture();
  const retained = new Map([...current.parts].map(([name, body]) => [name, Buffer.from(body)]));
  const template = await prepareWorkbookSheetTemplate(current, bytes, sha, '2', target);
  const document = xmlPart(new Map([['template.xml', template]]), 'template.xml'), root = document.documentElement!;
  const old = xmlPart(historical.parts, historical.sheetParts.get('2')!).documentElement!;
  for (const name of ['cols', 'mergeCells', 'headerFooter', 'pageSetup', 'pageMargins']) expect(child(root, name)?.toString()).toBe(child(old, name)?.toString());
  const rows = children(child(root, 'sheetData')!, 'row'), oldRows = children(child(old, 'sheetData')!, 'row');
  expect(rows[1]!.getAttribute('ht')).toBe('37');
  const first = children(rows[0]!, 'c')[0]!, oldFirst = children(oldRows[0]!, 'c')[0]!;
  expect(first.toString()).toBe(oldFirst.toString()); // raw style and shared-string indices
  const cells = rows.flatMap(row => children(row, 'c'));
  expect(child(cells.find(cell => cell.getAttribute('r') === 'B2')!, 'f')!.textContent).toBe("'Other renamed'!A1+Inputs!A1");
  expect(child(cells.find(cell => cell.getAttribute('r') === 'C3')!, 'f')!.textContent).toBe(`IF(1=1,"Other old!A1",'Other renamed'!A1)`);
  for (const cell of cells.filter(cell => child(cell, 'f'))) { expect(child(cell, 'v')).toBeUndefined(); expect(cell.hasAttribute('t')).toBe(false); }
  for (const [name, body] of retained) expect(current.parts.get(name)!.equals(body)).toBe(true);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(sha);
  expect(workbookSheetProjectionSchema.safeParse(target).success).toBe(false); // no wire capability exposed
});
it('does not retarget a removed historical ID to a new different ID with the old name', async () => {
  const { bytes, historical, sha } = await fixture();
  const current = await readXlsxWorkbook(await patchWorkbookSheets(historical, [{ sheetId: '1', name: 'Inputs', origin: 'source' }, { sheetId: '4', name: 'Other old', origin: 'new' }]));
  const template = await prepareWorkbookSheetTemplate(current, bytes, sha, '2', [{ sheetId: '1', name: 'Inputs', origin: 'source' }, { sheetId: '2', name: 'Restored', origin: 'restore' }, { sheetId: '4', name: 'Other old', origin: 'source' }]);
  const root = xmlPart(new Map([['template.xml', template]]), 'template.xml').documentElement!;
  const formulas = children(child(root, 'sheetData')!, 'row').flatMap(row => children(row, 'c')).map(cell => child(cell, 'f')?.textContent).filter(Boolean);
  expect(formulas).toEqual(['#REF!+Inputs!A1', 'IF(1=1,"Other old!A1",#REF!)']);
});
it('refuses wrong source hashes, missing IDs, colliding restorations and invalid final source identities', async () => {
  const { bytes, historical, current, sha, target } = await fixture();
  await expect(prepareWorkbookSheetTemplate(current, bytes, '0'.repeat(64), '2', target)).rejects.toThrow('hash');
  await expect(prepareWorkbookSheetTemplate(current, bytes, sha, '5', [...target.filter(sheet => sheet.sheetId !== '2'), { sheetId: '5', name: 'Missing', origin: 'restore' }])).rejects.toThrow('missing');
  await expect(prepareWorkbookSheetTemplate(historical, bytes, sha, '2', target)).rejects.toThrow('identity');
  await expect(prepareWorkbookSheetTemplate(current, bytes, sha, '2', [...target, { sheetId: '5', name: 'Missing', origin: 'source' }])).rejects.toThrow('identity');
});
