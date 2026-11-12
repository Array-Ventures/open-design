import { constants } from 'node:fs';
import { chmod, copyFile, lstat, readdir, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

/** Deployment caches may hard-link files to a mutable checkout or package
 * store. Break those aliases before stamping an immutable package. Symlinks
 * remain untouched; the package inventory separately validates containment. */
export async function detachPackageHardlinks(directory: string): Promise<number> {
  const root = await lstat(directory);
  if (!root.isDirectory() || root.isSymbolicLink()) throw new Error('Package materialization requires a real directory.');
  let detached = 0;
  async function walk(parent: string) {
    for (const entry of await readdir(parent, { withFileTypes: true })) {
      const file = path.join(parent, entry.name), info = await lstat(file);
      if (info.isSymbolicLink()) continue;
      if (info.isDirectory()) { await walk(file); continue; }
      if (!info.isFile()) throw new Error('Package contains an unsupported filesystem entry.');
      if (info.nlink < 2) continue;
      const temporary = path.join(parent, `.package-copy-${randomUUID()}`);
      try {
        await copyFile(file, temporary, constants.COPYFILE_EXCL);
        await chmod(temporary, info.mode & 0o777);
        await rename(temporary, file);
        detached++;
      } finally { await rm(temporary, { force: true }); }
    }
  }
  await walk(directory);
  return detached;
}
