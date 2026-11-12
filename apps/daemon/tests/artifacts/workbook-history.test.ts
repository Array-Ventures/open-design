import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs-community';
import { ensureProject } from '../../src/projects.js';
import { createProjectFileVersion, getProjectFileVersionRootStats, listProjectFileVersions, markProjectFileVersionStoreDeleted, readProjectFileVersion, readProjectFileVersionBytes, renameProjectFileVersionStore, withProjectFileVersionBytesLock, withProjectFileVersionLock } from '../../src/project-file-versions.js';

describe('binary workbook version history', () => {
  let root: string;
  const projectId = 'workbook-history';
  beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), 'od-workbook-history-')); await ensureProject(root, projectId); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });
  async function bytes(value = 12.5) {
    const book = new ExcelJS.Workbook(); book.addWorksheet('Inputs').getCell('C5').value = value;
    return Buffer.from(await book.xlsx.writeBuffer());
  }
  const history = <T>(name: string, work: Parameters<typeof withProjectFileVersionBytesLock<T>>[4]) => withProjectFileVersionBytesLock(root, projectId, name, undefined, work);
  it('stores and reopens exact XLSX bytes with deduplication and SHA-256 metadata', async () => {
    const original = await bytes(), next = await bytes(38);
    const first = await history('nested/book.xlsx', lock => lock.ensureCurrentVersion(original, { source: 'manual', label: 'First' }));
    expect(first?.contentDigest).toBe(createHash('sha256').update(original).digest('hex'));
    const same = await history('nested/book.xlsx', lock => lock.ensureCurrentVersion(Buffer.from(original), { source: 'manual' }));
    expect(same?.id).toBe(first!.id);
    const second = await history('nested/book.xlsx', lock => lock.createVersion(next, { source: 'manual', parentVersionId: first!.id }));
    expect(second.parentVersionId).toBe(first!.id);
    const saved = await readProjectFileVersionBytes(root, projectId, 'nested/book.xlsx', first!.id);
    expect(saved.content).toEqual(original); expect(saved.version.current).toBe(false);
    const reopened = new ExcelJS.Workbook(); await reopened.xlsx.load(Uint8Array.from(saved.content).buffer);
    expect(reopened.getWorksheet('Inputs')!.getCell('C5').value).toBe(12.5);
    const versions = await listProjectFileVersions(root, projectId, 'nested/book.xlsx');
    expect(versions).toHaveLength(2); expect(versions.filter(version => version.current).map(version => version.id)).toEqual([second.id]);
  });
  it('serializes concurrent duplicate saves without creating extra versions', async () => {
    const input = await bytes();
    const versions = await Promise.all(Array.from({ length: 8 }, () => history('book.xlsx', lock => lock.ensureCurrentVersion(input, { source: 'manual' }))));
    expect(new Set(versions.map(version => version!.id)).size).toBe(1);
    expect(await listProjectFileVersions(root, projectId, 'book.xlsx')).toHaveLength(1);
  });
  it('restores an earlier binary revision with explicit lineage and exact content matching', async () => {
    const original = await bytes(), next = await bytes(38);
    const first = await history('book.xlsx', lock => lock.createVersion(original, { source: 'manual' }));
    await history('book.xlsx', lock => lock.createVersion(next, { source: 'manual', parentVersionId: first.id }));
    const restored = await history('book.xlsx', lock => lock.createVersion(original, { source: 'restore', restoreFromVersionId: first.id }));
    expect(restored).toMatchObject({ source: 'restore', restoreFromVersionId: first.id, parentVersionId: first.id, current: true });
    expect((await history('book.xlsx', lock => lock.matchVersionContent(original))).status).toBe('matched');
    expect((await history('book.xlsx', lock => lock.matchVersionContent(next))).status).toBe('digest_mismatch');
    expect((await readProjectFileVersionBytes(root, projectId, 'book.xlsx', restored.id)).content).toEqual(original);
  });
  it('preserves both source and deleted-target workbook revisions across rename', async () => {
    const target = await history('target.xlsx', lock => lock.createVersion(Buffer.from([1, 255])));
    await markProjectFileVersionStoreDeleted(root, projectId, 'target.xlsx');
    const source = await history('source.xlsx', lock => lock.createVersion(Buffer.from([2, 255])));
    await renameProjectFileVersionStore(root, projectId, 'source.xlsx', 'target.xlsx');
    const versions = await listProjectFileVersions(root, projectId, 'target.xlsx');
    expect(new Set(versions.map(version => version.id))).toEqual(new Set([source.id, target.id]));
    expect((await readProjectFileVersionBytes(root, projectId, 'target.xlsx', target.id)).content).toEqual(Buffer.from([1, 255]));
    expect(versions.find(version => version.current)?.id).toBe(source.id);
  });
  it('refuses non-workbook identities, unsafe paths and oversized binary snapshots', async () => {
    await expect(history('book.html', async () => null)).rejects.toMatchObject({ code: 'EINVAL' });
    await expect(history('../book.xlsx', async () => null)).rejects.toThrow();
    await expect(history('book.xlsx', lock => lock.createVersion(Buffer.alloc(25 * 1024 * 1024 + 1)))).rejects.toMatchObject({ code: 'EINVAL' });
    expect(await listProjectFileVersions(root, projectId, 'book.xlsx')).toEqual([]);
  });
  it('never routes workbook bytes through the text snapshot APIs', async () => {
    await expect(createProjectFileVersion(root, projectId, 'book.xlsx', 'lossy')).rejects.toMatchObject({ code: 'EINVAL' });
    await expect(withProjectFileVersionLock(root, projectId, 'book.xlsx', undefined, async () => null)).rejects.toMatchObject({ code: 'EINVAL' });
    const first = await history('book.xlsx', lock => lock.createVersion(Buffer.from([0x50, 0x4b, 0, 255, 128]), { source: 'manual' }));
    await expect(readProjectFileVersion(root, projectId, 'book.xlsx', first.id)).rejects.toMatchObject({ code: 'EINVAL' });
    expect((await readProjectFileVersionBytes(root, projectId, 'book.xlsx', first.id)).content).toEqual(Buffer.from([0x50, 0x4b, 0, 255, 128]));
  });
  it('retains deleted workbook history on recreation and can move it to another XLSX name', async () => {
    const first = await history('book.xlsx', lock => lock.createVersion(Buffer.from([0, 255]), { source: 'manual' }));
    await markProjectFileVersionStoreDeleted(root, projectId, 'book.xlsx');
    const second = await history('book.xlsx', lock => lock.ensureCurrentVersion(Buffer.from([1, 255]), { source: 'manual' }));
    expect(await listProjectFileVersions(root, projectId, 'book.xlsx')).toHaveLength(2);
    await renameProjectFileVersionStore(root, projectId, 'book.xlsx', 'nested/renamed.xlsx');
    expect(await listProjectFileVersions(root, projectId, 'book.xlsx')).toHaveLength(0);
    expect((await readProjectFileVersionBytes(root, projectId, 'nested/renamed.xlsx', first.id)).content).toEqual(Buffer.from([0, 255]));
    expect((await listProjectFileVersions(root, projectId, 'nested/renamed.xlsx')).find(version => version.current)?.id).toBe(second!.id);
  });
  it('refuses corrupted snapshot bytes without quietly replacing the current history', async () => {
    const input = await bytes(), first = await history('book.xlsx', lock => lock.createVersion(input, { source: 'manual' }));
    const info = await getProjectFileVersionRootStats(root, projectId, 'book.xlsx'), snapshot = info.entries.find(name => name.endsWith('.xlsx'))!;
    await writeFile(path.join(info.root, snapshot), Buffer.from('corrupt'));
    await expect(readProjectFileVersionBytes(root, projectId, 'book.xlsx', first.id)).rejects.toMatchObject({ code: 'EIO' });
    await expect(history('book.xlsx', lock => lock.ensureCurrentVersion(input, { source: 'manual' }))).rejects.toMatchObject({ code: 'EIO' });
    expect(await listProjectFileVersions(root, projectId, 'book.xlsx')).toHaveLength(1);
  });
  it('fails closed on malformed binary history manifests instead of resetting their entries', async () => {
    const original = await bytes();
    await history('book.xlsx', lock => lock.createVersion(original, { source: 'manual' }));
    const info = await getProjectFileVersionRootStats(root, projectId, 'book.xlsx');
    const manifest = JSON.parse(await readFile(path.join(info.root, 'manifest.json'), 'utf8'));
    manifest.entries[0].contentDigest = 'invalid';
    await writeFile(path.join(info.root, 'manifest.json'), JSON.stringify(manifest));
    await expect(listProjectFileVersions(root, projectId, 'book.xlsx')).rejects.toThrow();
    const input = await bytes();
    await expect(history('book.xlsx', lock => lock.ensureCurrentVersion(input))).rejects.toThrow();
    expect(JSON.parse(await readFile(path.join(info.root, 'manifest.json'), 'utf8')).entries).toHaveLength(1);
  });
  it('rejects linked snapshots and leaves outside bytes untouched', async () => {
    const first = await history('book.xlsx', lock => lock.createVersion(Buffer.from([0, 255])));
    const info = await getProjectFileVersionRootStats(root, projectId, 'book.xlsx'), snapshot = info.entries.find(name => name.endsWith('.xlsx'))!;
    const outside = path.join(root, 'outside.bin'); await writeFile(outside, Buffer.from([0, 255]));
    await rm(path.join(info.root, snapshot)); await symlink(outside, path.join(info.root, snapshot));
    await expect(readProjectFileVersionBytes(root, projectId, 'book.xlsx', first.id)).rejects.toThrow();
    expect(await readFile(outside)).toEqual(Buffer.from([0, 255]));
    expect((await readdir(info.root)).filter(name => name.startsWith('.studio-write-'))).toEqual([]);
  });
  it('rejects malformed UTF-8 in a history manifest rather than rewriting damaged metadata', async () => {
    await history('book.xlsx', lock => lock.createVersion(Buffer.from([0, 255])));
    const info = await getProjectFileVersionRootStats(root, projectId, 'book.xlsx'), file = path.join(info.root, 'manifest.json');
    const content = await readFile(file), index = content.indexOf('Version');
    expect(index).toBeGreaterThan(0); content[index] = 0xff; await writeFile(file, content);
    await expect(listProjectFileVersions(root, projectId, 'book.xlsx')).rejects.toThrow();
    expect(await readFile(file)).toEqual(content);
  });
});
