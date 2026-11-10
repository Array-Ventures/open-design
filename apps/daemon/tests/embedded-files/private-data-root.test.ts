import { chmod, lstat, mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { secureEmbeddedDataRoot } from '../../src/embedded-files/private-data-root.js';

it('secures the owned embedded root and refuses an alias without chmodding its target', async () => {
  const scratch = await mkdtemp(path.join(tmpdir(), 'od-private-data-'));
  try {
    const root = path.join(scratch, 'state'); await mkdir(root); await chmod(root, 0o775);
    const alias = path.join(scratch, 'alias'); await symlink(root, alias);
    expect(() => secureEmbeddedDataRoot(alias)).toThrow();
    expect((await lstat(root)).mode & 0o777).toBe(0o775);
    secureEmbeddedDataRoot(root);
    expect((await lstat(root)).mode & 0o777).toBe(0o700);
    secureEmbeddedDataRoot(root);
    expect((await lstat(root)).mode & 0o777).toBe(0o700);
  } finally { await rm(scratch, { recursive: true, force: true }); }
});
