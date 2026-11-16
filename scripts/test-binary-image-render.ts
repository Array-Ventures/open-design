import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyRendererRasterRuntime } from './lib/renderer-raster-runtime.js';

const root = fileURLToPath(new URL('..', import.meta.url)), image = process.argv[2];
if (!image || !/^sha256:[a-f0-9]{64}$/.test(image)) throw new Error('Pass an existing local renderer image digest.');
const baseline = process.argv.includes('--baseline'), immutable = process.argv.includes('--immutable'), exec = promisify(execFile);
if (baseline && immutable) throw new Error('Choose baseline or immutable qualification, not both.');
const require = createRequire(path.join(root, 'apps/daemon/package.json'));
const sharp = (await import(require.resolve('sharp'))).default;
const scratch = await mkdtemp(path.join(tmpdir(), 'od-binary-image-render-')), runtime = path.join(scratch, 'runtime'), source = path.join(scratch, 'source');
await mkdir(runtime); await mkdir(source);
const actor = userInfo(), receipts: object[] = [];
const hash = (value: Buffer) => createHash('sha256').update(value).digest('hex');
const pixels = Buffer.from([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 255, 255, 255, 255, 0]);
const png = await sharp(pixels, { raw: { width: 2, height: 2, channels: 4 } }).png().toBuffer();
await writeFile(path.join(source, 'picture.png'), png);
let raster: Awaited<ReturnType<typeof copyRendererRasterRuntime>> | undefined;
if (!baseline && !immutable) {
  raster = await copyRendererRasterRuntime(root, runtime);
  await exec('corepack', ['pnpm', '--filter', '@open-design/daemon', 'exec', 'esbuild', 'src/embedded-render/main.ts', '--bundle', '--platform=node', '--format=esm', '--target=node24', '--external:playwright-core', '--external:sharp', '--banner:js=import {createRequire as __createRequire} from "node:module"; const require=__createRequire(import.meta.url);', `--outfile=${path.join(runtime, 'worker.mjs')}`], { cwd: root });
}
async function run(name: string, fileName: string, imageFormat = 'png', ok = true, format = 'image') {
  const container = `od-image-test-${randomUUID()}`, directory = path.join(scratch, name), output = path.join(directory, 'output'), job = path.join(directory, 'job');
  await mkdir(output, { recursive: true }); await mkdir(job);
  await writeFile(path.join(job, 'input.json'), JSON.stringify({ fileName, format, imageFormat }));
  const mounts = ['--mount', `type=bind,src=${source},dst=/source,readonly`, '--mount', `type=bind,src=${output},dst=/output`, '--mount', `type=bind,src=${job},dst=/job,readonly`];
  if (raster) {
    mounts.push('--mount', `type=bind,src=${runtime}/worker.mjs,dst=/opt/render/worker.mjs,readonly`);
    for (const name of ['sharp', '@img/colour', 'detect-libc', 'semver', `@img/sharp-linux-${process.arch}`, `@img/sharp-libvips-linux-${process.arch}`]) mounts.push('--mount', `type=bind,src=${runtime}/node_modules/${name},dst=/opt/render/node_modules/${name},readonly`);
  }
  try {
    let status = 0;
    try { await exec('docker', ['run', '--pull', 'never', '--name', container, '--label', 'od.binary-image-test=true', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--pids-limit', '256', '--memory', '1g', '--cpus', '1', '--tmpfs', '/tmp:rw,nosuid,nodev,size=256m', '--user', `${actor.uid}:${actor.gid}`, ...mounts, image!], { timeout: 45_000, maxBuffer: 128 * 1024 }); }
    catch (error) { status = Number((error as { code?: unknown }).code) || 1; if (ok) throw error; }
    const result = JSON.parse(await readFile(path.join(output, 'result.json'), 'utf8')) as { ok: boolean; file?: string; error?: string };
    receipts.push({ name, status, result }); assert.equal(result.ok, ok);
    return result.file ? await readFile(path.join(output, result.file)) : Buffer.alloc(0);
  } finally { await exec('docker', ['rm', '-f', container]).catch(() => {}); }
}
try {
  const converted = await run('png-intrinsic', 'picture.png');
  const decoded = await sharp(converted).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.deepEqual([decoded.info.width, decoded.info.height], [2, 2]); assert.deepEqual(decoded.data, pixels);
  assert.deepEqual(await readFile(path.join(source, 'picture.png')), png);
  if (!baseline) {
    const oriented = await sharp(pixels, { raw: { width: 2, height: 2, channels: 4 } }).resize(2, 3, { fit: 'fill' }).jpeg({ quality: 100 }).withMetadata({ orientation: 6 }).toBuffer();
    assert.equal((await sharp(oriented).metadata()).orientation, 6);
    await writeFile(path.join(source, 'oriented.jpg'), oriented);
    const actual = await run('jpeg-orientation', 'oriented.jpg');
    assert.deepEqual(await sharp(actual).raw().toBuffer(), await sharp(oriented).autoOrient().raw().toBuffer());
    assert.deepEqual([(await sharp(actual).metadata()).width, (await sharp(actual).metadata()).height], [3, 2]);
    const profiled = await sharp(png).withIccProfile('p3').webp({ lossless: true }).toBuffer();
    await writeFile(path.join(source, 'profile.webp'), profiled);
    const profileResult = await run('webp-icc', 'profile.webp');
    assert.deepEqual((await sharp(profileResult).metadata()).icc, (await sharp(profiled).metadata()).icc);
    const transparent = await sharp({ create: { width: 3, height: 2, channels: 4, background: '#ff000000' } }).png().toBuffer();
    await writeFile(path.join(source, 'transparent.png'), transparent);
    const jpeg = await run('white-jpeg', 'transparent.png', 'jpeg');
    assert.ok([...(await sharp(jpeg).raw().toBuffer())].every(value => value === 255));
    await writeFile(path.join(source, 'fake.png'), '<svg><image href="https://outside.invalid/secret"/></svg>');
    await run('fake-png-refused', 'fake.png', 'png', false);
    await writeFile(path.join(source, 'remote.svg'), '<svg><image href="https://outside.invalid/secret"/></svg>');
    await run('svg-refused', 'remote.svg', 'png', false);
    const animated = await sharp(Buffer.from([...Array(4).fill([255, 0, 0]).flat(), ...Array(4).fill([0, 0, 255]).flat()]), { raw: { width: 2, height: 4, pageHeight: 2, channels: 3 } }).webp({ delay: [100, 100] }).toBuffer();
    assert.equal((await sharp(animated, { animated: true }).metadata()).pages, 2);
    await writeFile(path.join(source, 'animation.webp'), animated); await run('animation-refused', 'animation.webp', 'png', false);
  }
  if (immutable) {
    await writeFile(path.join(source, 'ordinary.html'), '<!doctype html><html><head><title>Ordinary HTML startup</title></head><body><h1>Ordinary HTML startup</h1></body></html>');
    const capture = await run('ordinary-html-capture', 'ordinary.html');
    const dimensions = await sharp(capture).metadata(); assert.deepEqual([dimensions.width, dimensions.height], [1440, 900]);
    const pdf = await run('ordinary-pdf', 'ordinary.html', 'png', true, 'pdf'); assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    const text = (await exec('/usr/bin/pdftotext', [path.join(scratch, 'ordinary-pdf/output/artifact.pdf'), '-'])).stdout; assert.match(text, /Ordinary HTML startup/);
    const html = await run('ordinary-html-export', 'ordinary.html', 'png', true, 'html'); assert.match(html.toString(), /<h1>Ordinary HTML startup<\/h1>/);
  }
  process.stdout.write(JSON.stringify({ ok: true, scratch, cases: receipts.length, baseline, immutable }) + '\n');
} finally {
  await writeFile(path.join(scratch, 'receipt.json'), JSON.stringify({ baseline, immutable, sourceCommit: (await exec('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim(), sourceDirty: Boolean((await exec('git', ['status', '--porcelain'], { cwd: root })).stdout.trim()), image, sourceSha256: hash(png), raster: raster?.provenance, receipts }, null, 2));
  process.stdout.write(`Retained image conversion evidence: ${scratch}\n`);
}
