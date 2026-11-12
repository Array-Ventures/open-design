import { expect, it } from 'vitest';
import type { PreviewComment } from '../../../src/types';
import { commentsInReviewScope } from '../../../src/components/embedded/comment-page-scope';
const comment = (id: string, slideIndex?: number, extra = {}) => ({ id, filePath: 'deck.html', status: 'open', ...(slideIndex === undefined ? {} : { slideIndex }), ...extra }) as PreviewComment;
const comments = [comment('first', 0), comment('second', 1), comment('legacy'), comment('resolved', 0, { status: 'resolved' }), comment('other-file', 0, { filePath: 'internal.html' }), comment('removed', 0, { status: 'deleted' })];
const scope = { fileName: 'deck.html', showResolved: false, pageScope: 'page' as const, pageAvailable: true, slideIndex: 0 };
it('restricts page scope to the active slide while retaining legacy artifact-wide threads', () => {
  expect(commentsInReviewScope(comments, scope).map(c => c.id)).toEqual(['first', 'legacy']);
  expect(commentsInReviewScope(comments, { ...scope, slideIndex: 1 }).map(c => c.id)).toEqual(['second', 'legacy']);
});
it('keeps all pages inside the current artifact and composes resolved filtering', () => {
  expect(commentsInReviewScope(comments, { ...scope, pageScope: 'all' }).map(c => c.id)).toEqual(['first', 'second', 'legacy']);
  expect(commentsInReviewScope(comments, { ...scope, showResolved: true }).map(c => c.id)).toEqual(['first', 'legacy', 'resolved']);
  expect(commentsInReviewScope(comments, { ...scope, pageScope: 'all', showResolved: true }).map(c => c.id)).toEqual(['first', 'second', 'legacy', 'resolved']);
});
it('suspends page filtering outside comment mode and treats a plain file as one page', () => {
  expect(commentsInReviewScope(comments, { ...scope, pageAvailable: false }).map(c => c.id)).toEqual(['first', 'second', 'legacy']);
  expect(commentsInReviewScope(comments, { ...scope, slideIndex: null }).map(c => c.id)).toEqual(['first', 'second', 'legacy']);
});
