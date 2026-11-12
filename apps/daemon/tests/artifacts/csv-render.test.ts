import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { renderWorkbook } from '../../src/embedded-render/workbooks.js';
import { RenderInput } from '../../src/embedded-render/input.js';
let directory: string;
beforeEach(async () => { directory = await mkdtemp(path.join(tmpdir(), 'od-csv-render-')); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });
const original = Buffer.from('\ufeff"001",2026-11-12,=1+2,\r\n"embedded\r\nline",雪,,\r\n');
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
it('admits only format-consistent CSV/workbook requests, never implicit XLSX conversion', () => {
  for (const format of ['csv', 'workbook']) expect(RenderInput.safeParse({ fileName: 'nested/data.csv', format }).success).toBe(true);
  for (const input of [{ fileName: 'data.csv', format: 'xlsx' }, { fileName: 'data.xlsx', format: 'csv' }, { fileName: 'data.csv', format: 'csv', deck: true }, { fileName: 'data.csv', format: 'csv', width: 800 }]) expect(RenderInput.safeParse(input).success).toBe(false);
});
it('returns a typed literal preview and exact untouched CSV export in the existing worker entry', async () => {
  await renderWorkbook(directory, { fileName: 'data.csv', format: 'workbook' }, async () => original);
  const preview = JSON.parse(await readFile(path.join(directory, 'artifact.json'), 'utf8'));
  expect(preview.sourceSha256).toBe(digest(original)); expect(preview.model.sourceFormat).toBe('csv');
  expect(preview.model.sheets[0].cells.slice(0, 3).map((cell: { kind: string; value: string; formula?: string }) => [cell.kind, cell.value, cell.formula])).toEqual([['string', '001', undefined], ['string', '2026-11-12', undefined], ['string', '=1+2', undefined]]);
  expect(await renderWorkbook(directory, { fileName: 'data.csv', format: 'csv' }, async () => original)).toEqual({ file: 'artifact.csv', mime: 'text/csv' });
  expect(await readFile(path.join(directory, 'artifact.csv'))).toEqual(original);
});
it('prepares a literal field edit while preserving unrelated source tokens', async () => {
  const plan = Buffer.from(JSON.stringify({ sourceSha256: digest(original), edits: [{ sheetId: 'csv', cell: { row: 0, column: 0, kind: 'string', value: '=literal,雪' } }] }));
  await renderWorkbook(directory, { fileName: 'data.csv', format: 'csv', dataFile: 'plan.json' }, async name => name === 'plan.json' ? plan : original);
  expect((await readFile(path.join(directory, 'artifact.csv'))).toString()).toBe(original.toString().replace('"001"', '"=literal,雪"'));
});
it('restores the exact selected CSV bytes even when the current source cannot be parsed', async () => {
  const damaged = Buffer.from('"unterminated');
  await renderWorkbook(directory, { fileName: 'data.csv', format: 'csv', restore: { fileName: 'retained.bin', sourceSha256: digest(damaged), targetSha256: digest(original) } }, async name => name === 'retained.bin' ? original : damaged);
  expect(await readFile(path.join(directory, 'artifact.csv'))).toEqual(original);
});
it('rejects stale, malformed, unsupported and conversion candidates without emitting any file', async () => {
  const good = { sourceSha256: digest(original), edits: [] };
  for (const value of [{ ...good, sourceSha256: '0'.repeat(64) }, { ...good, styles: [{ sheetId: 'csv', row: 0, column: 0, bold: true }] }]) {
    await expect(renderWorkbook(directory, { fileName: 'data.csv', format: 'csv', dataFile: 'plan.json' }, async name => name === 'plan.json' ? Buffer.from(JSON.stringify(value)) : original)).rejects.toThrow();
  }
  await expect(renderWorkbook(directory, { fileName: 'data.csv', format: 'csv' }, async () => Buffer.from('"bad'))).rejects.toThrow();
  await expect(renderWorkbook(directory, { fileName: 'data.csv', format: 'xlsx' }, async () => original)).rejects.toThrow(/remain CSV/);
  await expect(renderWorkbook(directory, { fileName: 'data.xlsx', format: 'csv' }, async () => original)).rejects.toThrow(/selected worksheet/);
  expect(await readdir(directory)).toEqual([]);
});
