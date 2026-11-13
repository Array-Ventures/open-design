import type { PreviewComment } from '../../types';
import { commentVisibleOnDeckSlide } from '../../comments';

/** Pages belong to the current artifact, never the project's internal files.
 * Scope changes only list membership, not selected threads or unsent work. */
export function commentsInReviewScope(comments: readonly PreviewComment[], scope: {
  fileName: string; showResolved: boolean; pageScope: 'page' | 'all'; pageAvailable: boolean; slideIndex: number | null;
}): PreviewComment[] {
  return comments.filter(comment => comment.filePath === scope.fileName
    && (comment.status === 'open' || scope.showResolved && comment.status === 'resolved')
    && (!scope.pageAvailable || scope.pageScope === 'all' || commentVisibleOnDeckSlide(comment, scope.slideIndex)));
}
