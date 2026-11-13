import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs-community';
import JSZip from 'jszip';
import { expect, it } from 'vitest';
import { readXlsxWorkbook } from '../../src/artifacts/workbook/reader.js';
import { patchWorkbookSheets } from '../../src/artifacts/workbook/sheet-patch.js';
import { prepareWorkbookSheetTemplate, type WorkbookSheetTemplateEntry } from '../../src/artifacts/workbook/sheet-template.js';
import { child, children, xmlPart } from '../../src/artifacts/workbook/parts.js';
import { workbookSheetProjectionSchema } from '@open-design/contracts/runtime/workbook';
import { calculateWorkbookRestoredSheetEdits } from '../../src/artifacts/workbook/sheet-restoration.js';
import { calculateWorkbookCellEdits } from '../../src/artifacts/workbook/calculated-patch.js';
import { WORKBOOK_PACKAGE_LIMITS } from '../../src/artifacts/workbook/package.js';

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
  expect(workbookSheetProjectionSchema.safeParse(target).success).toBe(false); // Bare source fixtures omit the required historical wire descriptor.
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
it('assembles and recalculates only the restored sheet while preserving prior current survivor edits', async () => {
  const { bytes, historical, current, sha, target } = await fixture();
  // The historical template still contains Other=10. The current source owns
  // Other=20, reflecting an edit saved alongside the deletion, not history undo.
  const edited = await readXlsxWorkbook((await calculateWorkbookCellEdits(current, [{ sheetId: '3', cell: { row: 0, column: 0, kind: 'number', value: 20 } }])).bytes);
  const result = await calculateWorkbookRestoredSheetEdits(edited, target, [{ sheetId: '2', bytes, sourceSha256: sha }], [
    { sheetId: '2', cell: { row: 1, column: 1, kind: 'blank', value: null, formula: "='Other renamed'!A1+Inputs!A1" } },
    { sheetId: '2', cell: { row: 5, column: 3, kind: 'number', value: 19 } },
  ]);
  const saved = await readXlsxWorkbook(result.bytes);
  expect(saved.model.sheets.map(sheet => [sheet.id, sheet.name])).toEqual([['1', 'Inputs'], ['2', 'Restored'], ['3', 'Other renamed']]);
  expect(saved.model.sheets[2]!.cells.find(cell => cell.row === 0 && cell.column === 0)?.value).toBe(20);
  expect(saved.model.sheets[1]!.cells.find(cell => cell.row === 1 && cell.column === 1)).toMatchObject({ formula: "='Other renamed'!A1+Inputs!A1", value: 22 });
  expect(saved.model.sheets[1]!.cells.find(cell => cell.row === 5 && cell.column === 3)?.value).toBe(19);
  const beforeRoot = xmlPart(historical.parts, historical.sheetParts.get('2')!).documentElement!;
  const restoredRoot = xmlPart(saved.parts, saved.sheetParts.get('2')!).documentElement!;
  for (const name of ['cols', 'mergeCells', 'headerFooter', 'pageSetup', 'pageMargins']) expect(child(restoredRoot, name)?.toString()).toBe(child(beforeRoot, name)?.toString());
  for (const name of ['xl/styles.xml', 'xl/sharedStrings.xml', 'docProps/core.xml']) expect(saved.parts.get(name)).toEqual(edited.parts.get(name));
  const independent = new ExcelJS.Workbook(); await independent.xlsx.load(Uint8Array.from(result.bytes).buffer);
  expect(independent.getWorksheet('Restored')!.getCell('B2').result).toBe(22);
  expect(independent.getWorksheet('Restored')!.headerFooter.oddHeader).toBe('Retained header');
  expect(independent.getWorksheet('Other renamed')!.getCell('A1').value).toBe(20);
});
it('requires every restore owner exactly once before admitting cross-restoration references', async () => {
  const { bytes, current, sha, target } = await fixture();
  const asset = { sheetId: '2', bytes, sourceSha256: sha };
  await expect(calculateWorkbookRestoredSheetEdits(current, target, [])).rejects.toThrow('incomplete');
  await expect(calculateWorkbookRestoredSheetEdits(current, target, [asset, asset])).rejects.toThrow('incomplete');
  await expect(calculateWorkbookRestoredSheetEdits(current, [...target, { sheetId: '5', name: 'Unproven', origin: 'restore' }], [asset, { ...asset, sheetId: '5' }])).rejects.toThrow('missing');
  await expect(calculateWorkbookRestoredSheetEdits(current, target, [{ ...asset, sheetId: '5' }])).rejects.toThrow('ambiguous');
});
it('calculates a missing historical identity as REF even when its name belongs to a different current ID', async () => {
  const { bytes, historical, sha } = await fixture();
  const current = await readXlsxWorkbook(await patchWorkbookSheets(historical, [{ sheetId: '1', name: 'Inputs', origin: 'source' }, { sheetId: '4', name: 'Other old', origin: 'new' }]));
  const result = await calculateWorkbookRestoredSheetEdits(current, [{ sheetId: '1', name: 'Inputs', origin: 'source' }, { sheetId: '2', name: 'Restored', origin: 'restore' }, { sheetId: '4', name: 'Other old', origin: 'source' }], [{ sheetId: '2', bytes, sourceSha256: sha }]);
  expect(result.model.sheets[1]!.cells.find(cell => cell.row === 1 && cell.column === 1)).toMatchObject({ formula: '=#REF!+Inputs!A1', kind: 'error', value: '#REF!' });
});
it('checks one shared archive budget for two restored worksheets with cross-sheet formulas', async () => {
  const { bytes: original, historical } = await fixture();
  // STORE makes this a genuine admitted >half-budget XLSX without random data
  // or a huge worksheet calculation area. Two sheet templates share its bytes.
  const zip = await JSZip.loadAsync(original);
  zip.file('docProps/core.xml', `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:description>${'x'.repeat(13 * 1024 * 1024)}</dc:description></cp:coreProperties>`);
  const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
  expect(bytes.length).toBeGreaterThan(WORKBOOK_PACKAGE_LIMITS.archiveBytes / 2);
  expect(bytes.length).toBeLessThan(WORKBOOK_PACKAGE_LIMITS.archiveBytes);
  const sha = createHash('sha256').update(bytes).digest('hex');
  const current = await readXlsxWorkbook(await patchWorkbookSheets(historical, [{ sheetId: '1', name: 'Inputs', origin: 'source' }]));
  const target: WorkbookSheetTemplateEntry[] = [{ sheetId: '1', name: 'Inputs', origin: 'source' }, { sheetId: '2', name: 'Restored', origin: 'restore' }, { sheetId: '3', name: 'Restored other', origin: 'restore' }];
  const assets = ['2', '3'].map(sheetId => ({ sheetId, bytes, sourceSha256: sha }));
  const result = await calculateWorkbookRestoredSheetEdits(current, target, assets);
  expect(result.model.sheets[1]!.cells.find(cell => cell.row === 1 && cell.column === 1)).toMatchObject({ formula: "='Restored other'!A1+Inputs!A1", value: 12 });
  expect(result.model.sheets[2]!.cells[0]?.value).toBe(10);
  // A different valid archive (same worksheet content, different ZIP comment)
  // consumes its own actual bytes before either template is parsed.
  const otherBytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE', comment: 'Distinct checked archive' });
  const otherSha = createHash('sha256').update(otherBytes).digest('hex');
  expect(otherSha).not.toBe(sha);
  await expect(calculateWorkbookRestoredSheetEdits(current, target, [assets[0]!, { ...assets[1]!, bytes: otherBytes, sourceSha256: otherSha }])).rejects.toThrow('aggregate');
  const changed = Buffer.from(bytes); changed[0] = changed[0]! ^ 1;
  await expect(calculateWorkbookRestoredSheetEdits(current, target, [assets[0]!, { ...assets[1]!, bytes: changed }])).rejects.toThrow('inconsistent');
}, 30_000);
