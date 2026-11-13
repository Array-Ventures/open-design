function read24LE(buf: Buffer, off: number): number {
  return buf.readUIntLE(off, 3);
}

/**
 * Decode the pixel dimensions of a PNG / GIF / JPEG / WebP buffer from its
 * header, or null when the format is unrecognized (AVIF and anything else just
 * fails the size gate gracefully). Header-only — never decodes pixel data.
 */
export function rasterImageSize(buf: Buffer): { w: number; h: number } | null {
  if (buf.length < 24) return null;
  // PNG: 8-byte signature, then IHDR width/height as big-endian uint32.
  if (buf.readUInt32BE(0) === 0x89504e47) {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  // GIF: 'GIF8', then logical screen width/height as little-endian uint16.
  if (buf.toString('ascii', 0, 4) === 'GIF8') {
    return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
  }
  // WebP: 'RIFF' .... 'WEBP' <fourcc>.
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const fourcc = buf.toString('ascii', 12, 16);
    if (fourcc === 'VP8 ' && buf.length >= 30) {
      return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
    }
    if (fourcc === 'VP8L' && buf.length >= 25) {
      const b = buf.readUInt32LE(21);
      return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 };
    }
    if (fourcc === 'VP8X' && buf.length >= 30) {
      return { w: read24LE(buf, 24) + 1, h: read24LE(buf, 27) + 1 };
    }
    return null;
  }
  // JPEG: scan marker segments for a Start-Of-Frame (SOFn) and read its size.
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let off = 2;
    while (off + 9 < buf.length) {
      if (buf[off] !== 0xff) {
        off++;
        continue;
      }
      const marker = buf[off + 1];
      if (marker === undefined) break;
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
        off += 2;
        continue;
      }
      const len = buf.readUInt16BE(off + 2);
      const isSof =
        marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) {
        return { h: buf.readUInt16BE(off + 5), w: buf.readUInt16BE(off + 7) };
      }
      if (len <= 0) break;
      off += 2 + len;
    }
  }
  return null;
}

