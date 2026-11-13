import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, lstat, mkdir, open, readFile, realpath, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type StudioDatabaseBackup = {
  version: 1;
  operationId: string;
  createdAt: string;
  sqliteVersion: string;
  schemaSha256: string;
  databaseSha256: string;
  bytes: number;
  tables: Record<string, number>;
};
async function checksum(file: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
async function privateDirectory(directory: string) {
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid?.() || (info.mode & 0o077) || await realpath(directory) !== path.resolve(directory)) throw new Error('Studio backup requires an owned private canonical directory.');
}
async function sync(file: string) {
  const handle = await open(file, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}
async function verify(directory: string, operationId: string): Promise<StudioDatabaseBackup> {
  await privateDirectory(directory);
  const file = path.join(directory, 'app.sqlite');
  const info = await lstat(file);
  const manifestInfo = await lstat(path.join(directory, 'manifest.json'));
  if (!info.isFile() || info.nlink !== 1 || !manifestInfo.isFile() || manifestInfo.nlink !== 1 || info.uid !== process.getuid?.() || manifestInfo.uid !== process.getuid?.() || (info.mode & 0o077) || (manifestInfo.mode & 0o077)) throw new Error('Studio backup files are redirected or not private.');
  const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8')) as StudioDatabaseBackup;
  if (manifest.version !== 1 || manifest.operationId !== operationId || manifest.bytes !== info.size || manifest.databaseSha256 !== await checksum(file)) throw new Error('Studio backup checksum mismatch.');
  return manifest;
}

/** SQLite's backup API includes committed WAL pages. This is one component of
 * a coordinated host backup, not an atomic snapshot of project files/Postgres. */
export async function backupStudioDatabase(database: Database.Database, backupRoot: string, operationId: string): Promise<StudioDatabaseBackup> {
  if (!uuid.test(operationId)) throw new Error('Use a UUID backup identity.');
  await privateDirectory(backupRoot);
  const destination = path.join(backupRoot, operationId);
  let exists = false;
  try { await lstat(destination); exists = true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (exists) return await verify(destination, operationId);
  const pending = path.join(backupRoot, `.pending-${operationId}-${randomUUID()}`);
  await mkdir(pending, { mode: 0o700 });
  try {
    const file = path.join(pending, 'app.sqlite');
    const handle = await open(file, 'wx', 0o600); await handle.close();
    await database.backup(file);
    await chmod(file, 0o600);
    const copy = new Database(file, { fileMustExist: true });
    let manifest: StudioDatabaseBackup;
    try {
      // A backup must be independently restorable without WAL/SHM sidecars.
      // Change only this private captured copy, never the live database.
      copy.pragma('journal_mode = DELETE');
      if (copy.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('Studio SQLite backup failed its integrity check.');
      const schema = copy.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
      const tables: Record<string, number> = {};
      for (const row of copy.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]) {
        const quoted = '"' + row.name.replaceAll('"', '""') + '"';
        tables[row.name] = (copy.prepare(`SELECT count(*) AS n FROM ${quoted}`).get() as { n: number }).n;
      }
      manifest = { version: 1, operationId, createdAt: new Date().toISOString(), sqliteVersion: copy.prepare('SELECT sqlite_version()').pluck().get() as string, schemaSha256: createHash('sha256').update(JSON.stringify(schema)).digest('hex'), databaseSha256: await checksum(file), bytes: (await lstat(file)).size, tables };
    } finally { copy.close(); }
    await sync(file);
    const receipt = await open(path.join(pending, 'manifest.json'), 'wx', 0o600);
    try { await receipt.writeFile(JSON.stringify(manifest) + '\n'); await receipt.sync(); } finally { await receipt.close(); }
    await sync(pending);
    try { await rename(pending, destination); }
    catch (error) {
      if (!['EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
      return await verify(destination, operationId);
    }
    await sync(backupRoot);
    return manifest;
  } finally { await rm(pending, { recursive: true, force: true }); }
}
