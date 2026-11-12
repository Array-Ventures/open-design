import { expect, it } from 'vitest';
import { documentCommentAnchorHint, normalizeDocumentCommentHint, readDocumentCommentAnchorHint } from '../src/runtime/document-comment-anchor.js';
const anchor = { version: 1 as const, start: { block: 'start', offset: 1 }, end: { block: 'end', offset: 30 }, quote: '  Exact  spaces\nUnicode 😀 "quotes" & <tags>  ' };
it('preserves exact bounded text in an inert versioned payload', () => {
  const hint = documentCommentAnchorHint(anchor); expect(normalizeDocumentCommentHint(hint)).toBe(hint); expect(readDocumentCommentAnchorHint(hint)).toEqual(anchor);
});
it('rejects malformed and out-of-limit structured hints without normalizing them into targets', () => {
  for (const payload of [{ ...anchor, version: 2 }, { ...anchor, quote: '' }, { ...anchor, quote: 'x'.repeat(4001) }, { ...anchor, start: { block: 'x', offset: -1 } }, { ...anchor, start: { block: 'x', offset: 1_000_001 } }, { ...anchor, start: { block: 'x'.repeat(101), offset: 0 } }, { ...anchor, surprise: 'data' }, { ...anchor, end: { ...anchor.end, surprise: 1 } }]) {
    const hint = 'eve-document-anchor:' + JSON.stringify(payload); expect(readDocumentCommentAnchorHint(hint)).toBeNull(); expect(() => normalizeDocumentCommentHint(hint)).toThrow('Invalid structured');
  }
  for (const hint of ['eve-document-anchor:{', ' eve-document-anchor:' + JSON.stringify(anchor), 'eve-document-anchor:' + 'x'.repeat(30_001)]) expect(() => normalizeDocumentCommentHint(hint)).toThrow('Invalid structured');
});
it('retains generic HTML hint whitespace normalization and 180-character limit', () => {
  const html = '  <h1>\n' + 'a '.repeat(120) + '</h1>  '; expect(normalizeDocumentCommentHint(html)).toBe(html.replace(/\s+/g, ' ').trim().slice(0, 180));
  expect(normalizeDocumentCommentHint(null)).toBe('');
});
