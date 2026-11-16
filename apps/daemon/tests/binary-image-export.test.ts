import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

// The real raster decoder/encoder runs. A binary source must never fall through
// to authored HTML, a browser page, or media subprocess interpretation.
vi.mock('playwright-core', () => ({ chromium: { launch: () => { throw new Error('Unexpected HTML renderer'); } } }));
import { renderSnapshot } from '../src/embedded-render/runner.js';

let directory: string, source: string, output: string;
function pngChunk(type: string, data: Buffer) {
  const chunk = Buffer.alloc(data.length + 12); chunk.writeUInt32BE(data.length); chunk.write(type, 4); data.copy(chunk, 8);
  let crc = 0xffffffff;
  for (const byte of chunk.subarray(4, -4)) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, chunk.length - 4); return chunk;
}
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'od-binary-image-'));
  source = path.join(directory, 'source'); output = path.join(directory, 'output');
  await mkdir(source); await mkdir(output);
});

it.each(['png', 'jpeg', 'webp'] as const)('decodes real %s content and keeps its ICC profile in PNG', async format => {
  const bytes = await sharp({ create: { width: 7, height: 5, channels: 3, background: '#4c8cbd' } }).withIccProfile('p3').toFormat(format).toBuffer();
  const before = await sharp(bytes).metadata();
  expect(before.icc?.length).toBeGreaterThan(100);
  await writeFile(path.join(source, `photo.${format}`), bytes);
  const result = await renderSnapshot(source, output, { fileName: `photo.${format}`, format: 'image' });
  const converted = await readFile(path.join(output, result.file));
  const after = await sharp(converted).metadata();
  expect([after.width, after.height, after.icc]).toEqual([7, 5, before.icc]);
  const originalPixels = await sharp(bytes).toColourspace('srgb').raw().toBuffer();
  const convertedPixels = await sharp(converted).toColourspace('srgb').raw().toBuffer();
  expect(Math.max(...originalPixels.map((value, index) => Math.abs(value - convertedPixels[index]!)))).toBeLessThanOrEqual(1);
  expect(await readFile(path.join(source, `photo.${format}`))).toEqual(bytes);
});

it.each([2, 3, 4, 5, 6, 7, 8])('applies actual JPEG EXIF orientation %s before dropping camera metadata', async orientation => {
  const bytes = await sharp(Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0, 255, 0, 255, 0, 255, 255]), { raw: { width: 2, height: 3, channels: 3 } }).jpeg({ quality: 100, chromaSubsampling: '4:4:4' }).withMetadata({ orientation }).toBuffer();
  expect((await sharp(bytes).metadata()).orientation).toBe(orientation);
  await writeFile(path.join(source, 'oriented.jpg'), bytes);
  const result = await renderSnapshot(source, output, { fileName: 'oriented.jpg', format: 'image' });
  const converted = await readFile(path.join(output, result.file));
  const metadata = await sharp(converted).metadata();
  expect([metadata.width, metadata.height]).toEqual(orientation >= 5 ? [3, 2] : [2, 3]);
  expect(metadata.orientation).toBeUndefined(); expect(metadata.exif).toBeUndefined();
  expect(await sharp(converted).raw().toBuffer()).toEqual(await sharp(bytes).autoOrient().raw().toBuffer());
});

it('flattens transparency to white explicitly for JPEG without resizing', async () => {
  const bytes = await sharp({ create: { width: 9, height: 7, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
  await writeFile(path.join(source, 'transparent.png'), bytes);
  const result = await renderSnapshot(source, output, { fileName: 'transparent.png', format: 'image', imageFormat: 'jpeg' });
  expect(result).toMatchObject({ file: 'artifact.jpg', mime: 'image/jpeg' });
  const actual = await sharp(await readFile(path.join(output, result.file))).raw().toBuffer({ resolveWithObject: true });
  expect([actual.info.width, actual.info.height, actual.info.channels]).toEqual([9, 7, 3]);
  expect([...actual.data].every(value => value === 255)).toBe(true);
});

it('retains a real ICC profile when producing lossy JPEG', async () => {
  const bytes = await sharp({ create: { width: 7, height: 5, channels: 3, background: '#4488aa' } }).withIccProfile('p3').png().toBuffer();
  await writeFile(path.join(source, 'profile.png'), bytes);
  const result = await renderSnapshot(source, output, { fileName: 'profile.png', format: 'image', imageFormat: 'jpeg' });
  const converted = await readFile(path.join(output, result.file));
  expect((await sharp(converted).metadata()).icc).toEqual((await sharp(bytes).metadata()).icc);
  const before = await sharp(bytes).toColourspace('srgb').raw().toBuffer(), after = await sharp(converted).toColourspace('srgb').raw().toBuffer();
  expect(Math.max(...before.map((value, index) => Math.abs(value - after[index]!)))).toBeLessThanOrEqual(3);
});

it.each(['cmyk', 'rgb16'] as const)('refuses actual %s samples outside the bounded RGB8 contract', async space => {
  const pipeline = sharp({ create: { width: 2, height: 2, channels: 3, background: '#4488aa' } }).toColourspace(space);
  const fileName = space === 'cmyk' ? 'cmyk.jpg' : 'depth.png', bytes = await (space === 'cmyk' ? pipeline.jpeg() : pipeline.png()).toBuffer();
  expect((await sharp(bytes).metadata()).space).toBe(space);
  await writeFile(path.join(source, fileName), bytes);
  await expect(renderSnapshot(source, output, { fileName, format: 'image' })).rejects.toThrow(/8-bit RGB/);
});

it('refuses a real over-wide source even below the total pixel budget', async () => {
  const bytes = await sharp({ create: { width: 8193, height: 1, channels: 3, background: '#fff' } }).png().toBuffer();
  await writeFile(path.join(source, 'wide.png'), bytes);
  await expect(renderSnapshot(source, output, { fileName: 'wide.png', format: 'image' })).rejects.toThrow(/8192/);
});

it.each(['svg', 'gif', 'avif'])('refuses unsupported %s rather than rasterizing scripts or silently taking a frame', async extension => {
  await writeFile(path.join(source, `input.${extension}`), '<svg onload="fetch(\'https://outside.invalid\')"/>');
  await expect(renderSnapshot(source, output, { fileName: `input.${extension}`, format: 'image' })).rejects.toThrow(/supports static/);
});

it.each(['png', 'jpeg', 'webp'])('refuses remote/HTML/polyglot bytes behind %s before any HTML renderer', async extension => {
  await writeFile(path.join(source, `input.${extension}`), '<html><script>fetch("https://outside.invalid")</script></html>');
  await expect(renderSnapshot(source, output, { fileName: `input.${extension}`, format: 'image' })).rejects.toThrow(/complete static/);
});

it('refuses actual animated WebP instead of exporting its first frame', async () => {
  const bytes = await sharp(Buffer.from([...Array(4).fill([255, 0, 0]).flat(), ...Array(4).fill([0, 0, 255]).flat()]), { raw: { width: 2, height: 4, pageHeight: 2, channels: 3 } }).webp({ loop: 0, delay: [100, 100] }).toBuffer();
  expect((await sharp(bytes, { animated: true }).metadata()).pages).toBe(2);
  await writeFile(path.join(source, 'animated.webp'), bytes);
  await expect(renderSnapshot(source, output, { fileName: 'animated.webp', format: 'image' })).rejects.toThrow(/Animation/);
});

it('refuses an APNG animation control chunk even when a PNG decoder exposes only the first frame', async () => {
  const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#f00' } }).png().toBuffer();
  const control = Buffer.alloc(8); control.writeUInt32BE(2); const chunk = pngChunk('acTL', control);
  await writeFile(path.join(source, 'animated.png'), Buffer.concat([png.subarray(0, 33), chunk, png.subarray(33)]));
  await expect(renderSnapshot(source, output, { fileName: 'animated.png', format: 'image' })).rejects.toThrow(/Animation/);
});

it('refuses non-sRGB PNG gamma without an ICC profile instead of silently dropping its colour interpretation', async () => {
  const png = await sharp({ create: { width: 3, height: 2, channels: 3, background: '#4488aa' } }).png().toBuffer();
  const gamma = Buffer.alloc(4); gamma.writeUInt32BE(80000);
  const bytes = Buffer.concat([png.subarray(0, 33), pngChunk('gAMA', gamma), png.subarray(33)]);
  expect((await sharp(bytes).metadata()).width).toBe(3);
  await writeFile(path.join(source, 'gamma.png'), bytes);
  await expect(renderSnapshot(source, output, { fileName: 'gamma.png', format: 'image' })).rejects.toThrow(/requires a supported ICC/);
  expect(await readFile(path.join(source, 'gamma.png'))).toEqual(bytes);
});

it.each(['png', 'jpeg', 'webp'] as const)('refuses truncated, concatenated and incorrectly named real %s containers', async format => {
  const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#00f' } }).toFormat(format).toBuffer();
  for (const invalid of [bytes.subarray(0, bytes.length - 3), Buffer.concat([bytes, bytes])]) {
    await writeFile(path.join(source, `input.${format}`), invalid);
    await expect(renderSnapshot(source, output, { fileName: `input.${format}`, format: 'image' })).rejects.toThrow();
  }
  const fileName = format === 'png' ? 'wrong.webp' : 'wrong.png'; await writeFile(path.join(source, fileName), bytes);
  await expect(renderSnapshot(source, output, { fileName, format: 'image' })).rejects.toThrow(/complete static/);
});

it('refuses a genuine over-pixel image before decoding its pixels', async () => {
  const bytes = await sharp({ create: { width: 4097, height: 4096, channels: 3, background: '#fff' } }).png().toBuffer();
  await writeFile(path.join(source, 'large.png'), bytes);
  await expect(renderSnapshot(source, output, { fileName: 'large.png', format: 'image' })).rejects.toThrow(/pixel limit/);
});

it('refuses oversized source bytes and source escapes; never overwrites a prior result', async () => {
  await writeFile(path.join(source, 'large.png'), ''); await truncate(path.join(source, 'large.png'), 50 * 1024 * 1024 + 1);
  await expect(renderSnapshot(source, output, { fileName: 'large.png', format: 'image' })).rejects.toThrow(/50 MiB/);
  const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#fff' } }).png().toBuffer();
  await writeFile(path.join(directory, 'outside.png'), bytes); await symlink(path.join(directory, 'outside.png'), path.join(source, 'escape.png'));
  await expect(renderSnapshot(source, output, { fileName: 'escape.png', format: 'image' })).rejects.toThrow(/outside/);
  await writeFile(path.join(source, 'ok.png'), bytes); await writeFile(path.join(output, 'artifact.png'), 'prior');
  await expect(renderSnapshot(source, output, { fileName: 'ok.png', format: 'image' })).rejects.toThrow(/EEXIST/);
  expect(await readFile(path.join(output, 'artifact.png'), 'utf8')).toBe('prior');
});

it.each([{ deck: true }, { width: 320 }, { height: 240 }, { index: 0 }, { dataFile: 'data.json' }, { format: 'html' }, { format: 'pdf' }])('refuses template/capture options for a binary image: %j', async options => {
  await expect(renderSnapshot(source, output, { fileName: 'image.png', format: 'image', ...options })).rejects.toThrow(/Binary images/);
});
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

it('converts a real binary PNG before HTML decoding, preserving intrinsic pixels and original bytes', async () => {
  const pixels = Buffer.from([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 255, 255, 255, 255, 0]);
  const bytes = await sharp(pixels, { raw: { width: 2, height: 2, channels: 4 } }).png().toBuffer();
  await writeFile(path.join(source, 'picture.png'), bytes);
  const result = await renderSnapshot(source, output, { fileName: 'picture.png', format: 'image' });
  expect(result).toMatchObject({ file: 'artifact.png', mime: 'image/png' });
  const actual = await sharp(await readFile(path.join(output, result.file))).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  expect([actual.info.width, actual.info.height]).toEqual([2, 2]); expect(actual.data).toEqual(pixels);
  expect(await readFile(path.join(source, 'picture.png'))).toEqual(bytes);
});
