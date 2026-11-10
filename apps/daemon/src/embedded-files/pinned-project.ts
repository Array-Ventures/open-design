import { constants, type Stats } from 'node:fs';
import { open, mkdir, realpath, rename, unlink, link, opendir, lstat, rmdir } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

const directoryFlags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
const child = (parent: FileHandle, name: string) => `/proc/self/fd/${parent.fd}/${name}`;
const parts = (name: string) => {
  const result = name.split('/');
  if (!name || result.length > 64 || result.some((part) => !part || part === '.' || part === '..' || /[\\\0]/.test(part))) throw boundaryError();
  return result;
};
function boundaryError(): NodeJS.ErrnoException { return Object.assign(new Error('Project path is not contained in its registered directory.'), { code: 'EPATHESCAPE' }); }

async function removePinnedEntry(parent: FileHandle, name: string, recursive: boolean, remaining: { count: number }, depth = 0) {
  if (--remaining.count < 0 || depth > 64) throw new Error('Project deletion exceeds its entry or depth limit.');
  const target = child(parent, name);
  const info = await lstat(target);
  if (!info.isDirectory()) { await unlink(target); return; }
  if (!recursive) throw Object.assign(new Error('Project entry is a directory.'), { code: 'EISDIR' });
  const directory = await open(target, directoryFlags);
  try {
    for await (const entry of await opendir(`/proc/self/fd/${directory.fd}`)) await removePinnedEntry(directory, entry.name, true, remaining, depth + 1);
  } finally { await directory.close(); }
  await rmdir(target);
}

/** The caller owns the returned file descriptor. No string canonicalization
 * can redirect the final open through a swapped parent or leaf symlink. */
export async function openPinnedFile(parent: FileHandle, name: string): Promise<FileHandle> {
  if (parts(name).length !== 1) throw boundaryError();
  const file = await open(child(parent, name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.nlink !== 1) throw boundaryError();
    return file;
  } catch (error) { await file.close(); throw error; }
}
export async function readPinnedFile(parent: FileHandle, name: string, maximum = 250 * 1024 * 1024): Promise<{ buffer: Buffer; stat: Stats }> {
  const file = await openPinnedFile(parent, name);
  try {
    const info = await file.stat();
    if (info.size > maximum) throw new Error('Project file exceeds its read limit.');
    const chunks: Buffer[] = []; let size = 0;
    for (;;) {
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, maximum - size + 1));
      const result = await file.read(chunk, 0, chunk.length, null);
      if (!result.bytesRead) break;
      size += result.bytesRead;
      if (size > maximum) throw new Error('Project file exceeds its read limit.');
      chunks.push(chunk.subarray(0, result.bytesRead));
    }
    if (size !== info.size) throw new Error('Project file changed while reading.');
    return { buffer: Buffer.concat(chunks, size), stat: info };
  } finally { await file.close(); }
}

/** Rename/link affects the named entry itself; it never follows a destination
 * symlink. The temporary inode stays open through the commit and verification. */
export async function writePinnedFile(parent: FileHandle, name: string, body: string | Buffer | AsyncIterable<Uint8Array>, overwrite = true): Promise<Stats> {
  if (parts(name).length !== 1) throw boundaryError();
  const temporary = `.studio-write-${randomUUID()}`;
  const temporaryPath = child(parent, temporary); const target = child(parent, name);
  const file = await open(temporaryPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o660);
  try {
    if (typeof body === 'string' || Buffer.isBuffer(body)) await file.writeFile(body);
    else for await (const chunk of body) await file.writeFile(chunk);
    await file.sync();
    const intended = await file.stat();
    if (overwrite) await rename(temporaryPath, target);
    else { await link(temporaryPath, target); await unlink(temporaryPath); }
    await parent.sync();
    const committed = await openPinnedFile(parent, name);
    try {
      const actual = await committed.stat();
      if (actual.dev !== intended.dev || actual.ino !== intended.ino) throw new Error('Project file changed during save.');
      return actual;
    } finally { await committed.close(); }
  } finally {
    await file.close();
    await unlink(temporaryPath).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
  }
}

export class PinnedProject {
  private constructor(private readonly root: FileHandle) {}
  static async open(workspace: string, directory: string, projectId: string): Promise<PinnedProject> {
    if (process.platform !== 'linux') throw new Error('Embedded project file containment requires Linux.');
    if (!path.isAbsolute(workspace) || await realpath(workspace) !== path.normalize(workspace)) throw boundaryError();
    const relative = path.relative(workspace, directory).split(path.sep).join('/');
    if (!/^[0-9a-f-]{36}$/i.test(projectId) || !new RegExp(`^(?:bots/[0-9a-f]{64}/files|groups/[0-9a-f]{64}|team)/projects/${projectId}$`).test(relative)) throw boundaryError();
    let current = await open(workspace, directoryFlags);
    try {
      const owner = await current.stat();
      if (owner.uid !== process.getuid!() || (owner.mode & 0o077) !== 0) throw boundaryError();
      for (const part of parts(relative)) {
        const next = await open(child(current, part), directoryFlags);
        await current.close(); current = next;
      }
      return new PinnedProject(current);
    } catch (error) { await current.close(); throw error; }
  }
  async close(): Promise<void> { await this.root.close(); }
  async withParent<T>(name: string, create: boolean, work: (directory: FileHandle, leaf: string) => Promise<T>): Promise<T> {
    const components = parts(name); const leaf = components.pop()!;
    return this.withDirectory(components.join('/'), create, (directory) => work(directory, leaf));
  }
  async withDirectory<T>(name: string, create: boolean, work: (directory: FileHandle) => Promise<T>): Promise<T> {
    const components = name ? parts(name) : []; const handles: FileHandle[] = [];
    let current = this.root;
    try {
      for (const part of components) {
        if (create) await mkdir(child(current, part), { mode: 0o770 }).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw error; });
        current = await open(child(current, part), directoryFlags); handles.push(current);
      }
      return await work(current);
    } finally { for (const handle of handles.reverse()) await handle.close(); }
  }
  entries(name = '') {
    return this.withDirectory(name, false, async (directory) => {
      const entries = [];
      for await (const entry of await opendir(`/proc/self/fd/${directory.fd}`)) {
        if (entries.length >= 10_000) throw new Error('Project directory exceeds its entry limit.');
        entries.push(entry);
      }
      return entries;
    });
  }
  read(name: string, maximum?: number) { return this.withParent(name, false, (parent, leaf) => readPinnedFile(parent, leaf, maximum)); }
  openFile(name: string) { return this.withParent(name, false, openPinnedFile); }
  stat(name: string) {
    return this.withParent(name, false, async (parent, leaf) => {
      const file = await open(child(parent, leaf), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try { const info = await file.stat(); if (info.isFile() && info.nlink !== 1) throw boundaryError(); return info; }
      finally { await file.close(); }
    });
  }
  write(name: string, body: string | Buffer, overwrite = true) { return this.withParent(name, true, (parent, leaf) => writePinnedFile(parent, leaf, body, overwrite)); }
  upload(name: string, source: AsyncIterable<Uint8Array>, maximum: number) {
    async function* bounded() {
      let size = 0;
      for await (const chunk of source) {
        size += chunk.byteLength;
        if (size > maximum) throw new Error('Project upload exceeds its size limit.');
        yield chunk;
      }
    }
    return this.withParent(name, true, (parent, leaf) => writePinnedFile(parent, leaf, bounded(), false));
  }
  mkdir(name: string) { return this.withDirectory(name, true, (directory) => directory.stat()); }
  remove(name: string, recursive = false) {
    return this.withParent(name, false, (parent, leaf) => removePinnedEntry(parent, leaf, recursive, { count: 10_000 }));
  }
  renameFile(from: string, to: string) {
    return this.withParent(from, false, (sourceParent, sourceName) => this.withParent(to, true, async (targetParent, targetName) => {
      const sourceFile = await openPinnedFile(sourceParent, sourceName);
      try {
        if (from === to) return;
        const source = child(sourceParent, sourceName); const target = child(targetParent, targetName);
        const temporary = child(sourceParent, `.studio-rename-${randomUUID()}`);
        await rename(source, temporary);
        try { await link(temporary, target); }
        catch (error) {
          // Do not overwrite a new source entry another writer created while
          // this rename was in flight. The temporary preserves the old bytes.
          try { await link(temporary, source); await unlink(temporary); } catch { /* Preserve the original error and remaining bytes. */ }
          throw error;
        }
        await unlink(temporary); await sourceParent.sync(); await targetParent.sync();
        const committed = await openPinnedFile(targetParent, targetName);
        try {
          const expected = await sourceFile.stat(); const actual = await committed.stat();
          if (actual.dev !== expected.dev || actual.ino !== expected.ino) throw new Error('Project file changed during rename.');
        } finally { await committed.close(); }
      } finally { await sourceFile.close(); }
    }));
  }
}

export async function withEmbeddedProject<T>(projectId: string, metadata: Record<string, unknown>, work: (project: PinnedProject) => Promise<T>): Promise<T> {
  const workspace = process.env.OD_EMBEDDED_WORKSPACE_ROOT;
  if (!workspace || metadata.embeddedHost !== 'evebot' || typeof metadata.baseDir !== 'string') throw boundaryError();
  const project = await PinnedProject.open(workspace, metadata.baseDir, projectId);
  try { return await work(project); } finally { await project.close(); }
}
