import { imageInputFormat } from '@open-design/contracts';
import { readFile, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const maximumBytes = 50 * 1024 * 1024;
const maximumPixels = 16 * 1024 * 1024;
const maximumOutputBytes = 65 * 1024 * 1024;

/** Admit only a single raster container before opening any decoder. In
 * particular libspng can decode an APNG's first frame without reporting pages. */
function checkedContainer(bytes: Buffer, expected: 'png' | 'jpeg' | 'webp') {
  let requiresIcc = false;
  const invalid = () => { throw new Error('Choose a complete static PNG, JPEG or WebP image. Animation and mixed image containers are not supported.'); };
  if (expected === 'png') {
    if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) invalid();
    let offset = 8, chunks = 0;
    while (offset + 12 <= bytes.length && ++chunks <= 4096) {
      const size = bytes.readUInt32BE(offset), type = bytes.toString('ascii', offset + 4, offset + 8);
      if (offset + size + 12 > bytes.length || chunks === 1 && (type !== 'IHDR' || size !== 13) || ['acTL', 'fcTL', 'fdAT'].includes(type)) invalid();
      if (['cICP', 'mDCV', 'cLLI'].includes(type)) throw new Error('HDR PNG colour metadata requires separate conversion qualification.');
      if (type === 'gAMA') {
        if (size !== 4) invalid();
        requiresIcc ||= bytes.readUInt32BE(offset + 8) !== 45455;
      }
      if (type === 'cHRM') {
        if (size !== 32) invalid();
        const srgb = [31270, 32900, 64000, 33000, 30000, 60000, 15000, 6000];
        requiresIcc ||= srgb.some((value, index) => bytes.readUInt32BE(offset + 8 + index * 4) !== value);
      }
      offset += size + 12;
      if (type === 'IEND') { if (size !== 0 || offset !== bytes.length) invalid(); return requiresIcc; }
    }
    invalid();
  } else if (expected === 'webp') {
    if (bytes.length < 20 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP' || bytes.readUInt32LE(4) !== bytes.length - 8) invalid();
    let offset = 12, chunks = 0, images = 0;
    while (offset + 8 <= bytes.length && ++chunks <= 4096) {
      const type = bytes.toString('ascii', offset, offset + 4), size = bytes.readUInt32LE(offset + 4);
      if (offset + 8 + size > bytes.length || ['ANIM', 'ANMF'].includes(type) || type === 'VP8X' && (size !== 10 || Boolean(bytes[offset + 8]! & 2))) invalid();
      if (type === 'VP8 ' || type === 'VP8L') images++;
      offset += 8 + size + (size % 2);
    }
    if (offset !== bytes.length || images !== 1) invalid();
  } else {
    if (bytes[0] !== 255 || bytes[1] !== 216) invalid();
    let offset = 2, markers = 0;
    while (offset < bytes.length && ++markers <= 100_000) {
      if (bytes[offset++] !== 255) invalid();
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 217) { if (offset !== bytes.length) invalid(); return false; }
      if (marker === undefined || marker === 0 || marker === 216 || marker >= 208 && marker <= 215 || offset + 2 > bytes.length) invalid();
      const size = bytes.readUInt16BE(offset);
      if (size < 2 || offset + size > bytes.length) invalid();
      offset += size;
      if (marker === 218) {
        while (offset < bytes.length) {
          if (bytes[offset] !== 255) { offset++; continue; }
          let end = offset + 1; while (bytes[end] === 255) end++;
          if (bytes[end] === 0 || bytes[end]! >= 208 && bytes[end]! <= 215) { offset = end + 1; continue; }
          break;
        }
      }
    }
    invalid();
  }
  return false;
}

/** Only runs in the existing read-only, network-disabled renderer. No SVG,
 * document, URL, shell, resize or first-frame fallback reaches the decoder. */
export async function renderImage(source: string, output: string, fileName: string, format: 'png' | 'jpeg') {
  const expected = imageInputFormat(fileName);
  if (!expected) throw new Error('Prepared image conversion supports static PNG, JPEG and WebP sources. Download other images in their original format.');
  const root = await realpath(source), input = await realpath(path.join(root, fileName));
  if (!input.startsWith(root + path.sep)) throw new Error('Image input is outside the snapshot.');
  const info = await stat(input);
  if (!info.isFile() || info.size < 1 || info.size > maximumBytes) throw new Error('Image input exceeds its 50 MiB byte limit.');
  const bytes = await readFile(input);
  const requiresIcc = checkedContainer(bytes, expected);
  const image = sharp(bytes, { failOn: 'warning', limitInputPixels: maximumPixels, limitInputChannels: 4 }).timeout({ seconds: 15 });
  try {
    const metadata = await image.metadata();
    if (requiresIcc && !metadata.icc) throw new Error('Non-sRGB PNG gamma/chromaticity requires a supported ICC profile before conversion.');
    if (metadata.format !== expected || !metadata.width || !metadata.height || metadata.width > 8192 || metadata.height > 8192 || metadata.width * metadata.height > maximumPixels || (metadata.pages ?? 1) !== 1 || metadata.depth !== 'uchar' || !['srgb', 'rgb', 'b-w'].includes(metadata.space)) throw new Error('Image conversion requires a single 8-bit RGB/greyscale image, at most 8192 pixels per side and 16 megapixels.');
    // Orientation is applied to pixels before EXIF is removed. Retain the ICC
    // profile, not camera/GPS/XMP metadata; JPEG has an explicit white background.
    const pipeline = image.autoOrient().keepIccProfile();
    const body = await (format === 'jpeg' ? pipeline.flatten({ background: '#ffffff' }).jpeg({ quality: 95, chromaSubsampling: '4:4:4' }) : pipeline.png()).toBuffer();
    if (!body.length || body.length > maximumOutputBytes) throw new Error('Image output exceeds its 65 MiB byte limit.');
    const file = format === 'jpeg' ? 'artifact.jpg' : 'artifact.png';
    await writeFile(path.join(output, file), body, { flag: 'wx', mode: 0o600 });
    return { file, mime: format === 'jpeg' ? 'image/jpeg' : 'image/png', pages: 1 };
  } finally { image.destroy(); }
}
