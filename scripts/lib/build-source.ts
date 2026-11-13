import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';

export interface BuildSourceIdentity { sourceCommit: string; sourceTreeSha256: string; dirty: boolean }
const git = (root: string, ...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

/** Pin authored source, including admitted development-only untracked files.
 * Next's generated type reference is not runtime input and changes per dist dir. */
export async function captureBuildSource(root: string, allowDirty = false): Promise<BuildSourceIdentity> {
  const sourceCommit = git(root, 'rev-parse', 'HEAD');
  const dirty = git(root, 'status', '--porcelain').length > 0;
  if (dirty && !allowDirty) throw new Error('Production packages require clean pinned source.');
  const hash = createHash('sha256');
  const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean).sort();
  const checkedDirectories = new Set<string>();
  for (const name of files) {
    // Checking the leaf alone would still follow a substituted parent directory.
    const segments = name.split('/');
    for (let index = 1; index < segments.length; index++) {
      const directory = segments.slice(0, index).join('/');
      if (checkedDirectories.has(directory)) continue;
      try {
        if ((await lstat(path.join(root, directory))).isSymbolicLink()) throw new Error('Authored build source must not contain symlinks.');
        checkedDirectories.add(directory);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') break;
        throw error;
      }
    }
    const file = path.join(root, name);
    try {
      const info = await lstat(file);
      if (info.isSymbolicLink()) throw new Error('Authored build source must not contain symlinks.');
      if (name === 'apps/web/next-env.d.ts') continue;
      hash.update(name + '\0');
      hash.update(await readFile(file));
      hash.update('\0');
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  return { sourceCommit, sourceTreeSha256: hash.digest('hex'), dirty };
}

export async function assertBuildSourceUnchanged(root: string, expected: BuildSourceIdentity): Promise<void> {
  const actual = await captureBuildSource(root, true);
  if (actual.sourceCommit !== expected.sourceCommit || actual.sourceTreeSha256 !== expected.sourceTreeSha256 || actual.dirty !== expected.dirty) {
    throw new Error('Source changed during the package build. Build again from stable pinned source.');
  }
}
