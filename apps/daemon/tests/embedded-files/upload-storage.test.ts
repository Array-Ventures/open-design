import express from 'express';
import multer from 'multer';
import type { Server } from 'node:http';
import { chmod, mkdtemp, mkdir, readFile, readdir, rename, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { embeddedUploadStorage } from '../../src/embedded-files/upload-storage.js';

const id = '18a8301a-b6e1-4001-8000-c967b1eab222';
let scratch: string; let directory: string; let server: Server; let origin: string;
beforeEach(async () => {
  scratch = await mkdtemp(path.join(tmpdir(), 'od-upload-storage-'));
  const workspace = path.join(scratch, 'workspaces');
  directory = path.join(workspace, 'team/projects', id);
  await mkdir(directory, { recursive: true }); await chmod(workspace, 0o700);
  vi.stubEnv('OD_EMBEDDED_WORKSPACE_ROOT', workspace);
  const app = express();
  const upload = multer({ storage: embeddedUploadStorage({
    fallback: multer.memoryStorage(), metadata: () => ({ embeddedHost: 'evebot', baseDir: directory }),
    decodeName: (name) => name, sanitizeName: (name) => path.basename(name),
    sanitizePath: (name) => name,
  }), limits: { fileSize: 8 } });
  app.post('/:id', upload.array('files', 12), (req, res) => res.json((req.files as Express.Multer.File[]).map((file) => ({
    filename: file.filename, size: file.embeddedStat?.size, hasHostPath: Boolean(file.path),
  }))));
  app.post('/api/projects/:id/files', upload.single('file'), (req, res) => res.json({ bytes: req.file?.buffer.toString('utf8'), hasHostPath: Boolean(req.file?.path) }));
  app.use((_error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => { res.status(400).json({ error: 'upload rejected' }); });
  server = await new Promise<Server>((resolve) => { const started = app.listen(0, '127.0.0.1', () => resolve(started)); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing fixture port');
  origin = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); vi.unstubAllEnvs(); await rm(scratch, { recursive: true, force: true }); });
it('preserves multipart ordering and duplicate filenames through the real upload middleware', async () => {
  const data = new FormData(); data.append('dir', 'assets');
  data.append('files', new Blob(['FIRST']), 'chart.svg'); data.append('files', new Blob(['SECOND']), 'chart.svg');
  const response = await fetch(`${origin}/${id}`, { method: 'POST', body: data });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual([{ filename: 'chart.svg', size: 5, hasHostPath: false }, { filename: 'chart-1.svg', size: 6, hasHostPath: false }]);
  expect(await readFile(path.join(directory, 'assets/chart.svg'), 'utf8')).toBe('FIRST');
  expect(await readFile(path.join(directory, 'assets/chart-1.svg'), 'utf8')).toBe('SECOND');
});
it('refuses a replaced project root and writes no bytes to the outside canary directory', async () => {
  const outside = path.join(scratch, 'outside'); await mkdir(outside);
  await rename(directory, directory + '.moved'); await symlink(outside, directory);
  const data = new FormData(); data.append('files', new Blob(['UPLOAD']), 'canary.txt');
  const response = await fetch(`${origin}/${id}`, { method: 'POST', body: data });
  expect(response.status).toBe(400); expect(await readdir(outside)).toEqual([]);
});

it('cleans accepted and truncated files when a later multipart file exceeds its limit', async () => {
  const data = new FormData(); data.append('files', new Blob(['FIRST']), 'accepted.txt');
  data.append('files', new Blob(['THIS_EXCEEDS_EIGHT_BYTES']), 'large.txt');
  const response = await fetch(`${origin}/${id}`, { method: 'POST', body: data });
  expect(response.status).toBe(400); expect(await readdir(directory)).toEqual([]);
});
it('refuses an upload into a symlinked subfolder without changing outside files', async () => {
  const outside = path.join(scratch, 'outside'); await mkdir(outside);
  await symlink(outside, path.join(directory, 'assets'));
  const data = new FormData(); data.append('dir', 'assets'); data.append('files', new Blob(['UPLOAD']), 'test.txt');
  const response = await fetch(`${origin}/${id}`, { method: 'POST', body: data });
  expect(response.status).toBe(400); expect(await readdir(outside)).toEqual([]);
});

it('stages single-file bytes without committing before the authorized route handler', async () => {
  const data = new FormData(); data.append('file', new Blob(['FIRST']), 'book.xlsx');
  const response = await fetch(`${origin}/api/projects/${id}/files`, { method: 'POST', body: data });
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ bytes: 'FIRST', hasHostPath: false }); expect(await readdir(directory)).toEqual([]);
});
it('enforces the same multipart byte and field limits for staged single-file uploads without leaving files', async () => {
  for (const second of [false, true]) {
    const data = new FormData(); data.append('file', new Blob([second ? 'FIRST' : 'THIS_EXCEEDS_EIGHT_BYTES']), 'book.xlsx');
    if (second) data.append('file', new Blob(['SECOND']), 'other.xlsx');
    const response = await fetch(`${origin}/api/projects/${id}/files`, { method: 'POST', body: data });
    expect(response.status).toBe(400); expect(await readdir(directory)).toEqual([]);
  }
});
