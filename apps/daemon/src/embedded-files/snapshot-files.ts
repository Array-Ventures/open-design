import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';

export type SnapshotFile = { bytes: number; sha256: string };
export type SnapshotLimits = { files: number; bytes: number };
export const defaultSnapshotLimits: SnapshotLimits = { files: 100_000, bytes: 5 * 1024 ** 3 };

export async function ownedDirectory(directory: string, privateOnly = false) {
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid?.() || (info.mode & (privateOnly ? 0o077 : 0o002)) || await realpath(directory) !== path.resolve(directory)) throw new Error('Studio snapshot requires owned canonical directories with safe permissions.');
}
export async function syncSnapshotPath(file: string) {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { await handle.sync(); } finally { await handle.close(); }
}

/** Only for quiesced companion-owned storage; never follows links or archives
 * arbitrary workspace paths. Streams bounded chunks and checks for mutation. */
export async function snapshotFiles(source: string, destination?: string, limits = defaultSnapshotLimits, omit = new Set<string>()): Promise<Record<string, SnapshotFile>> {
  await ownedDirectory(source);
  const files: Record<string, SnapshotFile> = Object.create(null);
  let total = 0; let count = 0;
  async function walk(directory: string, relative: string) {
    await ownedDirectory(directory);
    for (const name of (await readdir(directory)).sort()) {
      const key = relative ? `${relative}/${name}` : name;
      if (omit.has(key)) continue;
      if (++count > limits.files) throw new Error('Studio snapshot file limit exceeded.');
      if (name === '.' || name === '..' || /[\\/\0]/.test(name)) throw new Error('Invalid snapshot file name.');
      const file = path.join(directory, name);
      const info = await lstat(file);
      if (info.isDirectory() && !info.isSymbolicLink()) {
        if (destination) await mkdir(path.join(destination, key), { mode: 0o700 });
        await walk(file, key);
        if (destination) await syncSnapshotPath(path.join(destination, key));
        continue;
      }
      if (!info.isFile() || info.nlink !== 1 || info.uid !== process.getuid?.() || (info.mode & 0o002)) throw new Error('Studio snapshot refuses links, special files and unowned/writable files.');
      const input = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
      let output: Awaited<ReturnType<typeof open>> | undefined;
      try {
        const before = await input.stat();
        if (before.ino !== info.ino || before.dev !== info.dev || !before.isFile() || before.nlink !== 1) throw new Error('Studio snapshot source changed.');
        if (destination) output = await open(path.join(destination, key), 'wx', 0o600);
        const hash = createHash('sha256'); const buffer = Buffer.alloc(64 * 1024); let bytes = 0;
        while (true) {
          const { bytesRead } = await input.read(buffer, 0, buffer.length, null);
          if (!bytesRead) break;
          bytes += bytesRead; total += bytesRead;
          if (total > limits.bytes) throw new Error('Studio snapshot byte limit exceeded.');
          const chunk = buffer.subarray(0, bytesRead); hash.update(chunk);
          if (output) await output.writeFile(chunk);
        }
        const after = await input.stat();
        if (bytes !== before.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || before.size !== after.size || after.nlink !== 1) throw new Error('Studio snapshot source changed.');
        if (output) await output.sync();
        files[key] = { bytes, sha256: hash.digest('hex') };
      } finally { await output?.close(); await input.close(); }
    }
  }
  await walk(source, '');
  return files;
}
