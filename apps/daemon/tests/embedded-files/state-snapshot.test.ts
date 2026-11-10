import { randomUUID } from 'node:crypto';
import { chmod, link, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { captureCompanionSnapshot, restoreCompanionSnapshot, verifyCompanionSnapshot } from '../../src/embedded-files/state-snapshot.js';

let scratch: string; let dataRoot: string; let backupRoot: string; let history: string;
const build = 'a'.repeat(64);
const offline = async () => {};
beforeEach(async () => {
  scratch = await mkdtemp(path.join(tmpdir(), 'od-state-snapshot-'));
  dataRoot = path.join(scratch, 'state'); backupRoot = path.join(scratch, 'backups');
  await mkdir(dataRoot, { mode: 0o700 }); await mkdir(backupRoot, { mode: 0o700 });
  history = path.join(dataRoot, 'projects', 'fixture', '.file-versions'); await mkdir(history, { recursive: true });
  await writeFile(path.join(history, 'version.html'), '<h1>Retained version</h1>');
  await writeFile(path.join(history, 'manifest.json'), '{"version":1}');
  const db = new Database(path.join(dataRoot, 'app.sqlite'));
  db.pragma('journal_mode=WAL'); db.exec("CREATE TABLE comments(body TEXT); INSERT INTO comments VALUES ('Retained comment')"); db.close();
});
afterEach(async () => { await rm(scratch, { recursive: true, force: true }); });
const capture = (operationId: string = randomUUID(), extra = {}) => captureCompanionSnapshot({ dataRoot, backupRoot, operationId, companionBuild: build, assertOffline: offline, ...extra });

it('captures and restores SQLite comments and retained history into fresh state', async () => {
  const check = vi.fn(offline); const receipt = await capture(undefined, { assertOffline: check });
  expect(check).toHaveBeenCalledTimes(2);
  const snapshot = path.join(backupRoot, receipt.operationId);
  expect(await verifyCompanionSnapshot(snapshot)).toEqual(receipt);
  const destination = path.join(scratch, 'restored');
  expect(await restoreCompanionSnapshot({ snapshot, destination, companionBuild: build, assertOffline: check })).toEqual(receipt);
  const restored = new Database(path.join(destination, 'app.sqlite'), { readonly: true });
  try { expect(restored.prepare('SELECT body FROM comments').pluck().get()).toBe('Retained comment'); } finally { restored.close(); }
  expect(await readFile(path.join(destination, 'projects/fixture/.file-versions/version.html'), 'utf8')).toBe('<h1>Retained version</h1>');
});

it('replays immutable bytes after source edits and rejects a different build identity', async () => {
  const receipt = await capture();
  await writeFile(path.join(history, 'version.html'), 'changed later');
  expect(await capture(receipt.operationId)).toEqual(receipt);
  await expect(capture(receipt.operationId, { companionBuild: 'b'.repeat(64) })).rejects.toThrow('identity conflict');
  expect(await readdir(backupRoot)).toEqual([receipt.operationId]);
});

it('refuses corrupt or extra backup files before creating restore output', async () => {
  const receipt = await capture(); const snapshot = path.join(backupRoot, receipt.operationId);
  await writeFile(path.join(snapshot, 'projects/fixture/.file-versions/version.html'), 'tampered');
  const destination = path.join(scratch, 'restored');
  await expect(restoreCompanionSnapshot({ snapshot, destination, companionBuild: build, assertOffline: offline })).rejects.toThrow('do not match');
  expect(await readdir(scratch)).not.toContain('restored');
});

it.each(['symlink', 'hardlink'])('refuses a %s in managed history without publishing partial output', async (kind) => {
  const canary = path.join(scratch, 'canary'); await writeFile(canary, 'private canary');
  if (kind === 'symlink') await symlink(canary, path.join(history, 'redirected'));
  else await link(canary, path.join(history, 'redirected'));
  await expect(capture()).rejects.toThrow('refuses links');
  expect(await readdir(backupRoot)).toEqual([]);
  expect(await readFile(canary, 'utf8')).toBe('private canary');
});

it('cleans pending output if the supervisor loses quiescence during capture', async () => {
  const check = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('companion restarted'));
  await expect(capture(undefined, { assertOffline: check })).rejects.toThrow('companion restarted');
  expect(await readdir(backupRoot)).toEqual([]);
});

it.each([{ files: 0, bytes: 100000 }, { files: 100, bytes: 1 }])('enforces bounded snapshot admission %j', async (limits) => {
  await expect(capture(undefined, { limits })).rejects.toThrow('limit exceeded');
  expect(await readdir(backupRoot)).toEqual([]);
});

it('refuses build mismatches and existing destinations without replacing live data', async () => {
  const receipt = await capture(); const snapshot = path.join(backupRoot, receipt.operationId);
  await expect(restoreCompanionSnapshot({ snapshot, destination: path.join(scratch, 'new'), companionBuild: 'b'.repeat(64), assertOffline: offline })).rejects.toThrow('matching companion build');
  await expect(restoreCompanionSnapshot({ snapshot, destination: dataRoot, companionBuild: build, assertOffline: offline })).rejects.toThrow('fresh destination');
  expect(await readFile(path.join(history, 'version.html'), 'utf8')).toBe('<h1>Retained version</h1>');
});

it('requires a private ancestor for upstream group-writable history files', async () => {
  await chmod(dataRoot, 0o775);
  await expect(capture()).rejects.toThrow('safe permissions');
  expect(await readdir(backupRoot)).toEqual([]);
});

it('converges simultaneous capture requests onto one verified snapshot', async () => {
  const id = randomUUID();
  const [first, second] = await Promise.all([capture(id), capture(id)]);
  expect(first).toEqual(second);
  expect(await readdir(backupRoot)).toEqual([id]);
});
