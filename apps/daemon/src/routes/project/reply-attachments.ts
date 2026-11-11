import type Database from 'better-sqlite3';
import type { PreviewCommentAttachment } from '@open-design/contracts';
import { getProject } from '../../db.js';
import { withEmbeddedProject } from '../../embedded-files/pinned-project.js';
import { mimeFor, validateProjectPath } from '../../projects.js';
import { detectMime } from '../../library.js';
import { rasterImageSize } from '../../artifacts/raster-image-size.js';

export class ReplyAttachmentError extends Error {
  constructor(cause?: unknown) { super('Reply images must be valid images saved in this artifact workspace.', { cause }); }
}
/** Read through the same pinned project boundary as upload/raw; never trust a filename's MIME. */
export async function validateReplyAttachments(db: Database.Database, projectId: string, input: unknown): Promise<PreviewCommentAttachment[]> {
  if (!Array.isArray(input) || input.length > 8) throw new ReplyAttachmentError();
  if (!input.length) return [];
  const metadata = getProject(db, projectId)?.metadata;
  if (!metadata) throw new ReplyAttachmentError();
  try {
    return await withEmbeddedProject(projectId, metadata, async project => {
      let total = 0;
      const attachments: PreviewCommentAttachment[] = [];
      const paths = new Set<string>();
      for (const item of input) {
        if (!item || typeof item !== 'object' || typeof item.path !== 'string'
          || validateProjectPath(item.path) !== item.path || !item.path.startsWith('_studio-comments/')
          || /[\r\n\0]/.test(item.path) || item.path.length > 2000 || paths.has(item.path)
          || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 200 || /[\r\n\0]/.test(item.name)) throw new ReplyAttachmentError();
        paths.add(item.path);
        const { buffer } = await project.read(item.path, 25 * 1024 * 1024);
        total += buffer.length;
        const detected = detectMime(buffer);
        if (total > 50 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(detected)
          || mimeFor(item.path) !== detected) throw new ReplyAttachmentError();
        const size = rasterImageSize(buffer);
        if (!size || size.w < 1 || size.h < 1 || size.w * size.h > 40_000_000) throw new ReplyAttachmentError();
        attachments.push({ path: item.path, name: item.name.trim() });
      }
      return attachments;
    });
  } catch (cause) { throw new ReplyAttachmentError(cause); }
}
