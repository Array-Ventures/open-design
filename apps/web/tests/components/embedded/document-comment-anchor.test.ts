// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { createEditor, $createParagraphNode, $createTextNode, $createLineBreakNode, $getRoot, $setState, $createRangeSelection, $setSelection } from 'lexical';
import { documentBlockId } from '../../../src/components/embedded/document/document-identity';
import { captureDocumentComment, documentCommentQuote, resolveDocumentComment, documentCommentTarget, readDocumentCommentAnchor } from '../../../src/components/embedded/document/document-comment-anchor';
function run(test: () => void) { const editor = createEditor({ onError: error => { throw error; } }); editor.update(test, { discrete: true }); }
it('roundtrips exact Unicode selection across formatting and blocks without changing the document', () => run(() => {
  const first = $createParagraphNode(), second = $createParagraphNode(), a = $createTextNode('Hello 😀 '), b = $createTextNode('world'), c = $createTextNode('Next paragraph');
  b.toggleFormat('bold'); first.append(a, b); second.append(c); $getRoot().append(first, second); $setState(first, documentBlockId, 'first'); $setState(second, documentBlockId, 'second');
  const selection = $createRangeSelection(); selection.setTextNodeRange(a, 6, c, 4); $setSelection(selection);
  const before = $getRoot().getTextContent(), anchor = captureDocumentComment()!;
  expect(anchor.quote).toBe('😀 world\nNext');
  const target = documentCommentTarget('doc.md', anchor); expect(readDocumentCommentAnchor(target)).toEqual(anchor);
  expect(resolveDocumentComment(anchor)?.getTextContent()).toBe(anchor.quote); expect($getRoot().getTextContent()).toBe(before);
  c.setTextContent('Changed paragraph'); expect(resolveDocumentComment(anchor)).toBeNull();
}));
it('supports backward selections, line breaks and inline text splitting with stable block offsets', () => run(() => {
  const paragraph = $createParagraphNode(), a = $createTextNode('before'), b = $createTextNode('after');
  paragraph.append(a, $createLineBreakNode(), b); $setState(paragraph, documentBlockId, 'block'); $getRoot().append(paragraph);
  const selection = $createRangeSelection(); selection.setTextNodeRange(b, 3, a, 2); $setSelection(selection);
  const anchor = captureDocumentComment()!; expect(anchor.quote).toBe('fore\naft');
  a.splitText(3); expect(resolveDocumentComment(anchor)?.getTextContent()).toBe('fore\naft');
  paragraph.remove(); expect(resolveDocumentComment(anchor)).toBeNull();
}));
it('refuses collapsed, oversized and malformed anchor payloads', () => run(() => {
  const p = $createParagraphNode().append($createTextNode('text')); $getRoot().append(p); $setState(p, documentBlockId, 'block'); p.selectStart();
  expect(captureDocumentComment()).toBeNull();
  for (const value of ['<span data-eve-document-anchor="{}"></span>', '<script>not an anchor</script>', 'x'.repeat(30001)]) expect(readDocumentCommentAnchor({ htmlHint: value })).toBeNull();
}));

it('keeps the complete structured quote in contextual chat handoff beyond generic hint/text caps', async () => {
  const { commentsToAttachments } = await import('../../../src/comments');
  const { commentFeedbackContext } = await import('../../../src/components/embedded/host-context');
  const quote = 'Exact  spaces\nUnicode 😀 & "quoted" text '.repeat(30);
  const target = documentCommentTarget('report.md', { version: 1, start: { block: 'first', offset: 0 }, end: { block: 'last', offset: quote.length }, quote });
  const attachments = commentsToAttachments([{ ...target, id: 'comment', projectId: 'project', conversationId: 'project', note: 'Revise this', createdAt: 1, updatedAt: 1, status: 'open', text: quote.slice(0, 160) }]);
  expect(attachments[0]!.currentText).toBe(quote);
  expect(commentFeedbackContext(attachments)[0]!.selectedText).toBe(quote);
});

it('uses a generic target excerpt when there is no valid structured anchor', () => {
  expect(documentCommentQuote({ htmlHint: '<p>Generic</p>', text: 'Generic excerpt' })).toBe('Generic excerpt');
  expect(documentCommentQuote(null)).toBe('');
});
