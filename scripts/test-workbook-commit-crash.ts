import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import fs, { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs-community';
import { killWorkbookFixtureAt } from './lib/workbook-crash-process.js';

type Db = typeof import('../apps/daemon/src/db.js');
type Commit = typeof import('../apps/daemon/src/artifacts/workbook/contained-commit.js');
type History = typeof import('../apps/daemon/src/project-file-versions.js');
interface Configuration { root: string; projectId: string; directory: string; checkpoint: string; operationId: string; sourceSha256: string; bytes: string }
const dbUrl = new URL('../apps/daemon/dist/db.js', import.meta.url).href;
const commitUrl = new URL('../apps/daemon/dist/artifacts/workbook/contained-commit.js', import.meta.url).href;
const historyUrl = new URL('../apps/daemon/dist/project-file-versions.js', import.meta.url).href;
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
if (process.argv[2] === '--child') {
  const configuration = JSON.parse(await readFile(process.argv[3]!, 'utf8')) as Configuration;
  process.env.OD_EMBEDDED_WORKSPACE_ROOT = path.join(configuration.root, 'workspaces');
  const pause = async () => { process.send?.({ checkpoint: configuration.checkpoint }); await new Promise(() => { setInterval(() => {}, 1000); }); };
  const rename = fs.rename.bind(fs), open = fs.open.bind(fs); let workspaceRenamed = false;
  fs.rename = async (from, to) => {
    const workspace = to.toString().endsWith('/book.xlsx');
    if (workspace && configuration.checkpoint === 'before-workspace-rename') await pause();
    await rename(from, to); if (workspace) workspaceRenamed = true;
  };
  fs.open = async (...args) => {
    const handle = await open(...args);
    if ((await handle.stat()).isDirectory()) {
      const sync = handle.sync.bind(handle);
      handle.sync = async () => { await sync(); if (workspaceRenamed && configuration.checkpoint === 'after-workspace-sync') await pause(); };
    }
    return handle;
  };
  syncBuiltinESMExports();
  const database = await import(dbUrl) as Db, commit = await import(commitUrl) as Commit;
  await commit.commitEmbeddedWorkbook(database.openDatabase(configuration.root), path.join(configuration.root, 'metadata'), {
    projectId: configuration.projectId, actor: 'fixture-person', operationId: configuration.operationId, fileName: 'book.xlsx', sourceSha256: configuration.sourceSha256, bytes: Buffer.from(configuration.bytes, 'base64'),
  }, { embeddedHost: 'evebot', baseDir: configuration.directory }, async () => {});
  if (configuration.checkpoint === 'after-receipt-commit') await pause();
  throw new Error('Workbook commit checkpoint was not reached');
} else {
  const database = await import(dbUrl) as Db, commit = await import(commitUrl) as Commit, history = await import(historyUrl) as History;
  const scratch = await mkdtemp(path.join(tmpdir(), 'od-workbook-commit-crash-')), previousWorkspace = process.env.OD_EMBEDDED_WORKSPACE_ROOT;
  async function workbook(value: number) { const book = new ExcelJS.Workbook(); book.addWorksheet('Inputs').getCell('A1').value = value; return Buffer.from(await book.xlsx.writeBuffer()); }
  try {
    const original = await workbook(2), candidate = await workbook(8), later = await workbook(16);
    for (const mode of ['commit', 'reconcile'] as const) for (const checkpoint of ['before-workspace-rename', 'after-workspace-sync', 'after-receipt-commit']) {
      const root = path.join(scratch, `${checkpoint}-${mode}`), projectId = randomUUID(), operationId = randomUUID(), directory = path.join(root, 'workspaces/team/projects', projectId);
      await mkdir(directory, { recursive: true }); await chmod(path.join(root, 'workspaces'), 0o700); await writeFile(path.join(directory, 'book.xlsx'), original);
      let db = database.openDatabase(root); database.insertProject(db, { id: projectId, name: 'Crash fixture', createdAt: 1, updatedAt: 1 }); database.closeDatabase();
      const configuration: Configuration = { root, projectId, directory, operationId, checkpoint, sourceSha256: digest(original), bytes: candidate.toString('base64') };
      const configFile = path.join(root, 'fixture.json'); await writeFile(configFile, JSON.stringify(configuration));
      await killWorkbookFixtureAt(new URL(import.meta.url), configFile, checkpoint);
      db = database.openDatabase(root); process.env.OD_EMBEDDED_WORKSPACE_ROOT = path.join(root, 'workspaces');
      const request = { projectId, actor: 'fixture-person', operationId, fileName: 'book.xlsx', sourceSha256: digest(original), bytes: candidate };
      const metadata = { embeddedHost: 'evebot', baseDir: directory }, projectsRoot = path.join(root, 'metadata');
      const afterCrash = db.prepare('SELECT state FROM workbook_writes WHERE project_id=? AND operation_id=?').get(projectId, operationId) as { state: string };
      assert.equal(afterCrash.state, checkpoint === 'after-receipt-commit' ? 'applied' : 'pending');
      assert.deepEqual(await readFile(path.join(directory, 'book.xlsx')), checkpoint === 'before-workspace-rename' ? original : candidate);
      const applied = mode === 'commit' || checkpoint !== 'before-workspace-rename';
      const settled = await commit.commitEmbeddedWorkbook(db, projectsRoot, request, metadata, async () => {}, mode);
      assert.equal(settled.state, applied ? 'applied' : 'conflict'); assert.equal((await history.listProjectFileVersions(projectsRoot, projectId, 'book.xlsx', metadata)).length, applied ? 2 : 1);
      assert.deepEqual(await readFile(path.join(directory, 'book.xlsx')), applied ? candidate : original);
      const next = await commit.commitEmbeddedWorkbook(db, projectsRoot, { ...request, operationId: randomUUID(), sourceSha256: digest(applied ? candidate : original), bytes: later }, metadata, async () => {});
      assert.equal(next.state, 'applied');
      assert.deepEqual(await commit.commitEmbeddedWorkbook(db, projectsRoot, request, metadata, async () => {}), settled);
      assert.deepEqual(await readFile(path.join(directory, 'book.xlsx')), later, 'An old receipt must never overwrite a newer save');
      const versions = await history.listProjectFileVersions(projectsRoot, projectId, 'book.xlsx', metadata);
      assert.equal(versions.length, applied ? 3 : 2); assert.equal(versions.find(version => version.current)?.id, next.versionId);
      process.stdout.write(`PASS: ${checkpoint} (${mode}) settles one save, retains history and preserves newer edits on replay\n`);
      database.closeDatabase();
    }
  } finally {
    database.closeDatabase();
    if (previousWorkspace === undefined) delete process.env.OD_EMBEDDED_WORKSPACE_ROOT; else process.env.OD_EMBEDDED_WORKSPACE_ROOT = previousWorkspace;
    await rm(scratch, { recursive: true, force: true });
  }
}
