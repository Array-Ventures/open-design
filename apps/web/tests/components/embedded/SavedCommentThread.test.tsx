// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PreviewComment, PreviewCommentReply } from '@open-design/contracts';
import { SavedCommentThread } from '../../../src/components/embedded/SavedCommentThread';
const api = vi.hoisted(() => ({ fetchCommentReplies: vi.fn(), createCommentReply: vi.fn(), editCommentReply: vi.fn(), deleteCommentReply: vi.fn() }));
const confirm = vi.hoisted(() => vi.fn());
vi.mock('../../../src/components/embedded/comment-reply-api', () => api);
vi.mock('../../../src/components/embedded/host-context', () => ({ confirmHostFeedbackDiscard: confirm }));
vi.mock('../../../src/components/embedded/host-viewer', () => ({ useEmbeddedMentionBots: () => [{ id: 'chief', name: 'Chief' }, { id: 'scout', name: 'Scout' }], useEmbeddedViewer: () => ({ memberId: 'evebot:person', displayName: 'Person' }) }));
const root = { id: 'root', note: 'Read-only root', authorDisplayName: 'Person', createdAt: 1, status: 'open' } as PreviewComment;
const reply: PreviewCommentReply = { id: 'reply', commentId: 'root', authorMemberId: 'evebot:person', authorDisplayName: 'Person', note: 'Saved reply', createdAt: 1, updatedAt: 1, revision: 1 };
function props() { return { projectId: 'project', comment: root, hidden: false, onDirty: vi.fn(), onClose: vi.fn(), onEditRoot: vi.fn(), onDeleteRoot: vi.fn(), canEditRoot: true, canDeleteRoot: true, existingImages: [] }; }
beforeEach(() => { vi.resetAllMocks(); api.fetchCommentReplies.mockResolvedValue([]); confirm.mockResolvedValue(false); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
it('shows the saved root as text and starts a separate empty reply composer', async () => {
  render(<SavedCommentThread {...props()} />);
  expect(screen.getByText(root.note)).toBeVisible();
  expect(screen.getByRole('textbox', { name: 'Reply' })).toHaveValue('');
  await waitFor(() => expect(screen.queryByText('Loading comments…')).toBeNull());
});
it('keeps newer typing while a reply save finishes and prevents double submission', async () => {
  let complete!: (value: PreviewCommentReply) => void;
  api.createCommentReply.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  const p = props(); render(<SavedCommentThread {...p} />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'First reply' } });
  const send = screen.getByRole('button', { name: 'Add reply' }); fireEvent.click(send); fireEvent.click(send);
  expect(api.createCommentReply).toHaveBeenCalledOnce(); expect(p.onDirty).toHaveBeenLastCalledWith(true);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Next draft' } });
  await act(async () => complete({ ...reply, note: 'First reply' }));
  expect(screen.getByText('First reply')).toBeVisible(); expect(screen.getByRole('textbox')).toHaveValue('Next draft');
  expect(p.onDirty).toHaveBeenLastCalledWith(true);
});
it('reuses a failed create receipt for the same draft and rotates it when the draft changes', async () => {
  api.createCommentReply.mockRejectedValue(new Error('Offline'));
  render(<SavedCommentThread {...props()} />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Keep me' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add reply' }));
  await screen.findByRole('alert'); await waitFor(() => expect(screen.getByRole('button', { name: 'Add reply' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Add reply' }));
  await waitFor(() => expect(api.createCommentReply).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Add reply' })).toBeEnabled());
  expect(api.createCommentReply.mock.calls[0]![2]).toEqual(api.createCommentReply.mock.calls[1]![2]);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Changed draft' } }); fireEvent.click(screen.getByRole('button', { name: 'Add reply' }));
  await waitFor(() => expect(api.createCommentReply).toHaveBeenCalledTimes(3));
  expect(api.createCommentReply.mock.calls[2]![2].operationId).not.toBe(api.createCommentReply.mock.calls[0]![2].operationId);
});
it('retains a reply draft while the same thread is hidden for the comments list', () => {
  const p = props(); const view = render(<SavedCommentThread {...p} />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Retained draft' } });
  view.rerender(<SavedCommentThread {...p} hidden />); expect(screen.queryByRole('textbox')).toBeNull();
  view.rerender(<SavedCommentThread {...p} />); expect(screen.getByRole('textbox')).toHaveValue('Retained draft');
});
it('does not let a late initial list overwrite a reply that just saved', async () => {
  let read!: (value: PreviewCommentReply[]) => void;
  api.fetchCommentReplies.mockImplementation(() => new Promise(resolve => { read = resolve; }));
  api.createCommentReply.mockResolvedValue(reply);
  render(<SavedCommentThread {...props()} />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: reply.note } }); fireEvent.click(screen.getByRole('button', { name: 'Add reply' }));
  await screen.findByText(reply.note); await act(async () => read([]));
  expect(screen.getByText(reply.note)).toBeVisible();
});
it('aborts the old lifetime and suppresses its late reply after a thread switch', async () => {
  let complete!: (value: PreviewCommentReply) => void;
  api.createCommentReply.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  const p = props(); const view = render(<SavedCommentThread {...p} />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: reply.note } }); fireEvent.click(screen.getByRole('button', { name: 'Add reply' }));
  const signal = api.createCommentReply.mock.calls[0]![3] as AbortSignal;
  view.rerender(<SavedCommentThread {...p} comment={{ ...root, id: 'other', note: 'Other root' }} />);
  expect(signal.aborted).toBe(true); await act(async () => complete(reply));
  expect(screen.queryByText(reply.note)).toBeNull(); expect(screen.getByRole('textbox')).toHaveValue('');
});
it('retains unsaved reply text when root editing is refused by the discard guard', async () => {
  const p = props(); render(<SavedCommentThread {...p} />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Keep draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'Comment actions' })); fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
  await waitFor(() => expect(confirm).toHaveBeenCalledWith('project', 'comment'));
  expect(p.onEditRoot).not.toHaveBeenCalled(); expect(screen.getByRole('textbox')).toHaveValue('Keep draft');
});
it('edits only an owned reply and submits the revision seen by the editor', async () => {
  api.fetchCommentReplies.mockResolvedValue([reply, { ...reply, id: 'someone-else', authorMemberId: 'evebot:other', note: 'Another author' }]);
  api.editCommentReply.mockResolvedValue({ ...reply, note: 'Edited', revision: 2 });
  render(<SavedCommentThread {...props()} />); await screen.findByText(reply.note);
  expect(screen.getAllByRole('button', { name: 'Reply actions' })).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Reply actions' })); fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Edit reply' })).toHaveValue(reply.note));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Edited' } }); fireEvent.click(screen.getByRole('button', { name: 'Save reply' }));
  await screen.findByText('Edited'); expect(api.editCommentReply).toHaveBeenCalledWith('project', 'root', reply.id, { note: 'Edited', expectedRevision: 1 }, expect.any(AbortSignal));
});

it('reconciles other authors reply additions and removals without replacing the draft', async () => {
  vi.useFakeTimers(); vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  await act(async () => { render(<SavedCommentThread {...props()} />); });
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'My pending reply' } });
  api.fetchCommentReplies.mockResolvedValue([reply]);
  await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
  expect(screen.getByText(reply.note)).toBeVisible(); expect(screen.getByRole('textbox')).toHaveValue('My pending reply');
  api.fetchCommentReplies.mockResolvedValue([]);
  await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
  expect(screen.queryByText(reply.note)).toBeNull(); expect(screen.getByRole('textbox')).toHaveValue('My pending reply');
});

it('keeps a draft visible after its root is deleted and prevents implicit recreation', () => {
  const p = props(); const view = render(<SavedCommentThread {...p} />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Do not lose this' } });
  view.rerender(<SavedCommentThread {...p} deleted canEditRoot={false} canDeleteRoot={false} />);
  expect(screen.getByRole('textbox')).toHaveValue('Do not lose this');
  expect(screen.getByRole('button', { name: 'Add reply' })).toBeDisabled();
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' }); expect(api.createCommentReply).not.toHaveBeenCalled();
});

it('retains edits after a revision conflict and reload does not overwrite the editing buffer', async () => {
  api.fetchCommentReplies.mockResolvedValue([reply]);
  api.editCommentReply.mockRejectedValue(new Error('This reply changed. Reload the thread before editing.'));
  render(<SavedCommentThread {...props()} />); await screen.findByText(reply.note);
  fireEvent.click(screen.getByRole('button', { name: 'Reply actions' })); fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'My conflicting draft' } }); fireEvent.click(screen.getByRole('button', { name: 'Save reply' }));
  await screen.findByRole('alert');
  api.fetchCommentReplies.mockResolvedValue([{ ...reply, note: 'A newer saved edit', revision: 2 }]);
  fireEvent.click(screen.getByRole('button', { name: 'Reload comments' })); await screen.findByText('A newer saved edit');
  expect(screen.getByRole('textbox')).toHaveValue('My conflicting draft');
  expect(screen.getByRole('button', { name: 'Save reply' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Continue editing latest reply' }));
  api.editCommentReply.mockResolvedValue({ ...reply, note: 'My conflicting draft', revision: 3 });
  fireEvent.click(screen.getByRole('button', { name: 'Save reply' }));
  await waitFor(() => expect(api.editCommentReply).toHaveBeenLastCalledWith('project', 'root', reply.id, { note: 'My conflicting draft', expectedRevision: 2 }, expect.any(AbortSignal)));
});

it('retains newer typing as a new unsent draft when deleting the edited reply finishes', async () => {
  let finish!: () => void;
  api.fetchCommentReplies.mockResolvedValue([reply]); api.deleteCommentReply.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  render(<SavedCommentThread {...props()} />); await screen.findByText(reply.note);
  fireEvent.click(screen.getByRole('button', { name: 'Reply actions' })); fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Edit reply' })).toHaveValue(reply.note));
  fireEvent.click(screen.getByRole('button', { name: 'Reply actions' })); fireEvent.click(await screen.findByRole('button', { name: 'Delete reply' }));
  await waitFor(() => expect(api.deleteCommentReply).toHaveBeenCalledOnce());
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Typed after delete started' } });
  await act(async () => finish());
  expect(screen.getByRole('textbox', { name: 'Reply' })).toHaveValue('Typed after delete started');
  expect(screen.getByRole('button', { name: 'Add reply' })).toBeEnabled(); expect(api.createCommentReply).not.toHaveBeenCalled();
});

it('selects a bot mention with Enter without posting the reply', async () => {
  const p = props(); render(<SavedCommentThread {...p} />);
  const input = screen.getByRole('textbox', { name: 'Reply' });
  fireEvent.input(input, { target: { value: '@Ch', selectionStart: 3, selectionEnd: 3 } });
  await screen.findByRole('listbox', { name: 'Mention a bot' });
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => expect(input).toHaveValue('@Chief '));
  expect(api.createCommentReply).not.toHaveBeenCalled(); expect(p.onDirty).toHaveBeenLastCalledWith(true);
});

it('does not post on composition confirmation or Shift+Enter', async () => {
  api.createCommentReply.mockResolvedValue({ ...reply, note: '正在输入' });
  render(<SavedCommentThread {...props()} />);
  const input = screen.getByRole('textbox', { name: 'Reply' });
  fireEvent.change(input, { target: { value: '正在输入' } });
  fireEvent.compositionStart(input); fireEvent.keyDown(input, { key: 'Enter' });
  expect(api.createCommentReply).not.toHaveBeenCalled();
  fireEvent.compositionEnd(input); fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
  expect(api.createCommentReply).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => expect(api.createCommentReply).toHaveBeenCalledOnce());
});
