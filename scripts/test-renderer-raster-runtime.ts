import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { copyRendererRasterRuntime } from './lib/renderer-raster-runtime.js';

// Actual copied runtime, not mocked package resolution. Kept in scripts so
// daemon test rootDir does not pull build-time modules into the app.
{
  const root = fileURLToPath(new URL('..', import.meta.url));
  const output = await mkdtemp(path.join(os.tmpdir(), 'od-raster-runtime-'));
  try {
    const { provenance, packages } = await copyRendererRasterRuntime(root, output);
    assert.equal(packages.length, 6);
    assert.equal(await readFile(path.join(output, 'raster-platform'), 'utf8'), `linux-${process.arch}\n`);
    const copiedRequire = createRequire(path.join(output, 'node_modules/sharp/package.json'));
    for (const name of ['@img/colour', 'detect-libc', 'semver']) assert.ok(copiedRequire.resolve(name).startsWith(output + path.sep));
    const fileHash = async (name: string) => createHash('sha256').update(await readFile(name)).digest('hex');
    assert.equal(await fileHash(path.join(output, 'node_modules/@img', `sharp-linux-${process.arch}`, 'lib', `sharp-linux-${process.arch}-${provenance.sharp}.node`)), provenance.addonSha256);
    assert.equal(await fileHash(copiedRequire.resolve(`@img/sharp-libvips-linux-${process.arch}/binary`)), provenance.libvipsSha256);
    const { default: sharp } = await import(pathToFileURL(path.join(output, 'node_modules/sharp/dist/index.mjs')).href);
    const bytes = await sharp({ create: { width: 3, height: 2, channels: 3, background: '#123456' } }).png().toBuffer();
    assert.equal((await sharp(bytes).metadata()).width, 3);
    await assert.rejects(copyRendererRasterRuntime(root, output, 'mips' as NodeJS.Architecture), /Linux arm64\/x64/);
    process.stdout.write('Raster runtime closure/provenance/architecture controls PASS\n');
  } finally { await rm(output, { recursive: true, force: true }); }
}
