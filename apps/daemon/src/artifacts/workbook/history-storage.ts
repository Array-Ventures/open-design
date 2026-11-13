import { constants } from 'node:fs';
import { mkdir, open } from 'node:fs/promises';
import { z } from 'zod';
import { readPinnedFile, writePinnedFile } from '../../embedded-files/pinned-project.js';

export const isWorkbookHistoryFile = (name: string): boolean => /\.(xlsx|csv)$/i.test(name);
export const WORKBOOK_HISTORY_BYTES = 25 * 1024 * 1024;
export const WORKBOOK_HISTORY_MANIFEST_BYTES = 16 * 1024 * 1024;
const identity = z.string().regex(/^[A-Za-z0-9_-]+$/);
const entry = z.object({ id: identity, version: z.number().int().positive(), size: z.number().int().min(0).max(WORKBOOK_HISTORY_BYTES),
  contentPath: z.string().regex(/^[A-Za-z0-9_-]+\.(xlsx|csv)$/), contentDigest: z.string().regex(/^[0-9a-f]{64}$/) }).passthrough();
const manifest = z.object({ schemaVersion: z.literal(2), entries: z.array(entry).max(10_000), currentVersionId: identity.nullable(), deletedAt: z.number().positive().optional() }).passthrough()
  .superRefine((value, context) => {
    if (new Set(value.entries.map(item => item.id)).size !== value.entries.length || new Set(value.entries.map(item => item.contentPath)).size !== value.entries.length
      || value.currentVersionId !== null && !value.entries.some(item => item.id === value.currentVersionId)) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid workbook history identities.' });
  });
export function validateWorkbookHistoryManifest(value: unknown): void { manifest.parse(value); }
export function requireWorkbookHistoryBytes(value: Buffer): Buffer {
  if (!Buffer.isBuffer(value) || value.length > WORKBOOK_HISTORY_BYTES) throw Object.assign(new Error('Workbook history requires at most 25 MiB of binary content.'), { code: 'EINVAL' });
  return Buffer.from(value);
}
export async function readWorkbookHistoryFile(root: string, name: string, maximum = WORKBOOK_HISTORY_BYTES): Promise<Buffer> {
  if (process.platform !== 'linux') throw Object.assign(new Error('Embedded workbook history requires Linux.'), { code: 'ENOTSUP' });
  const parent = await open(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { return (await readPinnedFile(parent, name, maximum)).buffer; }
  finally { await parent.close(); }
}
/** Embedded Evebot already requires Linux descriptor containment. Reuse its
 * synced atomic writer for binary blobs and manifests instead of inventing a
 * second commit mechanism. Legacy standalone text storage is unaffected. */
export async function persistWorkbookHistoryFile(root: string, name: string, bytes: Buffer | string, overwrite: boolean): Promise<void> {
  if (name === 'manifest.json' && Buffer.byteLength(bytes) > WORKBOOK_HISTORY_MANIFEST_BYTES) throw Object.assign(new Error('Workbook history manifest exceeds its byte limit.'), { code: 'EFBIG' });
  if (process.platform !== 'linux') throw Object.assign(new Error('Embedded workbook history requires Linux.'), { code: 'ENOTSUP' });
  await mkdir(root, { recursive: true, mode: 0o700 });
  const parent = await open(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await writePinnedFile(parent, name, bytes, overwrite); }
  finally { await parent.close(); }
}
