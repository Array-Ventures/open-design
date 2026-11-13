import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { captureBuildSource, assertBuildSourceUnchanged } from './lib/build-source.js';

const roots: string[] = [];
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'od-build-source-')); roots.push(root);
  const git = (...args: string[]) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: root, stdio: 'pipe' });
  git('init', '-q'); git('config', 'user.name', 'Build fixture'); git('config', 'user.email', 'build@fixture.test');
  await writeFile(path.join(root, 'source.ts'), 'export const value = 1;\n');
  await mkdir(path.join(root, 'apps/web'), { recursive: true });
  await writeFile(path.join(root, 'apps/web/next-env.d.ts'), '// initial generated path\n');
  git('add', '.'); git('commit', '-qm', 'Initial fixture');
  return { root, git };
}
try {
  {
    const { root } = await fixture(), source = await captureBuildSource(root);
    assert.equal(source.dirty, false); assert.match(source.sourceTreeSha256, /^[a-f0-9]{64}$/);
    await assertBuildSourceUnchanged(root, source);
    await writeFile(path.join(root, 'source.ts'), 'export const value = 2;\n');
    await assert.rejects(captureBuildSource(root), /clean pinned source/);
    await assert.rejects(assertBuildSourceUnchanged(root, source), /Source changed/);
  }
  {
    const { root, git } = await fixture(), source = await captureBuildSource(root);
    // A new clean HEAD must not be stamped onto an already-built older closure.
    git('commit', '--allow-empty', '-qm', 'Different clean HEAD');
    await assert.rejects(assertBuildSourceUnchanged(root, source), /Source changed/);
  }
  {
    const { root } = await fixture();
    await writeFile(path.join(root, 'untracked.ts'), 'development source');
    const source = await captureBuildSource(root, true);
    assert.equal(source.dirty, true);
    await writeFile(path.join(root, 'untracked.ts'), 'changed development source');
    await assert.rejects(assertBuildSourceUnchanged(root, source), /Source changed/);
  }
  {
    const { root, git } = await fixture();
    await symlink('source.ts', path.join(root, 'entry.ts')); git('add', '.'); git('commit', '-qm', 'Source alias');
    await assert.rejects(captureBuildSource(root), /must not contain symlinks/);
    await assert.rejects(captureBuildSource(root, true), /must not contain symlinks/);
  }
  {
    const { root } = await fixture(), source = await captureBuildSource(root);
    await rm(path.join(root, 'source.ts')); await symlink('external.ts', path.join(root, 'source.ts'));
    await assert.rejects(assertBuildSourceUnchanged(root, source), /must not contain symlinks/);
  }
  {
    const { root } = await fixture(), source = await captureBuildSource(root);
    await rename(path.join(root, 'apps/web'), path.join(root, 'apps/actual-web'));
    await symlink('actual-web', path.join(root, 'apps/web'));
    await assert.rejects(assertBuildSourceUnchanged(root, source), /must not contain symlinks/);
  }
  {
    const { root } = await fixture(), source = await captureBuildSource(root);
    await rm(path.join(root, 'apps/web/next-env.d.ts'));
    await symlink('../../source.ts', path.join(root, 'apps/web/next-env.d.ts'));
    await assert.rejects(captureBuildSource(root, true), /must not contain symlinks/);
    await assert.rejects(assertBuildSourceUnchanged(root, source), /must not contain symlinks/);
  }
  {
    const { root } = await fixture(), source = await captureBuildSource(root);
    await writeFile(path.join(root, 'apps/web/next-env.d.ts'), '// another generated path\n');
    // Builders restore this generated file before the final identity check.
    await writeFile(path.join(root, 'apps/web/next-env.d.ts'), '// initial generated path\n');
    await assertBuildSourceUnchanged(root, source);
  }
  process.stdout.write('Build-source pinning: 8 checks passed.\n');
} finally { await Promise.all(roots.map(root => rm(root, { recursive: true, force: true }))); }
