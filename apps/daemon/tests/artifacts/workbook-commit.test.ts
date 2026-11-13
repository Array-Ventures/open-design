import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import ExcelJS from 'exceljs-community';
import { closeDatabase, insertProject, openDatabase } from '../../src/db.js';
import { PinnedProject, readPinnedFile, writePinnedFile } from '../../src/embedded-files/pinned-project.js';
import { commitWorkbook, WorkbookSourceChangedError, type WorkbookCommitFiles, type WorkbookCommitInput } from '../../src/artifacts/workbook/commit.js';
import { commitEmbeddedWorkbook } from '../../src/artifacts/workbook/contained-commit.js';
import { listProjectFileVersions, getProjectFileVersionRootStats } from '../../src/project-file-versions.js';
import { readXlsxWorkbook } from '../../src/artifacts/workbook/reader.js';
import { calculateWorkbookCellEdits } from '../../src/artifacts/workbook/calculated-patch.js';
import { WORKBOOK_HISTORY_MANIFEST_BYTES } from '../../src/artifacts/workbook/history-storage.js';
import { readWorkbookWrite } from '../../src/storage/workbook-writes.js';

const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
describe('workbook save receipt coordination', () => {
  let root: string, projectsRoot: string, projectId: string, directory: string, pinned: PinnedProject, db: Database.Database;
  let original: Buffer, candidate: Buffer, later: Buffer, input: WorkbookCommitInput;
  let files: WorkbookCommitFiles;
  async function workbook(value: number) { const book = new ExcelJS.Workbook(); book.addWorksheet('Inputs').getCell('A1').value = value; return Buffer.from(await book.xlsx.writeBuffer()); }
  const metadata = () => ({ embeddedHost: 'evebot', baseDir: directory });
  const commit = (request = input) => commitWorkbook(db, projectsRoot, request, metadata(), files);
  const versions = () => listProjectFileVersions(projectsRoot, projectId, 'book.xlsx', metadata());
  const receipt = () => readWorkbookWrite(db, { ...input, targetSha256: digest(input.bytes) });
  async function seedHistory(count: number, currentBytes = original, byteCap = false) {
    const history = await getProjectFileVersionRootStats(projectsRoot, projectId, 'book.xlsx', metadata());
    await mkdir(history.root, { recursive: true });
    const entries = Array.from({ length: count }, (_, index) => ({ id: `retained-${index}`, fileName: 'book.xlsx', version: index + 1, label: 'Retained fixture', createdAt: index + 1, source: 'manual', prompt: null, size: currentBytes.length, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', kind: 'data', contentPath: `retained-${index}.xlsx`, contentDigest: digest(currentBytes) }));
    const manifest = { schemaVersion: 2, fileName: 'book.xlsx', currentVersionId: entries.at(-1)!.id, entries };
    if (byteCap) entries[0]!.label += 'x'.repeat(WORKBOOK_HISTORY_MANIFEST_BYTES - Buffer.byteLength(JSON.stringify(manifest, null, 2)) - 32);
    const content = JSON.stringify(manifest, null, 2);
    expect(Buffer.byteLength(content)).toBeLessThanOrEqual(WORKBOOK_HISTORY_MANIFEST_BYTES);
    // Only the current blob is read. Metadata-capacity fixtures do not need
    // thousands of duplicate large workbook payloads to exercise the bound.
    await writeFile(path.join(history.root, entries.at(-1)!.contentPath), currentBytes);
    await writeFile(path.join(history.root, 'manifest.json'), content);
    return { root: history.root, content, currentId: manifest.currentVersionId };
  }

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'od-workbook-commit-')); projectsRoot = path.join(root, 'metadata'); projectId = randomUUID();
    const workspace = path.join(root, 'workspaces'); directory = path.join(workspace, 'team', 'projects', projectId);
    vi.stubEnv('OD_EMBEDDED_WORKSPACE_ROOT', workspace);
    await mkdir(directory, { recursive: true }); await chmod(workspace, 0o700);
    pinned = await PinnedProject.open(workspace, directory, projectId);
    db = openDatabase(root); insertProject(db, { id: projectId, name: 'Workbook fixture', createdAt: 1, updatedAt: 1 });
    original = await workbook(2); candidate = await workbook(8); later = await workbook(16); await pinned.write('book.xlsx', original);
    input = { projectId, actor: 'person', operationId: randomUUID(), fileName: 'book.xlsx', sourceSha256: digest(original), bytes: candidate };
    files = {
      authorize: vi.fn(async () => {}),
      read: vi.fn(async () => { try { return (await pinned.read('book.xlsx')).buffer; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; } }),
      write: vi.fn((bytes, expected) => pinned.withParent('book.xlsx', false, async (parent, leaf) => {
        if (digest((await readPinnedFile(parent, leaf)).buffer) !== expected) throw new Error('Source changed at commit boundary');
        await writePinnedFile(parent, leaf, bytes);
      })),
    };
  });
  afterEach(async () => { await pinned.close(); closeDatabase(); vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });
  it('uses the actual registered-project adapter for contained binary saves', async () => {
    const saved = await commitEmbeddedWorkbook(db, projectsRoot, input, metadata(), files.authorize);
    expect(saved.state).toBe('applied'); expect((await pinned.read('book.xlsx')).buffer).toEqual(candidate);
  });
  it('captures source and saved binary revisions with a terminal receipt', async () => {
    const saved = await commit();
    expect(saved).toMatchObject({ operationId: input.operationId, state: 'applied', targetSha256: digest(candidate), actualSha256: digest(candidate) });
    expect(saved.sourceVersionId).toBeTruthy(); expect(saved.versionId).toBeTruthy();
    const history = await versions(); expect(history).toHaveLength(2);
    expect(history.find(version => version.id === saved.versionId)?.parentVersionId).toBe(saved.sourceVersionId);
    const book = new ExcelJS.Workbook(); await book.xlsx.load(Uint8Array.from((await pinned.read('book.xlsx')).buffer).buffer);
    expect(book.getWorksheet('Inputs')!.getCell('A1').value).toBe(8);
  });
  it('commits an actual rich-run candidate and preserves an intervening source revision on the next rich save', async () => {
    const source = await readXlsxWorkbook(original), runs = [{ text: 'rich ', font: { bold: true } }, { text: '😀', font: { italic: true } }];
    candidate = (await calculateWorkbookCellEdits(source, [{ sheetId: '1', cell: { row: 0, column: 0, kind: 'string', value: 'rich 😀', runs } }])).bytes;
    input = { ...input, bytes: candidate };
    expect((await commit()).state).toBe('applied');
    const reopened = new ExcelJS.Workbook(); await reopened.xlsx.load(Uint8Array.from((await pinned.read('book.xlsx')).buffer).buffer);
    expect(reopened.worksheets[0]!.getCell('A1').value).toEqual({ richText: runs });
    const next = await calculateWorkbookCellEdits(await readXlsxWorkbook(candidate), [{ sheetId: '1', cell: { row: 0, column: 0, kind: 'string', value: 'later', runs: [{ text: 'later', font: { bold: true } }] } }]);
    input = { ...input, operationId: randomUUID(), sourceSha256: digest(candidate), bytes: next.bytes };
    await pinned.write('book.xlsx', later); expect((await commit()).state).toBe('conflict');
    expect((await pinned.read('book.xlsx')).buffer).toEqual(later); expect(receipt()?.state).toBe('conflict');
  });
  it('replays a committed receipt without file I/O or changing a newer revision', async () => {
    const first = await commit();
    const second = await commit({ ...input, operationId: randomUUID(), sourceSha256: digest(candidate), bytes: later });
    const read = vi.mocked(files.read).mock.calls.length, write = vi.mocked(files.write).mock.calls.length;
    expect(await commit()).toEqual(first);
    expect(vi.mocked(files.read).mock.calls).toHaveLength(read); expect(vi.mocked(files.write).mock.calls).toHaveLength(write);
    expect((await pinned.read('book.xlsx')).buffer).toEqual(later);
    expect((await versions()).find(version => version.current)?.id).toBe(second.versionId);
    expect(await versions()).toHaveLength(3);
  });
  it('refuses reusing a receipt identity for newer draft bytes', async () => {
    await commit();
    await expect(commit({ ...input, bytes: later })).rejects.toMatchObject({ code: 'WORKBOOK_OPERATION_CONFLICT' });
    expect((await pinned.read('book.xlsx')).buffer).toEqual(candidate); expect(await versions()).toHaveLength(2);
  });
  it('recovers an uncertain write after the bytes changed but before history/receipt completion', async () => {
    const write = vi.mocked(files.write).getMockImplementation()!;
    vi.mocked(files.write).mockImplementationOnce(async (...args) => { await write(...args); throw new Error('Lost completion after write'); });
    await expect(commit()).rejects.toThrow('Lost completion');
    expect(receipt()?.state).toBe('pending'); expect(await versions()).toHaveLength(1);
    const saved = await commit(); expect(saved.state).toBe('applied');
    expect(await versions()).toHaveLength(2); expect(files.write).toHaveBeenCalledTimes(1);
  });
  it('recovers a history commit when SQLite receipt finalization failed', async () => {
    db.exec("CREATE TRIGGER fail_workbook_finish BEFORE UPDATE OF state ON workbook_writes WHEN NEW.state='applied' BEGIN SELECT RAISE(ABORT,'receipt commit interrupted'); END");
    await expect(commit()).rejects.toThrow('receipt commit interrupted');
    const current = (await versions()).find(version => version.current)!;
    expect(receipt()?.state).toBe('pending'); db.exec('DROP TRIGGER fail_workbook_finish');
    expect((await commit()).versionId).toBe(current.id); expect(await versions()).toHaveLength(2); expect(files.write).toHaveBeenCalledTimes(1);
  });
  it('fences later save identities until the pending operation settles', async () => {
    vi.mocked(files.write).mockRejectedValueOnce(new Error('Writer unavailable'));
    await expect(commit()).rejects.toThrow('Writer unavailable');
    await expect(commit({ ...input, operationId: randomUUID(), bytes: later })).rejects.toMatchObject({ code: 'WORKBOOK_SAVE_PENDING' });
    expect((await pinned.read('book.xlsx')).buffer).toEqual(original);
    expect((await commit()).state).toBe('applied');
  });
  it('preserves an intervening external file change rather than rolling it back', async () => {
    await pinned.write('book.xlsx', later);
    expect(await commit()).toMatchObject({ state: 'conflict', actualSha256: digest(later), versionId: null });
    expect(files.write).not.toHaveBeenCalled(); expect((await pinned.read('book.xlsx')).buffer).toEqual(later);
  });
  it('records a last-boundary source mismatch as a conflict and preserves the newer bytes', async () => {
    vi.mocked(files.write).mockImplementationOnce(async () => { await pinned.write('book.xlsx', later); throw new WorkbookSourceChangedError('Changed at boundary'); });
    expect(await commit()).toMatchObject({ state: 'conflict', actualSha256: digest(later) });
    expect((await pinned.read('book.xlsx')).buffer).toEqual(later); expect(receipt()?.state).toBe('conflict');
  });
  it('checks authority before replay and again before writing', async () => {
    vi.mocked(files.authorize).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Access revoked'));
    await expect(commit()).rejects.toThrow('Access revoked'); expect(files.write).not.toHaveBeenCalled();
    expect((await pinned.read('book.xlsx')).buffer).toEqual(original);
    expect((await commit()).state).toBe('applied');
    vi.mocked(files.authorize).mockRejectedValueOnce(new Error('No read authority'));
    await expect(commit()).rejects.toThrow('No read authority');
  });
  it('does not resurrect a deleted file while settling a pending write', async () => {
    vi.mocked(files.write).mockRejectedValueOnce(new Error('Writer unavailable'));
    await expect(commit()).rejects.toThrow(); await rm(path.join(directory, 'book.xlsx'));
    expect(await commit()).toMatchObject({ state: 'conflict', actualSha256: null });
    await expect(readFile(path.join(directory, 'book.xlsx'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('reconciles a revoked operation without installing its prepared bytes', async () => {
    vi.mocked(files.write).mockRejectedValueOnce(new Error('Uncertain attempt'));
    await expect(commit()).rejects.toThrow('Uncertain attempt');
    files.mayWrite = false;
    expect(await commit()).toMatchObject({ state: 'conflict', actualSha256: digest(original) });
    files.mayWrite = true;
    expect((await commit()).state).toBe('conflict');
    expect((await pinned.read('book.xlsx')).buffer).toEqual(original); expect(files.write).toHaveBeenCalledTimes(1);
  });
  it('settles already-written bytes after revocation without another workspace write', async () => {
    const write = vi.mocked(files.write).getMockImplementation()!;
    vi.mocked(files.write).mockImplementationOnce(async (...args) => { await write(...args); throw new Error('Lost completion'); });
    await expect(commit()).rejects.toThrow('Lost completion'); files.mayWrite = false;
    expect((await commit()).state).toBe('applied'); expect(files.write).toHaveBeenCalledTimes(1); expect(await versions()).toHaveLength(2);
  });
  it('fences a not-yet-attempted operation when revocation reconciliation arrives first', async () => {
    files.mayWrite = false;
    expect((await commit()).state).toBe('conflict'); files.mayWrite = true;
    expect((await commit()).state).toBe('conflict'); expect(files.write).not.toHaveBeenCalled();
    expect(await versions()).toHaveLength(0);
  });
  it('serializes two managed saves and refuses the stale second source', async () => {
    const [first, second] = await Promise.all([commit(), commit({ ...input, operationId: randomUUID(), bytes: later })]);
    expect(first.state).toBe('applied'); expect(second.state).toBe('conflict'); expect(files.write).toHaveBeenCalledTimes(1);
    expect((await pinned.read('book.xlsx')).buffer).toEqual(candidate);
  });
  async function restoreRequest() {
    const saved = await commit();
    const restore = { versionId: saved.sourceVersionId!, contentDigest: digest(original) };
    return { ...input, operationId: randomUUID(), sourceSha256: digest(candidate), bytes: original, restore };
  }
  it('conditionally restores exact bytes with immutable restore lineage and terminal replay', async () => {
    const request = await restoreRequest(), restored = await commit(request);
    expect(restored).toMatchObject({ state: 'applied', restoreFromVersionId: request.restore.versionId, targetSha256: digest(original) });
    expect((await pinned.read('book.xlsx')).buffer).toEqual(original);
    const history = await versions(); expect(history.find(version => version.id === restored.versionId)).toMatchObject({ source: 'restore', restoreFromVersionId: request.restore.versionId, parentVersionId: request.restore.versionId });
    expect(history.find(version => version.id === restored.sourceVersionId)?.contentDigest).toBe(digest(candidate));
    await pinned.write('book.xlsx', later); const writes = vi.mocked(files.write).mock.calls.length;
    expect(await commit(request)).toEqual(restored); expect(vi.mocked(files.write).mock.calls.length).toBe(writes); expect((await pinned.read('book.xlsx')).buffer).toEqual(later);
    await expect(commit({ ...request, restore: { ...request.restore, versionId: 'different-version' } })).rejects.toMatchObject({ code: 'WORKBOOK_OPERATION_CONFLICT' });
    const legacy = { ...request }; delete (legacy as Partial<typeof request>).restore;
    await expect(commit(legacy)).rejects.toMatchObject({ code: 'WORKBOOK_OPERATION_CONFLICT' });
  });
  it('keeps normal-save request hashes compatible and refuses unknown restore history before admission', async () => {
    await commit();
    const row = db.prepare('SELECT request_hash FROM workbook_writes WHERE operation_id=?').get(input.operationId) as { request_hash: string };
    expect(row.request_hash).toBe(digest(Buffer.from(JSON.stringify({ fileName: input.fileName, sourceSha256: input.sourceSha256, targetSha256: digest(input.bytes) }))));
    const unknown = { ...input, operationId: randomUUID(), sourceSha256: digest(candidate), bytes: original, restore: { versionId: 'missing', contentDigest: digest(original) } };
    await expect(commit(unknown)).rejects.toMatchObject({ code: 'WORKBOOK_RESTORE_VERSION_MISMATCH' });
    expect(db.prepare('SELECT 1 FROM workbook_writes WHERE operation_id=?').get(unknown.operationId)).toBeUndefined();
  });
  it('settles a restore after a lost write response under revoked write authority without writing again', async () => {
    const request = await restoreRequest(), actualWrite = files.write;
    files.write = vi.fn(async (bytes, expected) => { await actualWrite(bytes, expected); throw Error('Coordinator died after rename'); });
    await expect(commit(request)).rejects.toThrow('Coordinator died'); expect((await pinned.read('book.xlsx')).buffer).toEqual(original);
    files.write = vi.fn(async () => { throw Error('must not write after revocation'); }); files.mayWrite = false;
    expect(await commit(request)).toMatchObject({ state: 'applied', restoreFromVersionId: request.restore.versionId }); expect(files.write).not.toHaveBeenCalled();
  });
  it('makes revoked prewrite restore conflict terminal and refuses a stale source without clobbering it', async () => {
    const request = await restoreRequest(); files.mayWrite = false;
    expect(await commit(request)).toMatchObject({ state: 'conflict', actualSha256: digest(candidate) });
    files.mayWrite = true; expect(await commit(request)).toMatchObject({ state: 'conflict' }); expect((await pinned.read('book.xlsx')).buffer).toEqual(candidate);
    await pinned.write('book.xlsx', later);
    expect(await commit({ ...request, operationId: randomUUID() })).toMatchObject({ state: 'conflict', actualSha256: digest(later) }); expect((await pinned.read('book.xlsx')).buffer).toEqual(later);
  });

  it('refuses to resurrect a missing current workbook during restore', async () => {
    const request = await restoreRequest(); await rm(path.join(directory, 'book.xlsx')); vi.mocked(files.write).mockClear();
    expect(await commit(request)).toMatchObject({ state: 'conflict', actualSha256: null }); expect(files.write).not.toHaveBeenCalled();
    await expect(pinned.read('book.xlsx')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses exhausted retained-history capacity before replacing the working workbook', async () => {
    const seeded = await seedHistory(10_000);
    await expect(commit()).rejects.toThrow();
    expect(digest((await pinned.read('book.xlsx')).buffer)).toBe(digest(original));
    expect(files.write).not.toHaveBeenCalled(); expect(receipt()?.state).not.toBe('applied');
    expect((await readdir(seeded.root)).sort()).toEqual(['manifest.json', 'retained-9999.xlsx']);
    expect(await readFile(path.join(seeded.root, 'manifest.json'), 'utf8')).toBe(seeded.content);
  });

  it('admits the exact 9999-to-10000 target boundary and deduplicates an already-current source at capacity', async () => {
    const seeded = await seedHistory(9_999);
    const applied = await commit();
    expect(applied).toMatchObject({ state: 'applied', sourceVersionId: seeded.currentId });
    expect((await pinned.read('book.xlsx')).buffer).toEqual(candidate);
    expect(await versions()).toHaveLength(10_000);
    const same = await commit({ ...input, operationId: randomUUID(), sourceSha256: digest(candidate) });
    expect(same).toMatchObject({ state: 'applied', versionId: applied.versionId });
    expect(await versions()).toHaveLength(10_000);
    expect(files.write).toHaveBeenCalledTimes(1);
  });
  it('counts a newly retained before-source version before admitting its target', async () => {
    await seedHistory(9_999, later);
    await expect(commit()).rejects.toThrow();
    expect((await pinned.read('book.xlsx')).buffer).toEqual(original);
    expect(files.write).not.toHaveBeenCalled(); expect(receipt()?.state).toBe('pending');
    const retained = await versions(); expect(retained).toHaveLength(10_000);
    expect(retained.some(version => version.contentDigest === digest(original))).toBe(true);
  });
  it('refuses the actual prospective manifest byte bound before replacing working bytes', async () => {
    await seedHistory(1, original, true);
    await expect(commit()).rejects.toMatchObject({ code: 'EFBIG' });
    expect((await pinned.read('book.xlsx')).buffer).toEqual(original);
    expect(files.write).not.toHaveBeenCalled(); expect(receipt()?.state).not.toBe('applied');
  });

  it('publishes the exact target timestamp admitted before the working-file boundary', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000), write = files.write;
    files.write = vi.fn(async (bytes, expected) => { await write(bytes, expected); clock.mockReturnValue(1_800_000_000_000); });
    try {
      const applied = await commit();
      expect((await versions()).find(version => version.id === applied.versionId)?.createdAt).toBe(1_700_000_000_000);
    } finally { clock.mockRestore(); }
  });

});
