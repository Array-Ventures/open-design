import { createHash } from 'node:crypto';
import { canonicalWorkbookSheetBaseline, workbookSheetBaseline } from '@open-design/contracts/runtime/workbook-sheet-baseline';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs-community';
import { afterEach, expect, it } from 'vitest';
import { workbookPreviewSchema } from '@open-design/contracts/runtime/workbook';
import { readXlsxWorkbook } from '../../src/artifacts/workbook/reader.js';
import { calculateWorkbookSheetEdits } from '../../src/artifacts/workbook/calculated-patch.js';
import { renderWorkbook } from '../../src/embedded-render/workbooks.js';
import { RenderInput } from '../../src/embedded-render/input.js';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });
const sha = (body: Buffer) => createHash('sha256').update(body).digest('hex');
async function fixture() {
  const book = new ExcelJS.Workbook(); book.addWorksheet('Inputs').getCell('A1').value = 2;
  const restored = book.addWorksheet('Historical'); restored.getCell('A1').value = { formula: 'Other!A1+Inputs!A1', result: 999 }; restored.headerFooter.oddHeader = 'Raw header';
  book.addWorksheet('Other').getCell('A1').value = 10;
  const historical = Buffer.from(await book.xlsx.writeBuffer()), versionSha256 = sha(historical);
  const current = (await calculateWorkbookSheetEdits(await readXlsxWorkbook(historical), [{ sheetId: '1', name: 'Inputs', origin: 'source' }])).bytes;
  const ref = { versionId: 'checkedHistory', versionSha256 };
  const body = Buffer.from(JSON.stringify({ sourceSha256: sha(current), edits: [], sheets: [{ sheetId: '1', name: 'Inputs', origin: 'source' }, { sheetId: '2', name: 'Restored', origin: 'restore', template: ref }, { sheetId: '3', name: 'Renamed other', origin: 'restore', template: ref }] }));
  const declared = { ...ref, fileName: `.evebot-workbook-sheet-source-${versionSha256}.xlsx` };
  const assets = new Map([['book.xlsx', current], ['edits.json', body], [declared.fileName, historical]]);
  const asset = async (name: string) => { const bytes = assets.get(name); if (!bytes) throw new Error('Missing frozen fixture asset'); return bytes; };
  const input = { fileName: 'book.xlsx', format: 'xlsx' as const, dataFile: 'edits.json', workbookSheetSources: [declared] };
  return { current, historical, body, declared, input, asset, assets };
}
async function output() { const directory = await mkdtemp(path.join(tmpdir(), 'od-sheet-asset-worker-')); directories.push(directory); return directory; }
it.each(['xlsx', 'workbook'] as const)('consumes exact frozen declarations and fully calculates restored XML for %s output', async format => {
  const { input, asset, current, historical, assets } = await fixture(), directory = await output();
  expect(RenderInput.safeParse({ ...input, format }).success).toBe(true);
  await renderWorkbook(directory, { ...input, format }, asset);
  if (format === 'xlsx') {
    const book = new ExcelJS.Workbook(); await book.xlsx.load(Uint8Array.from(await readFile(path.join(directory, 'artifact.xlsx'))).buffer);
    expect(book.worksheets.map(sheet => [sheet.id, sheet.name])).toEqual([[1, 'Inputs'], [2, 'Restored'], [3, 'Renamed other']]);
    expect(book.getWorksheet('Restored')!.getCell('A1').result).toBe(12);
    expect(book.getWorksheet('Restored')!.headerFooter.oddHeader).toBe('Raw header');
  } else {
    const preview = workbookPreviewSchema.parse(JSON.parse(await readFile(path.join(directory, 'artifact.json'), 'utf8')));
    expect(preview.sourceSha256).toBe(sha(current));
    expect(preview.model.sheets[1]!.cells[0]).toMatchObject({ formula: "='Renamed other'!A1+Inputs!A1", value: 12 });
  }
  expect(assets.get('book.xlsx')).toEqual(current); expect(assets.get(input.workbookSheetSources[0]!.fileName)).toEqual(historical);
});
it('refuses missing, extra, wrong-version and wrong-byte assets before creating output', async () => {
  const { input, asset, declared, assets } = await fixture();
  const { workbookSheetSources: _sources, ...withoutSources } = input;
  for (const sources of [undefined, [{ ...declared, versionId: 'different' }], [declared, { ...declared, versionId: 'unused' }]]) {
    const directory = await output();
    await expect(renderWorkbook(directory, { ...withoutSources, ...(sources ? { workbookSheetSources: sources } : {}) }, asset)).rejects.toThrow('declarations');
    expect(await readdir(directory)).toEqual([]);
  }
  assets.set(declared.fileName, Buffer.from('Substituted historical bytes'));
  const directory = await output(); await expect(renderWorkbook(directory, input, asset)).rejects.toThrow('hash'); expect(await readdir(directory)).toEqual([]);
});
it('refuses historical assets for CSV, planless or whole-file restore paths and arbitrary frozen paths', async () => {
  const { input, asset } = await fixture();
  for (const change of [{ format: 'csv' }, { fileName: 'book.csv' }, { dataFile: undefined }, { workbookSheetSources: [{ ...input.workbookSheetSources[0]!, fileName: 'caller-selected.xlsx' }] }, { restore: { fileName: 'old.xlsx', sourceSha256: 'a'.repeat(64), targetSha256: 'b'.repeat(64) } }]) expect(RenderInput.safeParse({ ...input, ...change }).success).toBe(false);
  const directory = await output(); await expect(renderWorkbook(directory, { ...input, fileName: 'book.csv', format: 'csv' }, asset)).rejects.toThrow('XLSX edit plan'); expect(await readdir(directory)).toEqual([]);
});

it('carries optional baseline identity to the actual renderer and refuses forged claims before output', async () => {
  const { input, asset, assets, body, historical, current } = await fixture();
  const model = (await readXlsxWorkbook(historical)).model;
  const plan = JSON.parse(body.toString());
  for (const sheet of plan.sheets.filter((entry: { origin: string }) => entry.origin === 'restore')) sheet.baselineIdentity = { version: 1, sha256: sha(Buffer.from(canonicalWorkbookSheetBaseline(workbookSheetBaseline(model, sheet.sheetId)))) };
  const frozenPlan = JSON.stringify(plan);
  assets.set('edits.json', Buffer.from(frozenPlan));
  const directory = await output(); await renderWorkbook(directory, input, asset);
  const independent = new ExcelJS.Workbook(); await independent.xlsx.load(Uint8Array.from(await readFile(path.join(directory, 'artifact.xlsx'))).buffer);
  expect(independent.getWorksheet('Restored')!.getCell('A1').result).toBe(12);
  for (const invalid of [{ version: 1, sha256: '0'.repeat(64) }, { version: 2, sha256: plan.sheets[1].baselineIdentity.sha256 }]) {
    const forged = JSON.parse(frozenPlan); forged.sheets[1].baselineIdentity = invalid;
    assets.set('edits.json', Buffer.from(JSON.stringify(forged)));
    const refused = await output(); await expect(renderWorkbook(refused, input, asset)).rejects.toThrow(); expect(await readdir(refused)).toEqual([]);
  }
  expect(assets.get('book.xlsx')).toEqual(current); expect(assets.get(input.workbookSheetSources[0]!.fileName)).toEqual(historical);
});
