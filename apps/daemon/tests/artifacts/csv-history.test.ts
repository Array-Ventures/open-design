import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { closeDatabase, insertProject, openDatabase } from '../../src/db.js';
import { PinnedProject } from '../../src/embedded-files/pinned-project.js';
import { commitEmbeddedWorkbook } from '../../src/artifacts/workbook/contained-commit.js';
import { listProjectFileVersions } from '../../src/project-file-versions.js';
let root: string, projectsRoot: string, projectId: string, directory: string, pinned: PinnedProject, db: Database.Database;
const original = Buffer.from('\ufeff"001",=1+2,\r\n'), candidate = Buffer.from('\ufeff"002",=1+2,\r\n');
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const authorize = vi.fn(async () => {});
const metadata = () => ({ embeddedHost: 'evebot', baseDir: directory });
const input = () => ({ projectId, actor: 'human:test', operationId: randomUUID(), fileName: 'data.csv', sourceSha256: sha(original), bytes: candidate });
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'od-csv-history-')); projectsRoot = path.join(root, 'metadata'); projectId = randomUUID();
  const workspace = path.join(root, 'workspaces'); directory = path.join(workspace, 'team', 'projects', projectId);
  vi.stubEnv('OD_EMBEDDED_WORKSPACE_ROOT', workspace); await mkdir(directory, { recursive: true }); await chmod(workspace, 0o700);
  pinned = await PinnedProject.open(workspace, directory, projectId); await pinned.write('data.csv', original);
  db = openDatabase(root); insertProject(db, { id: projectId, name: 'CSV', createdAt: 1, updatedAt: 1 }); authorize.mockReset(); authorize.mockResolvedValue();
});
afterEach(async () => { await pinned.close(); closeDatabase(); vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });
it('retains exact CSV binary history and replays an applied receipt without overwriting a later file', async () => {
  const request = input(), receipt = await commitEmbeddedWorkbook(db, projectsRoot, request, metadata(), authorize);
  expect(receipt.state).toBe('applied'); expect((await pinned.read('data.csv')).buffer).toEqual(candidate);
  const history = await listProjectFileVersions(projectsRoot, projectId, 'data.csv', metadata());
  expect(history).toHaveLength(2); expect(history.find(version => version.id === receipt.versionId)?.contentDigest).toBe(sha(candidate));
  const later = Buffer.from('external,new,bytes\n'); await pinned.write('data.csv', later);
  expect(await commitEmbeddedWorkbook(db, projectsRoot, request, metadata(), authorize)).toEqual(receipt);
  expect((await pinned.read('data.csv')).buffer).toEqual(later);
});
it('settles a lost acknowledgement from the same operation without duplicate CSV revisions', async () => {
  const request = input();
  db.exec("CREATE TRIGGER interrupt_csv_receipt BEFORE UPDATE OF state ON workbook_writes WHEN NEW.state='applied' BEGIN SELECT RAISE(ABORT,'lost receipt'); END");
  await expect(commitEmbeddedWorkbook(db, projectsRoot, request, metadata(), authorize)).rejects.toThrow('lost receipt');
  expect((await pinned.read('data.csv')).buffer).toEqual(candidate); db.exec('DROP TRIGGER interrupt_csv_receipt');
  expect((await commitEmbeddedWorkbook(db, projectsRoot, request, metadata(), authorize)).state).toBe('applied');
  expect(await listProjectFileVersions(projectsRoot, projectId, 'data.csv', metadata())).toHaveLength(2);
});
it('enforces fresh authority and expected-source identity before any live CSV change', async () => {
  authorize.mockRejectedValueOnce(new Error('Access revoked'));
  await expect(commitEmbeddedWorkbook(db, projectsRoot, input(), metadata(), authorize)).rejects.toThrow('Access revoked');
  expect((await pinned.read('data.csv')).buffer).toEqual(original);
  const external = Buffer.from('other,current\n'); await pinned.write('data.csv', external);
  const receipt = await commitEmbeddedWorkbook(db, projectsRoot, input(), metadata(), authorize);
  expect(receipt.state).toBe('conflict'); expect((await pinned.read('data.csv')).buffer).toEqual(external);
});
