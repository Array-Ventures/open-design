import { readMarkdownDocument, finalizeMarkdownDocument, type MarkdownDocumentMetadata } from './markdown-document';
import { documentDigest } from './document-digest';
import { projectFileUrl, writeProjectTextFileDetailed } from '../../../providers/registry';

export const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;
export class DocumentReadError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
export type DocumentFile = { html: string; sha256: string; versionId?: string; format?: 'html' | 'markdown'; identities?: MarkdownDocumentMetadata['ids'] };

export { documentDigest } from './document-digest';

/** Hash the observed bytes, including a BOM, rather than a decoded/normalized string. */
export async function readDocumentFile(projectId: string, fileName: string, signal?: AbortSignal): Promise<DocumentFile> {
  if (!/\.(html?|md|markdown)$/i.test(fileName)) throw new Error('This file is not a supported document.');
  const response = await fetch(projectFileUrl(projectId, fileName), { cache: 'no-store', signal });
  if (!response.ok) throw new DocumentReadError('The document could not be loaded.', response.status);
  const tooLarge = () => new Error('This document is too large to edit here.');
  if (Number(response.headers.get('content-length')) > MAX_DOCUMENT_BYTES) {
    await response.body?.cancel();
    throw tooLarge();
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = response.body?.getReader();
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_DOCUMENT_BYTES) { await reader.cancel(); throw tooLarge(); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let html: string;
  try { html = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new Error('This document is not valid UTF-8 text.'); }
  const sha256 = await documentDigest(bytes);
  if (/\.(md|markdown)$/i.test(fileName)) return { ...await readMarkdownDocument(html, fileName), sha256, format: 'markdown' };
  return { html, sha256 };
}

export class DocumentSaveError extends Error {
  constructor(message: string, readonly code?: string, readonly status?: number) { super(message); }
}

export async function saveDocumentFile(projectId: string, fileName: string, html: string, observed: DocumentFile): Promise<DocumentFile> {
  const markdown = /\.(md|markdown)$/i.test(fileName);
  const content = markdown ? await finalizeMarkdownDocument(html) : html;
  const bytes = new TextEncoder().encode(content);
  if (bytes.byteLength > MAX_DOCUMENT_BYTES) throw new Error('This document is too large to save here.');
  const result = await writeProjectTextFileDetailed(projectId, fileName, content, {
    versionSource: 'manual', versionLabel: 'Document edit', expectedContentSha256: observed.sha256,
    ...(observed.versionId ? { parentVersionId: observed.versionId } : {}),
  });
  if (!result.ok) throw new DocumentSaveError(result.message, result.code, result.status);
  return { ...(markdown ? { ...await readMarkdownDocument(content, fileName), format: 'markdown' as const } : { html }), sha256: await documentDigest(bytes), ...(result.version ? { versionId: result.version.id } : {}) };
}
