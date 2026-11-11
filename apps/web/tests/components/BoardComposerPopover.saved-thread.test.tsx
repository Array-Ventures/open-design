// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { PreviewComment } from '../../src/types';
import type { PreviewCommentSnapshot } from '../../src/comments';
import { BoardComposerPopover } from '../../src/components/BoardComposerPopover';
import { CommentReviewProvider } from '../../src/components/embedded/CommentReview';
vi.mock('../../src/components/embedded/comment-reply-api', () => ({ fetchCommentReplies: async () => [], createCommentReply: vi.fn(), editCommentReply: vi.fn(), deleteCommentReply: vi.fn() }));
vi.mock('../../src/components/embedded/host-viewer', () => ({ useEmbeddedMentionBots: () => [], useEmbeddedViewer: () => ({ memberId: 'evebot:person', displayName: 'Person' }) }));
afterEach(cleanup);
const target: PreviewCommentSnapshot = { filePath: 'index.html', elementId: 'heading', selector: 'h1', label: 'Heading', text: 'Heading', position: { x: 40, y: 40, width: 200, height: 40 }, htmlHint: '', selectionKind: 'element' };
const root = { ...target, id: 'root', note: 'Saved root note', createdAt: 1, updatedAt: 1, status: 'open', authorDisplayName: 'Person' } as PreviewComment;
function view({ existing = root, list = false, edit = 0, selection = 0 }: { existing?: PreviewComment | null; list?: boolean; edit?: number; selection?: number } = {}) {
  return <CommentReviewProvider projectId="project" changeStatus={vi.fn()}><BoardComposerPopover target={target} existing={existing} draft={root.note} notes={[]} compact
    onDraft={vi.fn()} onAddDraft={vi.fn()} onRemoveQueuedNote={vi.fn()} onClose={vi.fn()} onSaveComment={vi.fn()} onSendBatch={vi.fn()} onRemoveMember={vi.fn()} onThreadDirty={vi.fn()}
    sending={false} t={((key: string) => key) as never} rootEditIntent={edit} rootSelectionIntent={selection} commentsView={list ? <p>All comments page</p> : undefined} /></CommentReviewProvider>;
}
it('opens a saved root as a thread and enters the root editor only on an explicit edit intent', async () => {
  const rendered = render(view());
  expect(screen.getByText(root.note)).toBeVisible(); expect(screen.queryByTestId('comment-popover-input')).toBeNull();
  expect(screen.getByRole('textbox', { name: 'Reply' })).toHaveValue('');
  rendered.rerender(view({ edit: 1 }));
  await waitFor(() => expect(screen.getByTestId('comment-popover-input')).toHaveValue(root.note));
  rendered.rerender(view({ selection: 1 }));
  await waitFor(() => expect(screen.queryByTestId('comment-popover-input')).toBeNull());
  expect(screen.getByRole('textbox', { name: 'Reply' })).toHaveValue('');
});
it('keeps its reply composer mounted while showing all comments', () => {
  const rendered = render(view()); fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Unsent reply' } });
  rendered.rerender(view({ list: true })); expect(screen.getByText('All comments page')).toBeVisible(); expect(screen.queryByRole('textbox')).toBeNull();
  rendered.rerender(view()); expect(screen.getByRole('textbox')).toHaveValue('Unsent reply');
});
it('retains the thread snapshot and draft if the saved root disappears during reconciliation', () => {
  const rendered = render(view()); fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Unsent reply' } });
  rendered.rerender(view({ existing: null }));
  expect(screen.getByText(root.note)).toBeVisible(); expect(screen.getByRole('textbox')).toHaveValue('Unsent reply');
  expect(screen.getByRole('button', { name: 'Add reply' })).toBeDisabled();
});
