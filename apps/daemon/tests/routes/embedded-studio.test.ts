import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, symlink, link, writeFile, open, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import express from 'express';
import { openDatabase, getProject } from '../../src/db.js';
import * as store from '../../src/db.js';
import { registerProjectCommentRoutes } from '../../src/routes/project/comments.js';
import { embeddedOperationAllowed, installEmbeddedStudioBoundary, registerEmbeddedStudioRoutes } from '../../src/routes/embedded-studio.js';

const id = '18a8301a-b6e1-4001-8000-c967b1eab222';
const token = 'studio-test-service-credential';
const backupOwner = '03ae8c72-ef53-48ec-9c57-553130c83525';
let scratch: string; let root: string; let directory: string;
let server: Server; let origin: string;
let database: ReturnType<typeof openDatabase>;
let app: express.Express;
beforeEach(async () => {
  scratch = await mkdtemp(path.join(tmpdir(), 'od-studio-boundary-'));
  root = path.join(scratch, 'workspace');
  directory = path.join(root, 'team', 'projects', id);
  await mkdir(directory, { recursive: true });
  await chmod(root, 0o700);
  vi.stubEnv('OD_EMBEDDED_STUDIO', '1');
  vi.stubEnv('OD_EMBEDDED_TOKEN', token);
  vi.stubEnv('OD_EMBEDDED_WORKSPACE_ROOT', root);
  database = openDatabase(scratch, { dataDir: path.join(scratch, 'state') });
  app = express();
  installEmbeddedStudioBoundary(app);
  app.use(express.json());
  registerEmbeddedStudioRoutes(app, database);
  registerProjectCommentRoutes(app, { db: database, projectStore: store, conversations: store });
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test listener');
  origin = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => {
  server?.closeAllConnections();
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  database?.close();
  await rm(scratch, { recursive: true, force: true });
  vi.unstubAllEnvs();
});
const register = (body = { id, name: 'Dashboard', kind: 'dashboard', directory }, authorized = true) => fetch(`${origin}/api/embedded/projects`, {
  method: 'POST', headers: { 'content-type': 'application/json', ...(authorized ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body),
});
async function replyFixture() {
  await register();
  const endpoint = `${origin}/api/projects/${id}/conversations/${id}/comments`;
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-od-host-human': 'alice' };
  const target = { filePath: 'index.html', elementId: 'heading', selector: 'h1', label: 'Heading', text: 'Heading', position: { x: 0, y: 0, width: 100, height: 20 }, htmlHint: '' };
  const { comment } = await (await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ target, note: 'Root' }) })).json() as { comment: { id: string } };
  await mkdir(path.join(directory, '_studio-comments'));
  return { endpoint: `${endpoint}/${comment.id}/replies`, headers };
}
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jc4sAAAAASUVORK5CYII=', 'base64');

describe('embedded Studio companion boundary', () => {
  it('replays root writes without duplicate rows, rejects stale edits and preserves resolved status', async () => {
    await register();
    const endpoint = `${origin}/api/projects/${id}/conversations/${id}/comments`;
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-od-host-human': 'alice' };
    const target = { filePath: 'index.html', elementId: 'heading', selector: 'h1', label: 'Heading', text: 'Heading', position: { x: 0, y: 0, width: 100, height: 20 }, htmlHint: '' };
    const send = (body: object) => fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
    const body = { target, note: 'Root once', operationId: backupOwner };
    const first = await send(body); expect(first.status).toBe(200);
    const { comment: created } = await first.json() as { comment: { id: string; editToken: string } };
    const retry = await send(body); expect(retry.status).toBe(200);
    expect((await retry.json() as { comment: { id: string } }).comment.id).toBe(created.id);
    expect(database.prepare('SELECT COUNT(*) AS count FROM preview_comments').get()).toEqual({ count: 1 });
    expect(created.editToken).toMatch(/^[a-f0-9]{64}$/);
    expect((await send({ ...body, note: 'Changed operation payload' })).status).toBe(409);
    expect((await fetch(`${endpoint}/${created.id}`, { method: 'PATCH', headers, body: JSON.stringify({ status: 'resolved' }) })).status).toBe(200);
    const resolved = (await (await fetch(endpoint, { headers })).json() as { comments: { editToken: string }[] }).comments[0]!;
    const edit = { ...body, id: created.id, note: 'Edited resolved root', operationId: id, expectedEditToken: resolved.editToken };
    const edited = await send(edit); expect(edited.status).toBe(200);
    expect((await edited.json() as { comment: object }).comment).toMatchObject({ note: edit.note, status: 'resolved' });
    expect((await send(edit)).status).toBe(200);
    expect((await send({ ...edit, operationId: crypto.randomUUID(), note: 'Stale overwrite' })).status).toBe(409);
    expect((await fetch(`${endpoint}/${created.id}`, { method: 'DELETE', headers })).status).toBe(200);
    expect((await send(body)).status).toBe(410);
    expect(database.prepare('SELECT COUNT(*) AS count FROM preview_comments').get()).toEqual({ count: 0 });
  });

  it('replays acknowledged root images without rereading bytes and scopes receipts to the caller', async () => {
    await register();
    await mkdir(path.join(directory, '_studio-comments'));
    const imagePath = path.join(directory, '_studio-comments/root.png');
    await writeFile(imagePath, png);
    const endpoint = `${origin}/api/projects/${id}/conversations/${id}/comments`;
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-od-host-human': 'alice' };
    const target = { filePath: 'index.html', elementId: 'heading', selector: 'h1', label: 'Heading', text: '', position: { x: 0, y: 0, width: 100, height: 20 }, htmlHint: '' };
    const body = { target, note: '', attachments: [{ path: '_studio-comments/root.png', name: '  root.png  ' }], operationId: backupOwner, authorMemberId: 'forged' };
    const send = (data = body, caller = headers) => fetch(endpoint, { method: 'POST', headers: caller, body: JSON.stringify(data) });
    const first = await send(); expect(first.status).toBe(200);
    const { comment } = await first.json() as { comment: { id: string; authorMemberId: string; attachments: unknown[] } };
    expect(comment.authorMemberId).toBe('evebot:alice'); expect(comment.attachments).toEqual([{ path: '_studio-comments/root.png', name: 'root.png' }]);
    await rm(imagePath);
    const retry = await send(); expect(retry.status).toBe(200); expect(await retry.json()).toEqual({ comment });
    // A different caller cannot borrow Alice's receipt to bypass byte checks.
    expect((await send(body, { ...headers, 'x-od-host-human': 'bob' })).status).toBe(400);
    expect((await send({ ...body, operationId: id, attachments: [{ path: '_studio-comments/missing.png', name: 'missing.png' }] })).status).toBe(400);
    expect(database.prepare('SELECT COUNT(*) AS count FROM preview_comments').get()).toEqual({ count: 1 });
    expect(database.prepare('SELECT COUNT(*) AS count FROM preview_comment_writes').get()).toEqual({ count: 1 });
  });
  it('persists image-only replies, includes images in retry identity and preserves revision/deletion rules', async () => {
    const { endpoint, headers } = await replyFixture();
    await writeFile(path.join(directory, '_studio-comments/image.png'), png);
    await writeFile(path.join(directory, '_studio-comments/image.webp'), Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64'));
    const attachments = [{ path: '_studio-comments/image.png', name: 'image.png' }, { path: '_studio-comments/image.webp', name: 'image.webp' }];
    const body = { operationId: backupOwner, note: '', attachments };
    const create = () => fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
    const created = await create(); expect(created.status).toBe(200);
    const { reply } = await created.json() as { reply: { id: string; attachments: unknown[] } };
    expect(reply.attachments).toEqual(attachments);
    expect(await (await create()).json()).toEqual({ reply });
    expect((await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ ...body, attachments: [{ ...attachments[0], name: 'changed.png' }] }) })).status).toBe(409);
    const edit = { note: 'Updated caption', expectedRevision: 1, attachments: [] };
    for (let retry = 0; retry < 2; retry++) {
      const response = await fetch(`${endpoint}/${reply.id}`, { method: 'PATCH', headers, body: JSON.stringify(edit) });
      expect(response.status).toBe(200); expect((await response.json() as { reply: object }).reply).toMatchObject({ revision: 2, attachments: [] });
    }
    expect((await fetch(`${endpoint}/${reply.id}`, { method: 'PATCH', headers, body: JSON.stringify({ note: '', expectedRevision: 1, attachments }) })).status).toBe(409);
    expect((await fetch(`${endpoint}/${reply.id}`, { method: 'DELETE', headers, body: JSON.stringify({ expectedRevision: 2 }) })).status).toBe(200);
    expect((await create()).status).toBe(409);
    expect(database.prepare('SELECT note, attachments_json FROM preview_comment_replies WHERE id=?').get(reply.id)).toEqual({ note: '', attachments_json: '[]' });
  });
  it('rejects noncanonical, outside, disguised and excessive reply image references before inserting a row', async () => {
    const { endpoint, headers } = await replyFixture();
    await writeFile(path.join(directory, '_studio-comments/image.png'), png);
    await writeFile(path.join(directory, '_studio-comments/disguised.png'), '<!doctype html><script>bad()</script>');
    await writeFile(path.join(directory, '_studio-comments/raster.html'), png);
    await writeFile(path.join(directory, '_studio-comments/raster.svg'), png);
    await writeFile(path.join(directory, '_studio-comments/raster.jpg'), png);
    const outside = path.join(scratch, 'outside.png'); await writeFile(outside, png);
    await symlink(outside, path.join(directory, '_studio-comments/symlink.png'));
    await link(outside, path.join(directory, '_studio-comments/hardlink.png'));
    const oversized = await open(path.join(directory, '_studio-comments/oversized.png'), 'w');
    try { await oversized.write(png); await oversized.truncate(25 * 1024 * 1024 + 1); } finally { await oversized.close(); }
    const invalid = ['_studio-comments/../outside.png', '_studio-comments//image.png', '_studio-comments\\image.png', '/tmp/outside.png', '_studio-comments/missing.png', '_studio-comments/disguised.png', '_studio-comments/raster.html', '_studio-comments/raster.svg', '_studio-comments/raster.jpg', '_studio-comments/symlink.png', '_studio-comments/hardlink.png', '_studio-comments/oversized.png'];
    const send = (attachments: unknown[]) => fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ operationId: backupOwner, note: '', attachments }) });
    for (const image of invalid) expect((await send([{ path: image, name: 'image.png' }])).status, image).toBe(400);
    expect((await send(Array.from({ length: 9 }, () => ({ path: '_studio-comments/image.png', name: 'image.png' })))).status).toBe(400);
    expect((await send([{ path: '_studio-comments/image.png', name: 'a'.repeat(201) }])).status).toBe(400);
    expect((await send([{ path: '_studio-comments/image.png', name: 'image.png' }, { path: '_studio-comments/image.png', name: 'duplicate.png' }])).status).toBe(400);
    const large = [];
    for (let index = 0; index < 3; index++) {
      const name = `_studio-comments/large-${index}.png`;
      const file = await open(path.join(directory, name), 'w');
      try { await file.write(png); await file.truncate(18 * 1024 * 1024); } finally { await file.close(); }
      large.push({ path: name, name: `large-${index}.png` });
    }
    expect((await send(large)).status).toBe(400);
    expect(database.prepare('SELECT COUNT(*) AS n FROM preview_comment_replies').get()).toEqual({ n: 0 });
  });
  it('admits scoped replies through the real embedded boundary and rejects runner tails', async () => {
    await register();
    const endpoint = `${origin}/api/projects/${id}/conversations/${id}/comments`;
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-od-host-human': 'alice' };
    const target = { filePath: 'index.html', elementId: 'heading', selector: 'h1', label: 'Heading', text: 'Heading', position: { x: 0, y: 0, width: 100, height: 20 }, htmlHint: '' };
    const root = await (await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ target, note: 'Root note' }) })).json() as { comment: { id: string } };
    const replies = `${endpoint}/${root.comment.id}/replies`;
    const created = await fetch(replies, { method: 'POST', headers, body: JSON.stringify({ note: 'Reply note', operationId: backupOwner }) });
    expect(created.status).toBe(200);
    const { reply } = await created.json() as { reply: { id: string; revision: number } };
    expect((await fetch(replies, { headers })).status).toBe(200);
    const edited = await fetch(`${replies}/${reply.id}`, { method: 'PATCH', headers, body: JSON.stringify({ note: 'Edited reply', expectedRevision: reply.revision }) });
    expect(edited.status).toBe(200);
    expect((await fetch(`${replies}/${reply.id}`, { method: 'DELETE', headers, body: JSON.stringify({ expectedRevision: 2 }) })).status).toBe(200);
    expect((await fetch(`${replies}/run`, { method: 'POST', headers, body: '{}' })).status).toBe(403);
    expect((await fetch(replies)).status).toBe(401);
    expect(embeddedOperationAllowed('GET', `/projects/${id}/conversations/another/comments/root/replies`)).toBe(false);
  });
  it('persists host-authored comments without accepting body identity or another person edits', async () => {
    await register();
    const endpoint = `${origin}/api/projects/${id}/conversations/${id}/comments`;
    const headers = (human: string) => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-od-host-human': human });
    const target = { filePath: 'index.html', elementId: 'heading', selector: '#heading', label: 'Heading', text: 'Current', position: { x: 0, y: 0, width: 100, height: 20 }, htmlHint: '<h1>Current</h1>' };
    const created = await fetch(endpoint, { method: 'POST', headers: headers('alice'), body: JSON.stringify({ target, note: 'Change this heading', authorMemberId: 'evebot:bob' }) });
    expect(created.status).toBe(200);
    const { comment } = await created.json() as { comment: { id: string; authorMemberId: string } };
    expect(comment.authorMemberId).toBe('evebot:alice');
    const edit = await fetch(endpoint, { method: 'POST', headers: headers('bob'), body: JSON.stringify({ id: comment.id, target, note: 'Forged edit' }) });
    expect(edit.status).toBe(403);
    expect((await fetch(`${endpoint}/${comment.id}`, { method: 'DELETE', headers: headers('bob') })).status).toBe(403);
    expect((await fetch(`${endpoint}/${comment.id}/reorder`, { method: 'PATCH', headers: headers('bob'), body: JSON.stringify({ sortKey: 10 }) })).status).toBe(403);
    const list = await fetch(endpoint, { headers: headers('bob') });
    expect((await list.json() as { comments: unknown[] }).comments).toHaveLength(1);
    expect((await fetch(`${endpoint}/${comment.id}`, { method: 'DELETE', headers: headers('alice') })).status).toBe(200);
  });
  it('idempotently binds the same persistent files without commissioning an agent', async () => {
    expect((await register()).status).toBe(201);
    expect((await register()).status).toBe(200);
    expect(getProject(database, id)?.metadata?.baseDir).toBe(directory);
    const count = database.prepare('SELECT count(*) AS n FROM projects').get() as { n: number };
    expect(count.n).toBe(1);
    const messages = database.prepare('SELECT count(*) AS n FROM messages').get() as { n: number };
    expect(messages.n).toBe(0);
  });
  it('requires gateway authentication even from loopback', async () => {
    expect((await register(undefined, false)).status).toBe(401);
    expect(getProject(database, id)).toBeNull();
  });
  it('attests only the configured supervised generation behind service authentication', async () => {
    expect((await fetch(`${origin}/api/embedded/runtime`)).status).toBe(401);
    const headers = { authorization: `Bearer ${token}` };
    expect((await fetch(`${origin}/api/embedded/runtime`, { headers })).status).toBe(503);
    vi.stubEnv('OD_EMBEDDED_RUNTIME_NONCE', backupOwner);
    vi.stubEnv('OD_EMBEDDED_RUNTIME_BUILD', 'a'.repeat(64));
    expect(await (await fetch(`${origin}/api/embedded/runtime`, { headers })).json()).toEqual({ version: 1, nonce: backupOwner, buildId: 'a'.repeat(64), pid: process.pid });
  });
  it('pauses project mutations behind an authenticated maintenance fence', async () => {
    const maintenance = (body: object, method = 'POST', authorized = true) => fetch(`${origin}/api/embedded/maintenance`, { method, headers: { 'content-type': 'application/json', ...(authorized ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
    expect((await maintenance({ owner: backupOwner }, 'POST', false)).status).toBe(401);
    const acquired = await maintenance({ owner: backupOwner });
    expect(acquired.status).toBe(200);
    const lease = await acquired.json() as { epoch: number };
    expect(lease).toMatchObject({ owner: backupOwner, requestsDrained: true });
    const paused = await register();
    expect(paused.status).toBe(503);
    expect(paused.headers.get('retry-after')).toBe('5');
    expect(getProject(database, id)).toBeNull();
    expect((await fetch(`${origin}/api/projects/${id}/files`, { headers: { authorization: `Bearer ${token}` } })).status).toBe(503);
    expect((await maintenance({ owner: id })).status).toBe(409);
    expect((await maintenance({ owner: backupOwner, epoch: lease.epoch + 1 }, 'DELETE')).status).toBe(409);
    expect((await maintenance({ owner: backupOwner, epoch: lease.epoch }, 'DELETE')).status).toBe(204);
    expect((await register()).status).toBe(201);
  });
  it('waits for a previously admitted asynchronous mutation to finish', async () => {
    let complete!: () => void; let started!: () => void;
    const admitted = new Promise<void>((resolve) => { started = resolve; });
    app.post(`/api/projects/${id}/files/delayed`, async (_req, res) => {
      await new Promise<void>((resolve) => { complete = resolve; started(); });
      res.sendStatus(204);
    });
    const running = fetch(`${origin}/api/projects/${id}/files/delayed`, { method: 'POST', headers: { authorization: `Bearer ${token}` } });
    await admitted;
    const heartbeat = (epoch?: number) => fetch(`${origin}/api/embedded/maintenance`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ owner: backupOwner, epoch }) });
    try {
      const lease = await (await heartbeat()).json() as { epoch: number };
      expect(lease).toMatchObject({ activeWrites: 1, requestsDrained: false });
      complete(); expect((await running).status).toBe(204);
      expect(await (await heartbeat(lease.epoch)).json()).toMatchObject({ activeWrites: 0, requestsDrained: true });
    } finally { complete(); await running; }
  });
  it('also drains bounded GET requests that can bootstrap retained history', async () => {
    let complete!: () => void; let started!: () => void;
    const admitted = new Promise<void>((resolve) => { started = resolve; });
    app.get(`/api/projects/${id}/files/delayed.html/versions`, async (_req, res) => {
      await new Promise<void>((resolve) => { complete = resolve; started(); }); res.json({ versions: [] });
    });
    const running = fetch(`${origin}/api/projects/${id}/files/delayed.html/versions`, { headers: { authorization: `Bearer ${token}` } });
    await admitted;
    try {
      const acquired = await fetch(`${origin}/api/embedded/maintenance`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ owner: backupOwner }) });
      expect(await acquired.json()).toMatchObject({ activeWrites: 1, requestsDrained: false });
      complete(); expect((await running).status).toBe(200);
    } finally { complete(); await running; }
  });
  it('does not certify an aborted mutation response as drained', async () => {
    app.post(`/api/projects/${id}/files/aborted`, (_req, res) => { res.destroy(); });
    await expect(fetch(`${origin}/api/projects/${id}/files/aborted`, { method: 'POST', headers: { authorization: `Bearer ${token}` } })).rejects.toThrow();
    const lease = await fetch(`${origin}/api/embedded/maintenance`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ owner: backupOwner }) });
    expect(await lease.json()).toMatchObject({ activeWrites: 1, requestsDrained: false });
  });
  it('rejects a root outside the project workspace pattern', async () => {
    expect((await register({ id, name: 'Bad root', kind: 'prototype', directory: scratch })).status).toBe(400);
    expect(getProject(database, id)).toBeNull();
  });
  it('rejects a symlink alias for a project root', async () => {
    const alias = path.join(scratch, 'alias');
    await symlink(directory, alias);
    expect((await register({ id, name: 'Alias', kind: 'prototype', directory: alias })).status).toBe(400);
  });
  it('rejects rebinding a persisted identity to different files', async () => {
    expect((await register()).status).toBe(201);
    const other = path.join(root, 'bots', 'a'.repeat(64), 'files', 'projects', id);
    await mkdir(other, { recursive: true });
    expect((await register({ id, name: 'Other', kind: 'prototype', directory: other })).status).toBe(409);
  });
  it.each(['/chat', '/runs/start', '/projects/' + id + '/conversations', '/projects/' + id + '/working-dir', '/terminal', '/app-config', '/import/folder', '/media/config'])('blocks the upstream agent/host surface %s', async (pathname) => {
    const response = await fetch(`${origin}/api${pathname}`, { method: 'POST', headers: { authorization: `Bearer ${token}` } });
    expect(response.status).toBe(403);
  });
  it.each([
    ['GET', '/preview/isolation'],
    ['GET', `/projects/${id}/powered/index.html`],
    ['POST', `/projects/${id}/build`],
    ['POST', `/projects/${id}/format`],
    ['POST', `/projects/${id}/import`],
    ['GET', '/terminal'],
  ])('denies privileged preview and execution handlers before dispatch: %s %s', async (method, pathname) => {
    const dispatch = vi.fn((_req, res) => res.json({ dispatched: true }));
    app.all(`/api${pathname}`, dispatch);
    const response = await fetch(`${origin}/api${pathname}`, {
      method, headers: { authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: 'EMBEDDED_OPERATION_DENIED' } });
    expect(dispatch).not.toHaveBeenCalled();
  });
  it('keeps ordinary upstream mode unchanged', () => {
    expect(embeddedOperationAllowed('GET', `/projects/${id}/files`)).toBe(true);
    expect(embeddedOperationAllowed('POST', `/projects/${id}/export/pdf`)).toBe(true);
    expect(embeddedOperationAllowed('PATCH', `/projects/${id}`)).toBe(false);
  });
});

describe('bounded embedded exports', () => {
  it.each(['html', 'pdf', 'pdf-image', 'image', 'pptx'])('allows the known UI export %s', format => {
    expect(embeddedOperationAllowed('POST', `/projects/${id}/export/${format}`)).toBe(true);
  });
  it.each(['', '/video', '/run', '/provider', '/pdf/run', '/image/download'])('rejects unadvertised export tail %s', tail => {
    expect(embeddedOperationAllowed('POST', `/projects/${id}/export${tail}`)).toBe(false);
  });
});
