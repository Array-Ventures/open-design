import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const image = process.argv[2], context = process.argv[3];
if (!image || !/^sha256:[a-f0-9]{64}$/.test(image) || !context) throw Error('Pass an existing local image digest and its official renderer context.');
const exec = promisify(execFile), scratch = await mkdtemp(path.join(tmpdir(), 'od-raster-image-inventory-')), extracted = path.join(scratch, 'runtime');
await mkdir(extracted);
const container = `od-raster-inspect-${randomUUID()}`;
type File = { bytes: number; sha256: string };
async function inventory(root: string, relative = '', result = new Map<string, File>()): Promise<Map<string, File>> {
  const file = path.join(root, relative), info = await lstat(file);
  assert.ok(!info.isSymbolicLink(), `Runtime inventory refuses symlinks: ${relative}`);
  if (info.isDirectory()) for (const name of (await readdir(file)).sort()) await inventory(root, path.join(relative, name), result);
  else { assert.ok(info.isFile(), `Unexpected runtime entry: ${relative}`); result.set(relative, { bytes: info.size, sha256: createHash('sha256').update(await readFile(file)).digest('hex') }); }
  return result;
}
try {
  const [identity] = JSON.parse((await exec('docker', ['image', 'inspect', image])).stdout);
  assert.equal(identity.Id, image); assert.equal(identity.Os, 'linux');
  assert.ok(['arm64', 'amd64'].includes(identity.Architecture));
  const architecture = identity.Architecture === 'amd64' ? 'x64' : 'arm64';
  // Never starts the image or mounts a source, dependency, credential or data path.
  await exec('docker', ['create', '--name', container, '--label', 'od.raster-inspection=true', '--network', 'none', '--read-only', image]);
  await exec('docker', ['cp', `${container}:/opt/render/.`, extracted]);
  const expected = new Map<string, File>();
  for (const name of ['worker.mjs', 'provenance.json', 'hyperframe.runtime.iife.js', 'deck-export.iife.js', 'document-color.iife.js', 'dom-to-pptx.bundle.js', 'raster-platform', 'node_modules', 'licenses']) await inventory(path.resolve(context), name, expected);
  const actual = await inventory(extracted);
  assert.deepEqual([...actual.keys()].sort(), [...expected.keys()].sort(), 'Image must contain the exact official runtime inventory.');
  for (const [name, value] of expected) assert.deepEqual(actual.get(name), value, `Image runtime bytes differ: ${name}`);
  const provenance = JSON.parse(await readFile(path.join(extracted, 'provenance.json'), 'utf8'));
  assert.equal(provenance.dirty, false); assert.match(provenance.sourceCommit, /^[a-f0-9]{40}$/);
  assert.equal(provenance.workerSha256, actual.get('worker.mjs')!.sha256);
  assert.equal(provenance.raster.platform, `linux-${architecture}`);
  assert.equal(await readFile(path.join(extracted, 'raster-platform'), 'utf8'), `linux-${architecture}\n`);
  assert.match(provenance.raster.sharp, /^\d+\.\d+\.\d+$/);
  const addon = `node_modules/@img/sharp-linux-${architecture}/lib/sharp-linux-${architecture}-${provenance.raster.sharp}.node`;
  const vipsRoot = `node_modules/@img/sharp-libvips-linux-${architecture}`;
  const vips = JSON.parse(await readFile(path.join(extracted, vipsRoot, 'package.json'), 'utf8'));
  const binary = vips.exports['./binary']; assert.match(binary, /^\.\/lib\/libvips-cpp\.so\.[0-9.]+$/);
  const library = `${vipsRoot}/${binary.slice(2)}`;
  assert.equal(actual.get(addon)?.sha256, provenance.raster.addonSha256);
  assert.equal(actual.get(library)?.sha256, provenance.raster.libvipsSha256);
  for (const name of [addon, library]) {
    const elf = await readFile(path.join(extracted, name));
    assert.deepEqual([...elf.subarray(0, 6)], [127, 69, 76, 70, 2, 1], 'Require actual little-endian 64-bit ELF payloads.');
    assert.equal(elf.readUInt16LE(18), architecture === 'arm64' ? 183 : 62, 'ELF machine must match the actual Docker image platform.');
  }
  const report = { image, imagePlatform: `linux/${identity.Architecture}`, sourceCommit: provenance.sourceCommit, raster: provenance.raster, inventory: [...actual].map(([name, value]) => ({ path: name, ...value })) };
  await writeFile(path.join(scratch, 'report.json'), JSON.stringify(report, null, 2));
  process.stdout.write(JSON.stringify({ ok: true, scratch, image, files: actual.size, raster: provenance.raster }) + '\n');
} finally { await exec('docker', ['rm', '-f', container]).catch(() => {}); }
