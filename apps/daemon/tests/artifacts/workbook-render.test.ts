import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs-community';
import { workbookPreviewSchema } from '@open-design/contracts/runtime/workbook';
import { renderWorkbook } from '../../src/embedded-render/workbooks.js';

describe('isolated workbook render preparation', () => {
  let directory: string, bytes: Buffer, sourceSha256: string;
  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'od-workbook-output-'));
    const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('Inputs');
    sheet.getCell('A1').value = 2; sheet.getCell('B1').value = { formula: 'A1*2', result: 4 };
    bytes = Buffer.from(await book.xlsx.writeBuffer()); sourceSha256 = createHash('sha256').update(bytes).digest('hex');
  });
  afterEach(async () => { await rm(directory, { recursive: true, force: true }); });
  const plan = (sourceSha256: string) => Buffer.from(JSON.stringify({ sourceSha256, edits: [{ sheetId: '1', cell: { row: 0, column: 0, kind: 'number', value: 8 } }] }));
  it('returns a validated source-bound preview without modifying the source', async () => {
    const before = Buffer.from(bytes);
    const result = await renderWorkbook(directory, { fileName: 'book.xlsx', format: 'workbook' }, async () => bytes);
    expect(result).toEqual({ file: 'artifact.json', mime: 'application/json' });
    const output = workbookPreviewSchema.parse(JSON.parse(await readFile(path.join(directory, result.file), 'utf8')));
    expect(output.sourceSha256).toBe(sourceSha256);
    expect(output.model.sheets[0]!.cells.find(cell => cell.column === 0)).toMatchObject({ kind: 'number', value: 2 });
    expect(bytes).toEqual(before);
  });
  it('prepares a recalculated copy from a hash-matched edit plan', async () => {
    const before = Buffer.from(bytes);
    await renderWorkbook(directory, { fileName: 'book.xlsx', dataFile: 'edits.json', format: 'xlsx' }, async name => name === 'edits.json' ? plan(sourceSha256) : bytes);
    const book = new ExcelJS.Workbook(); await book.xlsx.load(Uint8Array.from(await readFile(path.join(directory, 'artifact.xlsx'))).buffer);
    expect(book.getWorksheet('Inputs')!.getCell('A1').value).toBe(8);
    expect(book.getWorksheet('Inputs')!.getCell('B1').value).toEqual({ formula: 'A1*2', result: 16 });
    expect(bytes).toEqual(before);
  });
  it('refuses a stale edit plan before producing any output', async () => {
    await expect(renderWorkbook(directory, { fileName: 'book.xlsx', dataFile: 'edits.json', format: 'xlsx' }, async name => name === 'edits.json' ? plan('0'.repeat(64)) : bytes)).rejects.toThrow('changed after');
    expect(await readdir(directory)).toEqual([]);
  });
  it('validates edit plans instead of forwarding unknown fields or invalid cell values', async () => {
    const invalid = Buffer.from(JSON.stringify({ sourceSha256, edits: [{ sheetId: '1', cell: { row: 0, column: 0, kind: 'number', value: '8' } }], executable: '/outside' }));
    await expect(renderWorkbook(directory, { fileName: 'book.xlsx', dataFile: 'edits.json', format: 'xlsx' }, async name => name === 'edits.json' ? invalid : bytes)).rejects.toThrow();
    expect(await readdir(directory)).toEqual([]);
  });
  it('refuses an oversized edit plan before parsing it', async () => {
    await expect(renderWorkbook(directory, { fileName: 'book.xlsx', dataFile: 'edits.json', format: 'xlsx' }, async name => name === 'edits.json' ? Buffer.alloc(16 * 1024 * 1024 + 1) : bytes)).rejects.toMatchObject({ code: 'WORKBOOK_LIMIT' });
  });
  it('refuses malformed UTF-8 instead of silently changing edited text', async () => {
    const invalid = Buffer.concat([Buffer.from(`{"sourceSha256":"${sourceSha256}","edits":[{"sheetId":"1","cell":{"row":0,"column":0,"kind":"string","value":"`), Buffer.from([0xff]), Buffer.from('"}}]}')]);
    await expect(renderWorkbook(directory, { fileName: 'book.xlsx', dataFile: 'edits.json', format: 'xlsx' }, async name => name === 'edits.json' ? invalid : bytes)).rejects.toThrow();
    expect(await readdir(directory)).toEqual([]);
  });
  it('restores exact retained bytes without recalculation or rewriting their package', async () => {
    const retained = Buffer.from(bytes), current = Buffer.from('damaged current workbook but a known exact identity');
    const result = await renderWorkbook(directory, { fileName: 'book.xlsx', format: 'xlsx', restore: { fileName: 'retained.xlsx', sourceSha256: createHash('sha256').update(current).digest('hex'), targetSha256: sourceSha256 } }, async name => name === 'retained.xlsx' ? retained : current);
    expect(result.file).toBe('artifact.xlsx'); expect(await readFile(path.join(directory, 'artifact.xlsx'))).toEqual(retained);
    const reopened = new ExcelJS.Workbook(); await reopened.xlsx.load(Uint8Array.from(retained).buffer);
    expect(reopened.getWorksheet('Inputs')!.getCell('B1').value).toEqual({ formula: 'A1*2', result: 4 });
  });
  it('rejects changed current or retained restore identities before emitting output', async () => {
    for (const restore of [{ fileName: 'retained.xlsx', sourceSha256: '0'.repeat(64), targetSha256: sourceSha256 }, { fileName: 'retained.xlsx', sourceSha256, targetSha256: '0'.repeat(64) }]) {
      await expect(renderWorkbook(directory, { fileName: 'book.xlsx', format: 'xlsx', restore }, async () => bytes)).rejects.toThrow();
    }
    await expect(readFile(path.join(directory, 'artifact.xlsx'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

});
