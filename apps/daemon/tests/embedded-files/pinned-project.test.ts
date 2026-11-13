import { subscribeEmbeddedFiles } from '../../src/embedded-files/watcher.js';
import { chmod, mkdtemp, mkdir, writeFile, readFile, rename, rm, symlink, link } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PinnedProject, readPinnedFile, writePinnedFile } from '../../src/embedded-files/pinned-project.js';
import { readProjectFile, writeProjectFile, resolveProjectFilePath, listFiles, createProjectFolder, deleteProjectFolder, deleteProjectFile, listProjectFolders, renameProjectFile, reconcileHtmlArtifactManifest, searchProjectFiles, projectFileWriteTestHooks, projectFileRenameTestHooks } from '../../src/projects.js';
import { openProjectFileAccess, streamProjectFileAccess } from '../../src/project-file-access.js';

const id = '18a8301a-b6e1-4001-8000-c967b1eab222';
let scratch: string; let workspace: string; let directory: string; let outside: string;
beforeEach(async () => {
  scratch = await mkdtemp(path.join(tmpdir(), 'od-pinned-project-'));
  workspace = path.join(scratch, 'workspaces'); directory = path.join(workspace, 'team', 'projects', id); outside = path.join(scratch, 'outside');
  await mkdir(directory, { recursive: true }); await mkdir(outside);
  await chmod(workspace, 0o700);
  await writeFile(path.join(directory, 'index.html'), 'PROJECT_FIXTURE');
  await writeFile(path.join(outside, 'index.html'), 'OUTSIDE_CANARY_FIXTURE');
  vi.stubEnv('OD_EMBEDDED_WORKSPACE_ROOT', workspace);
});
afterEach(async () => { projectFileWriteTestHooks.afterCommit = null; projectFileRenameTestHooks.beforeCommit = null; vi.unstubAllEnvs(); await rm(scratch, { recursive: true, force: true }); });
describe('pinned registered project files', () => {
  it('bounds listing by all visited entries before descending a wide empty tree', async () => {
    await mkdir(path.join(directory, 'nested'));
    const project = await PinnedProject.open(workspace, directory, id);
    const root = await project.entries();
    const nested = root.find(entry => entry.name === 'nested')!;
    await project.close();
    const entries = vi.spyOn(PinnedProject.prototype, 'entries').mockImplementation(async prefix => {
      if (!prefix) return root;
      if (prefix === 'nested') return Array.from({ length: 10_000 }, (_, index) => Object.create(nested, {
        name: { value: `empty-${index}` },
      }) as typeof nested);
      return [];
    });
    try {
      const metadata = { embeddedHost: 'evebot', baseDir: directory };
      for (const list of [listFiles, listProjectFolders]) {
        entries.mockClear();
        await expect(list(path.join(scratch, 'daemon'), id, { metadata })).rejects.toThrow('listing entry limit');
        expect(entries.mock.calls).toEqual([[""], ["nested"]]);
      }
    } finally { entries.mockRestore(); }
  });

  it('reconciles metadata and searches only files in the registered tree', async () => {
    const metadata = { embeddedHost: 'evebot', baseDir: directory };
    const manifest = await reconcileHtmlArtifactManifest(path.join(scratch, 'daemon'), id, 'index.html', metadata);
    expect(manifest).toMatchObject({ kind: 'html', entry: 'index.html' });
    expect(JSON.parse(await readFile(path.join(directory, 'index.html.artifact.json'), 'utf8')).entry).toBe('index.html');
    await symlink(path.join(outside, 'index.html'), path.join(directory, 'outside.html'));
    expect(await searchProjectFiles(path.join(scratch, 'daemon'), id, 'OUTSIDE_CANARY', { metadata })).toEqual([]);
    expect(await searchProjectFiles(path.join(scratch, 'daemon'), id, 'PROJECT_FIXTURE', { metadata })).toContainEqual({ file: 'index.html', line: 1, snippet: 'PROJECT_FIXTURE' });
    await rename(directory, directory + '.moved'); await symlink(outside, directory);
    await expect(reconcileHtmlArtifactManifest(path.join(scratch, 'daemon'), id, 'index.html', metadata)).rejects.toThrow();
    await expect(readFile(path.join(outside, 'index.html.artifact.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('watches changes in the pinned original tree after root replacement without exposing outside filenames', async () => {
    const events: { path: string; kind: string }[] = [];
    const subscription = subscribeEmbeddedFiles(id, { embeddedHost: 'evebot', baseDir: directory }, (event) => events.push(event), 10);
    try {
      await subscription.ready;
      await rename(directory, directory + '.moved'); await symlink(outside, directory);
      await writeFile(path.join(outside, 'outside-secret-name.txt'), 'CANARY');
      await writeFile(path.join(directory + '.moved', 'new.txt'), 'VISIBLE');
      await vi.waitFor(() => expect(events).toContainEqual({ type: 'file-changed', path: 'new.txt', kind: 'add' }));
      expect(events.some((event) => event.path === 'outside-secret-name.txt')).toBe(false);
    } finally { await subscription.unsubscribe(); }
  });

  it('streams uploads into the pinned root across a root swap without overwriting names', async () => {
    const project = await PinnedProject.open(workspace, directory, id);
    async function* chunks() {
      yield Buffer.from('FIRST_');
      await rename(directory, directory + '.moved'); await symlink(outside, directory);
      yield Buffer.from('SECOND');
    }
    try {
      const result = await project.upload('uploads/new.txt', chunks(), 100);
      expect(result.size).toBe(12);
      expect(await readFile(path.join(directory + '.moved', 'uploads/new.txt'), 'utf8')).toBe('FIRST_SECOND');
      await expect(readFile(path.join(outside, 'uploads/new.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
      async function* duplicate() { yield Buffer.from('REPLACEMENT'); }
      await expect(project.upload('uploads/new.txt', duplicate(), 100)).rejects.toMatchObject({ code: 'EEXIST' });
      expect(await readFile(path.join(directory + '.moved', 'uploads/new.txt'), 'utf8')).toBe('FIRST_SECOND');
    } finally { await project.close(); }
  });
  it('removes partial upload bytes after a size limit or source stream failure', async () => {
    const project = await PinnedProject.open(workspace, directory, id);
    async function* oversized() { yield Buffer.from('TOO_LARGE'); }
    async function* failed() { yield Buffer.from('PARTIAL'); throw new Error('fixture stream failed'); }
    try {
      await expect(project.upload('uploads/large.txt', oversized(), 2)).rejects.toThrow('size limit');
      await expect(project.upload('uploads/failed.txt', failed(), 100)).rejects.toThrow('fixture stream failed');
      expect(await project.entries('uploads')).toEqual([]);
    } finally { await project.close(); }
  });

  it('renames editor files and side metadata in the original root despite a concurrent root swap', async () => {
    const metadata = { baseDir: directory, importedFrom: 'folder', embeddedHost: 'evebot' };
    await writeProjectFile(path.join(scratch, 'daemon'), id, 'index.html', '<h1>Rename safely</h1>', { artifactManifest: { kind: 'html', renderer: 'html', title: 'Rename safely', exports: ['html'] } }, metadata);
    await writeFile(path.join(outside, 'renamed.html'), 'OUTSIDE_TARGET_CANARY');
    projectFileRenameTestHooks.beforeCommit = async () => { await rename(directory, directory + '.moved'); await symlink(outside, directory); };
    const result = await renameProjectFile(path.join(scratch, 'daemon'), id, 'index.html', 'renamed.html', metadata);
    expect(result.file.name).toBe('renamed.html');
    expect(await readFile(path.join(directory + '.moved', 'renamed.html'), 'utf8')).toContain('Rename safely');
    expect(JSON.parse(await readFile(path.join(directory + '.moved', 'renamed.html.artifact.json'), 'utf8')).entry).toBe('renamed.html');
    expect(await readFile(path.join(outside, 'renamed.html'), 'utf8')).toBe('OUTSIDE_TARGET_CANARY');
    expect(await readFile(path.join(outside, 'index.html'), 'utf8')).toBe('OUTSIDE_CANARY_FIXTURE');
  });
  it('does not overwrite an existing rename target or lose the original source', async () => {
    const metadata = { baseDir: directory, importedFrom: 'folder', embeddedHost: 'evebot' };
    await writeFile(path.join(directory, 'target.html'), 'EXISTING_TARGET');
    await expect(renameProjectFile(path.join(scratch, 'daemon'), id, 'index.html', 'target.html', metadata)).rejects.toMatchObject({ code: 'EEXIST' });
    expect(await readFile(path.join(directory, 'index.html'), 'utf8')).toBe('PROJECT_FIXTURE');
    expect(await readFile(path.join(directory, 'target.html'), 'utf8')).toBe('EXISTING_TARGET');
  });
  it('creates and removes contained folders without traversing a nested outside link', async () => {
    const metadata = { baseDir: directory, importedFrom: 'folder', embeddedHost: 'evebot' };
    await createProjectFolder(path.join(scratch, 'daemon'), id, 'nested/child', metadata);
    expect((await listProjectFolders(path.join(scratch, 'daemon'), id, { metadata })).map((folder) => folder.name)).toEqual(['nested', 'nested/child']);
    await symlink(outside, path.join(directory, 'nested/outside-link'));
    await deleteProjectFolder(path.join(scratch, 'daemon'), id, 'nested', metadata);
    expect(await readFile(path.join(outside, 'index.html'), 'utf8')).toBe('OUTSIDE_CANARY_FIXTURE');
    await expect(readFile(path.join(directory, 'nested/child'))).rejects.toMatchObject({ code: 'ENOENT' });
    await deleteProjectFile(path.join(scratch, 'daemon'), id, 'index.html', metadata);
    await expect(readFile(path.join(directory, 'index.html'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('refuses folder creation and deletion after registered-root replacement', async () => {
    const metadata = { baseDir: directory, importedFrom: 'folder', embeddedHost: 'evebot' };
    await mkdir(path.join(outside, 'keep'));
    await rename(directory, directory + '.moved'); await symlink(outside, directory);
    await expect(createProjectFolder(path.join(scratch, 'daemon'), id, 'new', metadata)).rejects.toThrow();
    await expect(deleteProjectFolder(path.join(scratch, 'daemon'), id, 'keep', metadata)).rejects.toThrow();
    await expect(deleteProjectFile(path.join(scratch, 'daemon'), id, 'index.html', metadata)).rejects.toThrow();
    expect(await readFile(path.join(outside, 'index.html'), 'utf8')).toBe('OUTSIDE_CANARY_FIXTURE');
  });
  it('lists only contained visible files and refuses a replaced registered root', async () => {
    const metadata = { baseDir: directory, importedFrom: 'folder', embeddedHost: 'evebot' };
    await mkdir(path.join(directory, 'node_modules')); await writeFile(path.join(directory, 'node_modules/leak.html'), 'IGNORED_FIXTURE');
    await symlink(outside, path.join(directory, 'outside-link'));
    const listed = await listFiles(path.join(scratch, 'daemon'), id, { metadata });
    expect(listed.map((file) => file.name)).toEqual(['index.html']);
    await rename(directory, directory + '.moved'); await symlink(outside, directory);
    await expect(listFiles(path.join(scratch, 'daemon'), id, { metadata })).rejects.toThrow();
  });
  it('returns descriptor-based streaming access and refuses a later root swap', async () => {
    const metadata = { baseDir: directory, importedFrom: 'folder', embeddedHost: 'evebot' };
    const access = await resolveProjectFilePath(path.join(scratch, 'daemon'), id, 'index.html', metadata);
    expect(access.filePath).toBeUndefined();
    const file = await openProjectFileAccess(access);
    try {
      await rename(directory, directory + '.moved'); await symlink(outside, directory);
      expect((await file.readFile()).toString()).toBe('PROJECT_FIXTURE');
      await expect(openProjectFileAccess(access)).rejects.toThrow();
    } finally { await file.close(); }
  });
  it('preserves byte-range reads through the descriptor streaming carrier', async () => {
    const access = await resolveProjectFilePath(path.join(scratch, 'daemon'), id, 'index.html', { baseDir: directory, importedFrom: 'folder', embeddedHost: 'evebot' });
    const chunks: Buffer[] = [];
    for await (const chunk of await streamProjectFileAccess(access, { start: 0, end: 6 })) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString()).toBe('PROJECT');
  });
  it('protects editor writes and metadata across a root replacement after content commit', async () => {
    const metadata = { baseDir: directory, importedFrom: 'folder', embeddedHost: 'evebot' };
    projectFileWriteTestHooks.afterCommit = async () => { await rename(directory, directory + '.moved'); await symlink(outside, directory); };
    const result = await writeProjectFile(path.join(scratch, 'daemon'), id, 'index.html', '<h1>Saved safely</h1>', { artifactManifest: { kind: 'html', renderer: 'html', title: 'Saved safely', exports: ['html'] } }, metadata);
    expect(result.artifactKind).toBe('html');
    expect(await readFile(path.join(directory + '.moved', 'index.html'), 'utf8')).toContain('Saved safely');
    expect(await readFile(path.join(directory + '.moved', 'index.html.artifact.json'), 'utf8')).toContain('Saved safely');
    expect(await readFile(path.join(outside, 'index.html'), 'utf8')).toBe('OUTSIDE_CANARY_FIXTURE');
    await expect(readFile(path.join(outside, 'index.html.artifact.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('retains the real regression guard when editor writes use pinned files', async () => {
    vi.stubEnv('OD_ARTIFACT_STUB_GUARD', 'reject'); vi.stubEnv('OD_ARTIFACT_STUB_GUARD_MIN_PRIOR_BYTES', '1024');
    const metadata = { baseDir: directory, importedFrom: 'folder', embeddedHost: 'evebot' };
    const manifest = { kind: 'html', renderer: 'html', title: 'Dashboard', exports: ['html'], metadata: { identifier: 'dashboard' } };
    await writeProjectFile(path.join(scratch, 'daemon'), id, 'dashboard.html', `<!doctype html><h1>${'x'.repeat(10_000)}</h1>`, { artifactManifest: manifest }, metadata);
    await expect(writeProjectFile(path.join(scratch, 'daemon'), id, 'dashboard-2.html', '<h1>Stub</h1>', { artifactManifest: manifest }, metadata)).rejects.toMatchObject({ code: 'ARTIFACT_REGRESSION' });
    await expect(readFile(path.join(directory, 'dashboard-2.html'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('preserves development-entry classification while reading its configuration safely', async () => {
    await writeFile(path.join(directory, 'index.html'), '<script type="module" src="/src/main.tsx"></script>');
    await writeFile(path.join(directory, 'vite.config.ts'), 'export default {}');
    const result = await readProjectFile(path.join(scratch, 'daemon'), id, 'index.html', { baseDir: directory, importedFrom: 'folder', embeddedHost: 'evebot' });
    expect(result.artifactManifest).toBeNull();
  });
  it('rejects a replaced root through the real project-file helper', async () => {
    await rename(directory, directory + '.moved'); await symlink(outside, directory);
    await expect(readProjectFile(path.join(scratch, 'daemon'), id, 'index.html', { baseDir: directory, importedFrom: 'folder', embeddedHost: 'evebot' })).rejects.toThrow();
    expect(await readFile(path.join(outside, 'index.html'), 'utf8')).toBe('OUTSIDE_CANARY_FIXTURE');
  });
  it('retains the original root inode when its path is replaced during an operation', async () => {
    const project = await PinnedProject.open(workspace, directory, id);
    try {
      await rename(directory, directory + '.moved'); await symlink(outside, directory);
      expect((await project.read('index.html')).buffer.toString()).toBe('PROJECT_FIXTURE');
      await project.write('saved.html', 'SAFE_SAVE');
      expect(await readFile(path.join(directory + '.moved', 'saved.html'), 'utf8')).toBe('SAFE_SAVE');
      await expect(readFile(path.join(outside, 'saved.html'))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally { await project.close(); }
  });
  it('pins an intermediate directory across a concurrent parent swap for reads and writes', async () => {
    const nested = path.join(directory, 'nested'); await mkdir(nested); await writeFile(path.join(nested, 'index.html'), 'NESTED_FIXTURE');
    const project = await PinnedProject.open(workspace, directory, id);
    try {
      await project.withParent('nested/index.html', false, async (parent, leaf) => {
        await rename(nested, nested + '.moved'); await symlink(outside, nested);
        expect((await readPinnedFile(parent, leaf)).buffer.toString()).toBe('NESTED_FIXTURE');
        await writePinnedFile(parent, 'saved.html', 'SAFE_NESTED_SAVE');
      });
      expect(await readFile(path.join(nested + '.moved', 'saved.html'), 'utf8')).toBe('SAFE_NESTED_SAVE');
      await expect(readFile(path.join(outside, 'saved.html'))).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(project.read('nested/index.html')).rejects.toThrow();
    } finally { await project.close(); }
  });
  it('refuses leaf symlinks and hard links, and atomically replaces rather than following a destination symlink', async () => {
    const project = await PinnedProject.open(workspace, directory, id);
    try {
      await symlink(path.join(outside, 'index.html'), path.join(directory, 'alias.html'));
      await expect(project.read('alias.html')).rejects.toThrow();
      await project.write('alias.html', 'REPLACED_ENTRY');
      expect((await project.read('alias.html')).buffer.toString()).toBe('REPLACED_ENTRY');
      expect(await readFile(path.join(outside, 'index.html'), 'utf8')).toBe('OUTSIDE_CANARY_FIXTURE');
      await link(path.join(directory, 'index.html'), path.join(directory, 'hard.html'));
      await expect(project.read('hard.html')).rejects.toMatchObject({ code: 'EPATHESCAPE' });
      await expect(project.write('alias.html', 'DO_NOT_OVERWRITE', false)).rejects.toMatchObject({ code: 'EEXIST' });
      expect((await project.read('alias.html')).buffer.toString()).toBe('REPLACED_ENTRY');
    } finally { await project.close(); }
  });
});
