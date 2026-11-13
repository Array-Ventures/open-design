import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { backupStudioDatabase } from '../../src/embedded-files/database-backup.js';

let scratch: string; let backups: string; let db: Database.Database;
beforeEach(async () => {
  scratch = await mkdtemp(path.join(tmpdir(), 'od-backup-proof-'));
  backups = path.join(scratch, 'backups'); await mkdir(backups, { mode: 0o700 });
  db = new Database(path.join(scratch, 'live.sqlite'));
  db.pragma('journal_mode=WAL'); db.pragma('wal_autocheckpoint=0');
  db.exec('CREATE TABLE projects(id TEXT PRIMARY KEY, name TEXT); CREATE TABLE comments(project_id TEXT, body TEXT)');
  db.prepare('INSERT INTO projects VALUES (?,?)').run('fixture', 'WAL project');
  db.prepare('INSERT INTO comments VALUES (?,?)').run('fixture', 'Committed comment');
});
afterEach(async () => { db.close(); await rm(scratch, { recursive: true, force: true }); });

it('restores committed WAL state and keeps the same verified receipt after later edits', async () => {
  const id = randomUUID();
  expect((await readFile(path.join(scratch, 'live.sqlite-wal'))).length).toBeGreaterThan(0);
  const receipt = await backupStudioDatabase(db, backups, id);
  expect(receipt.tables).toEqual({ comments: 1, projects: 1 });
  expect(receipt.schemaSha256).toMatch(/^[0-9a-f]{64}$/);
  expect((await readdir(path.join(backups, id))).sort()).toEqual(['app.sqlite', 'manifest.json']);
  const restored = new Database(path.join(backups, id, 'app.sqlite'), { readonly: true });
  try {
    expect(restored.pragma('integrity_check', { simple: true })).toBe('ok');
    expect(restored.prepare('SELECT body FROM comments').pluck().get()).toBe('Committed comment');
  } finally { restored.close(); }
  db.exec("UPDATE comments SET body='Later change'");
  expect(await backupStudioDatabase(db, backups, id)).toEqual(receipt);
  expect(await readdir(backups)).toEqual([id]);
});

it('refuses damaged output on replay instead of replacing the original receipt', async () => {
  const id = randomUUID(); await backupStudioDatabase(db, backups, id);
  await writeFile(path.join(backups, id, 'app.sqlite'), 'corrupt bytes', { mode: 0o600 });
  await expect(backupStudioDatabase(db, backups, id)).rejects.toThrow('checksum mismatch');
  expect(await readFile(path.join(backups, id, 'app.sqlite'), 'utf8')).toBe('corrupt bytes');
});

it('refuses redirected roots and destinations without reading or changing the target', async () => {
  const redirected = path.join(scratch, 'redirected'); await symlink(backups, redirected);
  await expect(backupStudioDatabase(db, redirected, randomUUID())).rejects.toThrow('private canonical');
  const id = randomUUID(); await symlink(scratch, path.join(backups, id));
  await expect(backupStudioDatabase(db, backups, id)).rejects.toThrow('private canonical');
  expect(db.prepare('SELECT body FROM comments').pluck().get()).toBe('Committed comment');
});

it('deduplicates concurrent requests without publishing a partial snapshot', async () => {
  const id = randomUUID();
  const results = await Promise.all([backupStudioDatabase(db, backups, id), backupStudioDatabase(db, backups, id)]);
  expect(results[0]).toEqual(results[1]);
  expect(await readdir(backups)).toEqual([id]);
});

it('refuses an incomplete published directory instead of silently replacing it', async () => {
  const id = randomUUID();
  await mkdir(path.join(backups, id), { mode: 0o700 });
  await expect(backupStudioDatabase(db, backups, id)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await readdir(path.join(backups, id))).toEqual([]);
  expect(await readdir(backups)).toEqual([id]);
});
