import * as zlib from 'node:zlib';
import type { Readable } from 'node:stream';
import JSZip from 'jszip';
import { fromBuffer, type Entry, type ZipFile } from 'yauzl';

export const WORKBOOK_PACKAGE_LIMITS = {
  archiveBytes: 25 * 1024 * 1024,
  expandedBytes: 80 * 1024 * 1024,
  partBytes: 32 * 1024 * 1024,
  entries: 4096,
} as const;
export type WorkbookPackageLimits = { [K in keyof typeof WORKBOOK_PACKAGE_LIMITS]: number };
export type WorkbookParts = ReadonlyMap<string, Buffer>;

export class WorkbookFormatError extends Error {
  constructor(message: string, readonly code: 'WORKBOOK_INVALID' | 'WORKBOOK_LIMIT' | 'WORKBOOK_UNSUPPORTED' = 'WORKBOOK_INVALID') {
    super(message);
  }
}

const requiredParts = ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels'];
// The daemon is pinned to Node 24. Its older shared Node typings predate this
// native API; keep the compatibility declaration at the runtime boundary.
const crc32 = (zlib as typeof zlib & { crc32(data: Uint8Array, value?: number): number }).crc32;

function partName(name: string): string {
  const trimmed = name.endsWith('/') ? name.slice(0, -1) : name;
  if (!trimmed || trimmed.length > 1024 || trimmed.startsWith('/') || /^[A-Za-z]:/.test(trimmed)
    || /[\\\u0000-\u001f\u007f]/.test(trimmed) || trimmed.split('/').length > 64
    || trimmed.split('/').some(segment => !segment || segment === '.' || segment === '..')) {
    throw new WorkbookFormatError('Invalid workbook package path.');
  }
  return trimmed;
}

function admitEntry(entry: Entry, seen: Set<string>, limits: WorkbookPackageLimits): void {
  const name = partName(entry.fileName);
  const key = name.toLowerCase();
  if (seen.has(key)) throw new WorkbookFormatError('Duplicate workbook package part.');
  seen.add(key);
  if (seen.size > limits.entries) throw new WorkbookFormatError('Workbook has too many package parts.', 'WORKBOOK_LIMIT');
  const mode = (entry.externalFileAttributes >>> 16) & 0o170000;
  if (mode && mode !== 0o100000 && mode !== 0o040000) throw new WorkbookFormatError('Workbook package links and special entries are not supported.');
  if (entry.generalPurposeBitFlag & 0x41) throw new WorkbookFormatError('Encrypted workbooks are not supported.', 'WORKBOOK_UNSUPPORTED');
  if (![0, 8].includes(entry.compressionMethod)) throw new WorkbookFormatError('Workbook compression is not supported.', 'WORKBOOK_UNSUPPORTED');
  if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0 || entry.uncompressedSize > limits.partBytes) {
    throw new WorkbookFormatError('Workbook package part exceeds its limit.', 'WORKBOOK_LIMIT');
  }
  if (entry.fileName.endsWith('/') && entry.uncompressedSize !== 0) throw new WorkbookFormatError('Workbook directory contains unexpected data.');
}

function streamEntry(zip: ZipFile, entry: Entry): Promise<Readable> {
  return new Promise((resolve, reject) => zip.openReadStream(entry, (error, stream) => {
    if (error || !stream) reject(error ?? new WorkbookFormatError('Workbook package part could not be read.'));
    else resolve(stream);
  }));
}

/** Admit and bound actual decompressed bytes before an XML or workbook parser
 * sees them. No archive entry is ever extracted onto the filesystem. */
export async function readWorkbookPackage(bytes: Buffer, limits: WorkbookPackageLimits = WORKBOOK_PACKAGE_LIMITS): Promise<WorkbookParts> {
  if (bytes.length > limits.archiveBytes) throw new WorkbookFormatError('Workbook file exceeds its limit.', 'WORKBOOK_LIMIT');
  if (typeof crc32 !== 'function') throw new WorkbookFormatError('Workbook loading requires Node 24.', 'WORKBOOK_UNSUPPORTED');
  return new Promise((resolve, reject) => fromBuffer(bytes, { lazyEntries: true, decodeStrings: true, strictFileNames: true, validateEntrySizes: true }, (error, zip) => {
    if (error || !zip) { reject(new WorkbookFormatError('Invalid workbook archive.')); return; }
    const seen = new Set<string>();
    const parts = new Map<string, Buffer>();
    let declared = 0, actual = 0, settled = false;
    const fail = (failure: unknown) => {
      if (settled) return;
      settled = true; zip.close();
      reject(failure instanceof WorkbookFormatError ? failure : new WorkbookFormatError('Invalid workbook archive.'));
    };
    zip.on('error', fail);
    zip.on('end', () => {
      if (settled) return;
      if (requiredParts.some(name => !parts.has(name))) { fail(new WorkbookFormatError('Workbook package is missing required parts.')); return; }
      settled = true; zip.close(); resolve(parts);
    });
    zip.on('entry', entry => {
      void (async () => {
        admitEntry(entry, seen, limits);
        declared += entry.uncompressedSize;
        if (declared > limits.expandedBytes) throw new WorkbookFormatError('Expanded workbook exceeds its limit.', 'WORKBOOK_LIMIT');
        const chunks: Buffer[] = [];
        let size = 0, crc = 0;
        const stream = await streamEntry(zip, entry);
        for await (const data of stream) {
          if (!Buffer.isBuffer(data) && !(data instanceof Uint8Array)) throw new WorkbookFormatError('Invalid workbook package bytes.');
          const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
          size += chunk.length; actual += chunk.length;
          if (size > limits.partBytes || actual > limits.expandedBytes) {
            throw new WorkbookFormatError('Expanded workbook exceeds its limit.', 'WORKBOOK_LIMIT');
          }
          crc = crc32(chunk, crc);
          chunks.push(chunk);
        }
        if (size !== entry.uncompressedSize || (crc >>> 0) !== (entry.crc32 >>> 0)) throw new WorkbookFormatError('Workbook package checksum or size does not match.');
        if (!entry.fileName.endsWith('/')) parts.set(entry.fileName, Buffer.concat(chunks, size));
        if (!settled) zip.readEntry();
      })().catch(fail);
    });
    zip.readEntry();
  }));
}

/** Preserve all unedited OOXML parts, including drawings/charts/extensions.
 * This deliberately does not roundtrip through a lossy workbook serializer. */
export async function writeWorkbookPackage(parts: WorkbookParts, limits: WorkbookPackageLimits = WORKBOOK_PACKAGE_LIMITS): Promise<Buffer> {
  const zip = new JSZip();
  let expanded = 0;
  const seen = new Set<string>();
  for (const [name, bytes] of parts) {
    if (name.endsWith('/')) throw new WorkbookFormatError('Workbook output needs file parts.');
    const key = partName(name).toLowerCase();
    if (seen.has(key)) throw new WorkbookFormatError('Duplicate workbook package part.');
    seen.add(key); expanded += bytes.length;
    if (seen.size > limits.entries || bytes.length > limits.partBytes || expanded > limits.expandedBytes) throw new WorkbookFormatError('Workbook package exceeds its limit.', 'WORKBOOK_LIMIT');
    zip.file(name, bytes, { createFolders: false });
  }
  if (requiredParts.some(name => !parts.has(name))) throw new WorkbookFormatError('Workbook package is missing required parts.');
  const output = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  if (output.length > limits.archiveBytes) throw new WorkbookFormatError('Workbook file exceeds its limit.', 'WORKBOOK_LIMIT');
  return output;
}
