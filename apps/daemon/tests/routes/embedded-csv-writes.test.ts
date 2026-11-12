import { z } from 'zod';
import { workbookWriteReceiptSchema } from '@open-design/contracts/runtime/workbook';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import express from 'express';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { openDatabase } from '../../src/db.js';
import { installEmbeddedStudioBoundary, registerEmbeddedStudioRoutes } from '../../src/routes/embedded-studio.js';
import { registerEmbeddedWorkbookRoutes } from '../../src/routes/embedded-workbooks.js';
const id = '18a8301a-b6e1-4001-8000-c967b1eab222', token = 'csv-fixture-service-credential';
const original = Buffer.from('\ufeff"001",=sum(a1),\r\n'), changed = Buffer.from('\ufeff"002",=sum(a1),\r\n');
const responseReceipt = async (response: Response) => workbookWriteReceiptSchema.parse(z.object({ receipt: z.unknown() }).strict().parse(await response.json()).receipt);
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
let root: string, directory: string, origin: string, server: Server, db: ReturnType<typeof openDatabase>;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'od-csv-writes-http-'));
  const workspace = path.join(root, 'workspaces'); directory = path.join(workspace, 'team/projects', id); await mkdir(directory, { recursive: true, mode: 0o700 });
  vi.stubEnv('OD_EMBEDDED_STUDIO', '1'); vi.stubEnv('OD_EMBEDDED_TOKEN', token); vi.stubEnv('OD_EMBEDDED_WORKSPACE_ROOT', workspace);
  db = openDatabase(root, { dataDir: path.join(root, 'state') });
  const app = express(); installEmbeddedStudioBoundary(app); app.use(express.json()); registerEmbeddedStudioRoutes(app, db); registerEmbeddedWorkbookRoutes(app, db, path.join(root, 'metadata'));
  server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve)); origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const registered = await fetch(`${origin}/api/embedded/projects`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ id, name: 'CSV fixture', kind: 'workbook', directory }) }); expect(registered.status).toBe(201);
  await writeFile(path.join(directory, 'data.csv'), original);
});
afterEach(async () => { server?.closeAllConnections(); if (server) await new Promise<void>(resolve => server.close(() => resolve())); db?.close(); await rm(root, { recursive: true, force: true }); vi.unstubAllEnvs(); });
async function post(bytes: Buffer, options: { fileName?: string; source?: Buffer; operationId?: string; restore?: string; token?: string } = {}) {
  return fetch(`${origin}/api/embedded/projects/${id}/${options.restore ? 'workbook-restores' : 'workbook-writes'}/${options.operationId ?? randomUUID()}?fileName=${encodeURIComponent(options.fileName ?? 'data.csv')}`, {
    method: 'POST', headers: { authorization: `Bearer ${options.token ?? token}`, 'content-type': 'application/octet-stream', 'x-od-workbook-actor': 'human:fixture', 'x-od-workbook-mode': 'commit', 'x-od-workbook-source': sha(options.source ?? original), 'x-od-workbook-target': sha(bytes), ...(options.restore ? { 'x-od-workbook-restore-version': options.restore } : {}) }, body: Uint8Array.from(bytes),
  });
}
it('saves and restores exact CSV bytes through the authenticated route with immutable lineage', async () => {
  const response = await post(changed); expect(response.status).toBe(200);
  const saved = await responseReceipt(response); expect(saved.state).toBe('applied'); expect(await readFile(path.join(directory, 'data.csv'))).toEqual(changed);
  const restored = await post(original, { source: changed, restore: saved.sourceVersionId! }); expect(restored.status).toBe(200);
  expect(await responseReceipt(restored)).toMatchObject({ state: 'applied', targetSha256: sha(original), restoreFromVersionId: saved.sourceVersionId });
  expect(await readFile(path.join(directory, 'data.csv'))).toEqual(original);
});
it('admits a genuine zero-byte CSV candidate and replays its receipt after deletion without resurrecting it', async () => {
  const bytes = Buffer.alloc(0), operationId = randomUUID(), first = await post(bytes, { operationId }); expect(first.status).toBe(200);
  const receipt = await responseReceipt(first); expect(await readFile(path.join(directory, 'data.csv'))).toEqual(bytes);
  await rm(path.join(directory, 'data.csv'));
  const replay = await post(bytes, { operationId }); expect(replay.status).toBe(200); expect(await responseReceipt(replay)).toEqual(receipt);
  await expect(readFile(path.join(directory, 'data.csv'))).rejects.toMatchObject({ code: 'ENOENT' });
});
it('rejects missing authority, malformed UTF-8/quoting and XLSX bad magic without writes', async () => {
  expect((await post(changed, { token: 'wrong-fixture-token' })).status).toBe(401);
  for (const bytes of [Buffer.from('"unterminated'), Buffer.from([0xc0, 0xaf]), Buffer.from('a\u0000b'), Buffer.from('x'.repeat(32768))]) expect((await post(bytes)).status).toBe(400);
  expect(await readFile(path.join(directory, 'data.csv'))).toEqual(original);
  await writeFile(path.join(directory, 'book.xlsx'), original);
  for (const bytes of [Buffer.alloc(0), Buffer.from('plain CSV'), Buffer.from([0x50, 0x4b, 0x05, 0x06])]) expect((await post(bytes, { fileName: 'book.xlsx' })).status).toBe(400);
  expect(await readFile(path.join(directory, 'book.xlsx'))).toEqual(original);
});

it('restores an exact zero-byte retained CSV revision through the authenticated restore endpoint', async () => {
  const empty = Buffer.alloc(0), saved = await post(empty); expect(saved.status).toBe(200);
  const receipt = await responseReceipt(saved);
  const next = await post(changed, { source: empty }); expect(next.status).toBe(200);
  const restored = await post(empty, { source: changed, restore: receipt.versionId! }); expect(restored.status).toBe(200);
  expect(await responseReceipt(restored)).toMatchObject({ state: 'applied', targetSha256: sha(empty), restoreFromVersionId: receipt.versionId });
  expect(await readFile(path.join(directory, 'data.csv'))).toEqual(empty);
});
