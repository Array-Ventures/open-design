/** Inert structured-document identity carried in the existing comment hint field. */
export interface DocumentCommentAnchor {
  version: 1;
  start: { block: string; offset: number };
  end: { block: string; offset: number };
  quote: string;
}
export const DOCUMENT_COMMENT_ANCHOR_PREFIX = 'eve-document-anchor:';
const keys = (value: unknown, expected: string[]): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
function endpoint(value: unknown): boolean {
  return keys(value, ['block', 'offset']) && typeof value.block === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value.block) && Number.isSafeInteger(value.offset) && (value.offset as number) >= 0 && (value.offset as number) <= 1_000_000;
}
export function readDocumentCommentAnchorHint(value: unknown): DocumentCommentAnchor | null {
  if (typeof value !== 'string' || value.length > 30_000 || !value.startsWith(DOCUMENT_COMMENT_ANCHOR_PREFIX)) return null;
  try {
    const parsed: unknown = JSON.parse(value.slice(DOCUMENT_COMMENT_ANCHOR_PREFIX.length));
    return keys(parsed, ['version', 'start', 'end', 'quote']) && parsed.version === 1 && endpoint(parsed.start) && endpoint(parsed.end) && typeof parsed.quote === 'string' && parsed.quote.length <= 4000 && parsed.quote.trim().length > 0 ? parsed as unknown as DocumentCommentAnchor : null;
  } catch { return null; }
}
export function documentCommentAnchorHint(anchor: DocumentCommentAnchor): string {
  const value = DOCUMENT_COMMENT_ANCHOR_PREFIX + JSON.stringify(anchor);
  if (!readDocumentCommentAnchorHint(value)) throw Error('Invalid structured document comment anchor.');
  return value;
}
/** Preserve existing generic HTML hint behavior. A malformed structured payload
 * must fail before a write, never turn into a truncated, apparently valid hint. */
export function normalizeDocumentCommentHint(value: unknown): string {
  if (typeof value !== 'string') return '';
  if (value.trimStart().startsWith(DOCUMENT_COMMENT_ANCHOR_PREFIX)) {
    const anchor = readDocumentCommentAnchorHint(value);
    if (!anchor) throw Error('Invalid structured document comment anchor.');
    return documentCommentAnchorHint(anchor);
  }
  return value.replace(/\s+/g, ' ').trim().slice(0, 180);
}
