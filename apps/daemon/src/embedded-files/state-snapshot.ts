import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { z } from 'zod';
import { backupStudioDatabase } from './database-backup.js';
import { defaultSnapshotLimits, ownedDirectory, snapshotFiles, syncSnapshotPath, type SnapshotLimits } from './snapshot-files.js';

const digest = z.string().regex(/^[0-9a-f]{64}$/);
const safePath = z.string().min(1).max(4000).refine((value) => value.split('/').every((part) => part && part !== '.' && part !== '..' && !/[\\\0]/.test(part)));
const Manifest = z.object({ version: z.literal(1), operationId: z.string().uuid(), companionBuild: digest, createdAt: z.string().datetime(), files: z.record(safePath, z.object({ bytes: z.number().int().nonnegative(), sha256: digest }).strict()) }).strict();
export type CompanionSnapshot = z.infer<typeof Manifest>;
const canonical = (files: CompanionSnapshot['files']) => JSON.stringify(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
const absent = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
async function exists(file: string) { try { await lstat(file); return true; } catch (error) { if (absent(error)) return false; throw error; } }

export async function verifyCompanionSnapshot(directory: string, limits = defaultSnapshotLimits): Promise<CompanionSnapshot> {
  await ownedDirectory(directory, true);
  const receipt = path.join(directory, 'snapshot.json');
  const info = await lstat(receipt);
  if (!info.isFile() || info.nlink !== 1 || info.uid !== process.getuid?.() || (info.mode & 0o077) || info.size > 32 * 1024 ** 2) throw new Error('Invalid Studio snapshot receipt.');
  const manifest = Manifest.parse(JSON.parse(await readFile(receipt, 'utf8')));
  const expectedDatabase = `database/${manifest.operationId}/app.sqlite`;
  if (!manifest.files[expectedDatabase] || !manifest.files[`database/${manifest.operationId}/manifest.json`] || Object.keys(manifest.files).some((name) => !name.startsWith('projects/') && ![expectedDatabase, `database/${manifest.operationId}/manifest.json`].includes(name))) throw new Error('Invalid Studio snapshot layout.');
  if (canonical(await snapshotFiles(directory, undefined, limits, new Set(['snapshot.json']))) !== canonical(manifest.files)) throw new Error('Studio snapshot contents do not match its receipt.');
  return manifest;
}

/** Host lifecycle coordination is mandatory: stop all supervised writers and
 * hold their exclusive lock until this call finishes. Workspaces/Postgres are
 * separate members of the host's coordinated backup. */
export async function captureCompanionSnapshot(options: { dataRoot: string; backupRoot: string; operationId: string; companionBuild: string; assertOffline: () => Promise<void>; limits?: SnapshotLimits }): Promise<CompanionSnapshot> {
  const { dataRoot, backupRoot, assertOffline } = options;
  if (!path.isAbsolute(dataRoot) || !path.isAbsolute(backupRoot)) throw new Error('Studio snapshot roots must be absolute canonical directories.');
  const operationId = z.string().uuid().parse(options.operationId);
  const companionBuild = digest.parse(options.companionBuild);
  const limits = options.limits ?? defaultSnapshotLimits;
  await ownedDirectory(dataRoot, true); await ownedDirectory(backupRoot, true);
  const projects = path.join(dataRoot, 'projects');
  if (backupRoot === projects || backupRoot.startsWith(projects + path.sep)) throw new Error('Studio backups cannot be stored inside retained project storage.');
  await assertOffline();
  const destination = path.join(backupRoot, operationId);
  if (await exists(destination)) {
    const receipt = await verifyCompanionSnapshot(destination, limits);
    if (receipt.operationId !== operationId || receipt.companionBuild !== companionBuild) throw new Error('Studio snapshot identity conflict.');
    return receipt;
  }
  const pending = path.join(backupRoot, `.pending-${operationId}-${randomUUID()}`);
  await mkdir(pending, { mode: 0o700 });
  try {
    const databaseRoot = path.join(pending, 'database'); await mkdir(databaseRoot, { mode: 0o700 });
    const databaseFile = path.join(dataRoot, 'app.sqlite');
    const databaseInfo = await lstat(databaseFile);
    if (!databaseInfo.isFile() || databaseInfo.nlink !== 1 || databaseInfo.uid !== process.getuid?.() || (databaseInfo.mode & 0o022)) throw new Error('Invalid Studio database source.');
    if (databaseInfo.size > limits.bytes) throw new Error('Studio snapshot byte limit exceeded.');
    const database = new Database(databaseFile, { readonly: true, fileMustExist: true });
    try { await backupStudioDatabase(database, databaseRoot, operationId); } finally { database.close(); }
    await mkdir(path.join(pending, 'projects'), { mode: 0o700 });
    if (await exists(projects)) await snapshotFiles(projects, path.join(pending, 'projects'), limits);
    await assertOffline();
    const manifest: CompanionSnapshot = { version: 1, operationId, companionBuild, createdAt: new Date().toISOString(), files: await snapshotFiles(pending, undefined, limits) };
    const receipt = await open(path.join(pending, 'snapshot.json'), 'wx', 0o600);
    try { await receipt.writeFile(JSON.stringify(manifest) + '\n'); await receipt.sync(); } finally { await receipt.close(); }
    await verifyCompanionSnapshot(pending, limits); await syncSnapshotPath(pending);
    try { await rename(pending, destination); }
    catch (error) {
      if (!['EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
      const existing = await verifyCompanionSnapshot(destination, limits);
      if (existing.operationId !== operationId || existing.companionBuild !== companionBuild) throw new Error('Studio snapshot identity conflict.');
      return existing;
    }
    await syncSnapshotPath(backupRoot);
    return manifest;
  } finally { await rm(pending, { recursive: true, force: true }); }
}

/** Prepare a fresh companion data root; replacement of live state belongs to
 * the host's restore transaction and is intentionally not performed here. */
export async function restoreCompanionSnapshot(options: { snapshot: string; destination: string; companionBuild: string; assertOffline: () => Promise<void>; limits?: SnapshotLimits }): Promise<CompanionSnapshot> {
  const { destination, assertOffline } = options; const limits = options.limits ?? defaultSnapshotLimits;
  if (!path.isAbsolute(destination) || !path.isAbsolute(options.snapshot)) throw new Error('Studio restore roots must be absolute canonical directories.');
  const manifest = await verifyCompanionSnapshot(options.snapshot, limits);
  if (manifest.companionBuild !== options.companionBuild) throw new Error('Restore requires the matching companion build before migration.');
  await ownedDirectory(path.dirname(destination), true); await assertOffline();
  if (await exists(destination)) throw new Error('Studio restore needs a fresh destination; existing state was not changed.');
  const pending = path.join(path.dirname(destination), `.restore-${randomUUID()}`);
  await mkdir(pending, { mode: 0o700 });
  try {
    const copied = await snapshotFiles(options.snapshot, pending, limits, new Set(['snapshot.json']));
    if (canonical(copied) !== canonical(manifest.files)) throw new Error('Studio snapshot changed during restore.');
    await rename(path.join(pending, 'database', manifest.operationId, 'app.sqlite'), path.join(pending, 'app.sqlite'));
    await rm(path.join(pending, 'database'), { recursive: true });
    const restored = new Database(path.join(pending, 'app.sqlite'), { readonly: true, fileMustExist: true });
    try { if (restored.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('Restored Studio SQLite failed its integrity check.'); } finally { restored.close(); }
    await assertOffline(); await syncSnapshotPath(pending);
    if (await exists(destination)) throw new Error('Studio restore destination appeared during preparation.');
    await rename(pending, destination); await syncSnapshotPath(path.dirname(destination));
    return manifest;
  } finally { await rm(pending, { recursive: true, force: true }); }
}
