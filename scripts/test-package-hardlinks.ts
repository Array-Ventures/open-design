import assert from 'node:assert/strict';
import { chmod, link, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { detachPackageHardlinks } from './lib/package-hardlinks.js';
const roots: string[] = [];
const checks: (() => Promise<void>)[] = [];
const it = (_name: string, run: () => Promise<void>) => checks.push(run);
it('keeps stamped dependency bytes independent of later checkout and store writes', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'od-package-hardlinks-')); roots.push(root);
  const source = path.join(root, 'checkout.d.ts'), output = path.join(root, 'package');
  await mkdir(output); await writeFile(source, 'version one'); await chmod(source, 0o755);
  const first = path.join(output, 'first.d.ts'), second = path.join(output, 'second.d.ts');
  await link(source, first); await link(source, second);
  assert.equal((await lstat(first)).ino, (await lstat(source)).ino);
  assert.equal(await detachPackageHardlinks(output), 2);
  await writeFile(source, 'version two');
  assert.equal(await readFile(first, 'utf8'), 'version one'); assert.equal(await readFile(second, 'utf8'), 'version one');
  assert.equal((await lstat(first)).mode & 0o777, 0o755);
  await writeFile(first, 'independent output'); assert.equal(await readFile(second, 'utf8'), 'version one');
  assert.equal(await detachPackageHardlinks(output), 0);
  assert.deepEqual((await readdir(output)).sort(), ['first.d.ts', 'second.d.ts']);
});
it('never follows dependency symlinks into another tree', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'od-package-links-')); roots.push(root);
  const outside = path.join(root, 'outside'), output = path.join(root, 'package');
  await mkdir(outside); await mkdir(output); await writeFile(path.join(outside, 'owned'), 'source');
  await symlink(outside, path.join(output, 'dependency'), 'dir');
  assert.equal(await detachPackageHardlinks(output), 0);
  assert.equal((await lstat(path.join(output, 'dependency'))).isSymbolicLink(), true);
  await assert.rejects(detachPackageHardlinks(path.join(output, 'dependency')), /real directory/);
});

try { for (const run of checks) await run(); process.stdout.write(`Package hard-link isolation: ${checks.length} checks passed.\n`); }
finally { await Promise.all(roots.map(root => rm(root, { recursive: true, force: true }))); }
