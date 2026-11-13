// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useState } from 'react';
import type { PreviewComment } from '../../src/types';
import type { PreviewCommentSnapshot } from '../../src/comments';
import { BoardComposerPopover } from '../../src/components/BoardComposerPopover';
import { CommentReviewProvider } from '../../src/components/embedded/CommentReview';
vi.mock('../../src/components/embedded/comment-reply-api', () => ({ fetchCommentReplies: async () => [], createCommentReply: vi.fn(), editCommentReply: vi.fn(), deleteCommentReply: vi.fn() }));
vi.mock('../../src/components/embedded/host-viewer', () => ({ useEmbeddedMentionBots: () => [], useEmbeddedViewer: () => ({ memberId: 'evebot:person', displayName: 'Person' }) }));
afterEach(cleanup);
const target: PreviewCommentSnapshot = { filePath: 'index.html', elementId: 'heading', selector: 'h1', label: 'Heading', text: 'Heading', position: { x: 40, y: 40, width: 200, height: 40 }, htmlHint: '', selectionKind: 'element' };
const root = { ...target, id: 'root', note: 'Saved root note', createdAt: 1, updatedAt: 1, status: 'open', authorDisplayName: 'Person' } as PreviewComment;
function view({ existing = root, list = false, edit = 0, selection = 0, draftValue = root.note, onDraft = vi.fn() }: { draftValue?: string; onDraft?(value: string): void; existing?: PreviewComment | null; list?: boolean; edit?: number; selection?: number } = {}) {
  return <CommentReviewProvider projectId="project" changeStatus={vi.fn()}><BoardComposerPopover target={target} existing={existing} draft={draftValue} notes={[]} compact
    onDraft={onDraft} onAddDraft={vi.fn()} onRemoveQueuedNote={vi.fn()} onClose={vi.fn()} onSaveComment={vi.fn()} onSendBatch={vi.fn()} onRemoveMember={vi.fn()} onThreadDirty={vi.fn()}
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

function ControlledThread({ existing, edit = 0 }: { existing: PreviewComment; edit?: number }) {
  const [draft, setDraft] = useState(root.note);
  return view({ existing, edit, draftValue: draft, onDraft: setDraft });
}
it('updates an untouched root buffer after external edits while retaining the reply draft and read mode', async () => {
  const rendered = render(<ControlledThread existing={root} />);
  fireEvent.change(screen.getByRole('textbox', { name: 'Reply' }), { target: { value: 'My unsent reply' } });
  rendered.rerender(<ControlledThread existing={{ ...root, note: 'Externally updated root' }} />);
  await waitFor(() => expect(screen.queryByTestId('comment-popover-input')).toBeNull());
  expect(screen.getByText('Externally updated root')).toBeVisible();
  expect(screen.getByRole('textbox', { name: 'Reply' })).toHaveValue('My unsent reply');
});
it('does not replace unsaved root edits when the same saved root changes externally', async () => {
  const rendered = render(<ControlledThread existing={root} edit={1} />);
  fireEvent.change(screen.getByTestId('comment-popover-input'), { target: { value: 'My local root edit' } });
  rendered.rerender(<ControlledThread existing={{ ...root, note: 'Externally updated root' }} edit={1} />);
  expect(screen.getByTestId('comment-popover-input')).toHaveValue('My local root edit');
});

it('keeps unsent root text and its image receipt while page and resolution filters change', async () => {
  const { CommentReviewPage } = await import('../../src/components/embedded/CommentReview');
  const image = { file: new File(['image'], 'note.png', { type: 'image/png' }), url: 'blob:owned-note-image' };
  function Draft() {
    const [draft, setDraft] = useState('Unsent root text'); const [list, setList] = useState(false);
    return <CommentReviewProvider projectId="project" changeStatus={vi.fn()}><CommentReviewPage value>
      <button onClick={() => setList(value => !value)}>Toggle list</button>
      <BoardComposerPopover target={target} existing={null} draft={draft} notes={[]} images={[image]} compact onDraft={setDraft}
        onAddDraft={vi.fn()} onRemoveQueuedNote={vi.fn()} onClose={vi.fn()} onSaveComment={vi.fn()} onSendBatch={vi.fn()} onRemoveMember={vi.fn()}
        sending={false} t={((key: string) => key) as never} commentsView={list ? <p>Saved comments</p> : undefined} />
    </CommentReviewPage></CommentReviewProvider>;
  }
  render(<Draft />);
  const input = screen.getByTestId('comment-popover-input'); expect(input).toHaveValue('Unsent root text');
  const imageBefore = screen.getByRole('button', { name: 'note.png' }).querySelector('img'); expect(imageBefore).toHaveAttribute('src', image.url);
  fireEvent.click(screen.getByRole('button', { name: 'Toggle list' }));
  const filter = screen.getByRole('button', { name: 'Filter comments' });
  fireEvent.click(filter); fireEvent.click(await screen.findByRole('button', { name: 'This page' }));
  fireEvent.click(filter); fireEvent.click(await screen.findByRole('button', { name: 'Show resolved' }));
  fireEvent.click(screen.getByRole('button', { name: 'Toggle list' }));
  expect(screen.getByTestId('comment-popover-input')).toHaveValue('Unsent root text');
  expect(screen.getByRole('button', { name: 'note.png' }).querySelector('img')).toHaveAttribute('src', image.url);
});
