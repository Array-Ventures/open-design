// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PreviewComment, PreviewCommentReply } from '@open-design/contracts';
import { CommentReplyError } from '../../../src/components/embedded/comment-reply-api';
import { SavedCommentThread } from '../../../src/components/embedded/SavedCommentThread';
const api = vi.hoisted(() => ({ fetchCommentReplies: vi.fn(), createCommentReply: vi.fn(), editCommentReply: vi.fn(), deleteCommentReply: vi.fn() }));
const uploads = vi.hoisted(() => ({ prepare: vi.fn(), clear: vi.fn() }));
vi.mock('../../../src/components/embedded/feedback-image-upload', () => ({ FeedbackImageUpload: class { prepare = uploads.prepare; clear = uploads.clear; } }));
const confirm = vi.hoisted(() => vi.fn());
vi.mock('../../../src/components/embedded/comment-reply-api', async importOriginal => ({ ...await importOriginal<typeof import('../../../src/components/embedded/comment-reply-api')>(), ...api }));
vi.mock('../../../src/components/embedded/host-context', () => ({ confirmHostFeedbackDiscard: confirm }));
vi.mock('../../../src/components/embedded/host-viewer', () => ({ useEmbeddedMentionBots: () => [{ id: 'chief', name: 'Chief' }, { id: 'scout', name: 'Scout' }], useEmbeddedViewer: () => ({ memberId: 'evebot:person', displayName: 'Person' }) }));
const root = { id: 'root', note: 'Read-only root', authorDisplayName: 'Person', createdAt: 1, status: 'open' } as PreviewComment;
const reply: PreviewCommentReply = { id: 'reply', commentId: 'root', authorMemberId: 'evebot:person', authorDisplayName: 'Person', note: 'Saved reply', createdAt: 1, updatedAt: 1, revision: 1 };
function props() { return { projectId: 'project', comment: root, hidden: false, onDirty: vi.fn(), onClose: vi.fn(), onEditRoot: vi.fn(), onDeleteRoot: vi.fn(), canEditRoot: true, canDeleteRoot: true, existingImages: [] }; }
beforeEach(() => { vi.resetAllMocks(); Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:fixture-' + crypto.randomUUID()) }); Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() }); uploads.prepare.mockResolvedValue({ paths: ['_studio-comments/draft.png'], operationId: 'upload-op' }); api.fetchCommentReplies.mockResolvedValue([]); confirm.mockResolvedValue(false); });
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
it('settles an uncertain create receipt before submitting a newer draft', async () => {
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
  expect(api.createCommentReply.mock.calls[2]![2]).toEqual(api.createCommentReply.mock.calls[0]![2]);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Add reply' })).toBeEnabled());
  api.createCommentReply.mockResolvedValue({ ...reply, note: 'Keep me' });
  fireEvent.click(screen.getByRole('button', { name: 'Retry reply save' }));
  await screen.findByText('Keep me');
  expect(screen.getByRole('textbox')).toHaveValue('Changed draft');
  expect(api.createCommentReply.mock.calls[3]![2]).toEqual(api.createCommentReply.mock.calls[0]![2]);
  api.createCommentReply.mockResolvedValue({ ...reply, id: 'newer', note: 'Changed draft' });
  fireEvent.click(screen.getByRole('button', { name: 'Add reply' }));
  await screen.findByText('Changed draft');
  expect(api.createCommentReply.mock.calls[4]![2].operationId).not.toBe(api.createCommentReply.mock.calls[0]![2].operationId);
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

function attach(name = 'draft.png') {
  const file = new File(['fixture'], name, { type: 'image/png' });
  fireEvent.change(screen.getByLabelText('Reply image files'), { target: { files: [file] } });
  return file;
}
it('saves an image-only reply and replaces the temporary preview with its workspace image', async () => {
  api.createCommentReply.mockImplementation(async (_project, _comment, input) => ({ ...reply, note: input.note, attachments: input.attachments }));
  render(<SavedCommentThread {...props()} />); attach();
  await screen.findByRole('img', { name: 'draft.png' });
  expect(screen.getByRole('button', { name: 'Add reply' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Add reply' }));
  await waitFor(() => expect(api.createCommentReply).toHaveBeenCalledOnce());
  expect(api.createCommentReply.mock.calls[0]![2]).toMatchObject({ note: '', attachments: [{ path: '_studio-comments/draft.png', name: 'draft.png' }] });
  await waitFor(() => expect(screen.getByRole('img', { name: 'draft.png' }).getAttribute('src')).not.toMatch(/^blob:/));
  expect(screen.queryByRole('button', { name: 'Remove draft.png' })).toBeNull();
});
it('preserves images and the operation identity after a refused save', async () => {
  api.createCommentReply.mockRejectedValue(new Error('Save refused'));
  render(<SavedCommentThread {...props()} />); attach();
  await screen.findByRole('img', { name: 'draft.png' }); fireEvent.click(screen.getByRole('button', { name: 'Add reply' }));
  await screen.findByRole('alert'); await waitFor(() => expect(screen.getByRole('button', { name: 'Add reply' })).toBeEnabled());
  expect(screen.getByRole('img', { name: 'draft.png' }).getAttribute('src')).toMatch(/^blob:/);
  fireEvent.click(screen.getByRole('button', { name: 'Add reply' }));
  await waitFor(() => expect(api.createCommentReply).toHaveBeenCalledTimes(2));
  expect(api.createCommentReply.mock.calls[0]![2]).toEqual(api.createCommentReply.mock.calls[1]![2]);
});
it('keeps a newer image and text after an older image submission completes', async () => {
  let complete!: (value: PreviewCommentReply) => void;
  api.createCommentReply.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  render(<SavedCommentThread {...props()} />); attach(); await screen.findByRole('img', { name: 'draft.png' });
  fireEvent.click(screen.getByRole('button', { name: 'Add reply' })); await waitFor(() => expect(api.createCommentReply).toHaveBeenCalledOnce());
  attach('newer.png'); fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Newer text' } });
  await act(async () => complete({ ...reply, note: '', attachments: [{ path: '_studio-comments/draft.png', name: 'draft.png' }] }));
  expect(screen.getByRole('textbox')).toHaveValue('Newer text');
  expect(screen.getByRole('button', { name: 'Remove newer.png' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Remove draft.png' })).toBeNull();
});
it('retains the image when upload fails and never posts a reply without it', async () => {
  uploads.prepare.mockRejectedValue(new Error('Upload failed'));
  render(<SavedCommentThread {...props()} />); attach(); await screen.findByRole('img', { name: 'draft.png' });
  fireEvent.click(screen.getByRole('button', { name: 'Add reply' })); await screen.findByRole('alert');
  expect(api.createCommentReply).not.toHaveBeenCalled(); expect(screen.getByRole('img', { name: 'draft.png' })).toBeVisible();
});
it('removes a saved image through the conditional reply edit', async () => {
  api.fetchCommentReplies.mockResolvedValue([{ ...reply, attachments: [{ path: '_studio-comments/draft.png', name: 'draft.png' }] }]);
  api.editCommentReply.mockResolvedValue({ ...reply, revision: 2, attachments: [] });
  render(<SavedCommentThread {...props()} />); await screen.findByText(reply.note);
  fireEvent.click(screen.getByRole('button', { name: 'Reply actions' })); fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
  await screen.findByRole('button', { name: 'Remove draft.png' }); fireEvent.click(screen.getByRole('button', { name: 'Remove draft.png' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save reply' }));
  await waitFor(() => expect(api.editCommentReply).toHaveBeenCalledWith('project', 'root', reply.id, { note: reply.note, expectedRevision: 1, attachments: [] }, expect.any(AbortSignal)));
});

for (const remoteRemovesB of [false, true]) it(`merges a local image removal with concurrent remote image changes (remote removal: ${remoteRemovesB})`, async () => {
  const a = { path: '_studio-comments/a.png', name: 'a.png' }, b = { path: '_studio-comments/b.png', name: 'b.png' }, c = { path: '_studio-comments/c.png', name: 'c.png' };
  api.fetchCommentReplies.mockResolvedValue([{ ...reply, attachments: [a, b] }]);
  api.editCommentReply.mockRejectedValue(new Error('Reply changed'));
  render(<SavedCommentThread {...props()} />); await screen.findByText(reply.note);
  fireEvent.click(screen.getByRole('button', { name: 'Reply actions' })); fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Remove a.png' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save reply' })); await screen.findByRole('alert');
  const latest = remoteRemovesB ? [a, c] : [a, b, c];
  api.fetchCommentReplies.mockResolvedValue([{ ...reply, attachments: latest, revision: 2 }]);
  fireEvent.click(screen.getByRole('button', { name: 'Reload comments' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Continue editing latest reply' }));
  const expected = remoteRemovesB ? [c] : [b, c];
  api.editCommentReply.mockResolvedValue({ ...reply, attachments: expected, revision: 3 });
  fireEvent.click(screen.getByRole('button', { name: 'Save reply' }));
  await waitFor(() => expect(api.editCommentReply).toHaveBeenLastCalledWith('project', 'root', reply.id, { note: reply.note, expectedRevision: 2, attachments: expected }, expect.any(AbortSignal)));
});

it('does not post a stale image upload after switching threads', async () => {
  let finish!: (value: { paths: string[]; operationId: string }) => void;
  uploads.prepare.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const p = props(); const rendered = render(<SavedCommentThread {...p} />); attach(); await screen.findByRole('img', { name: 'draft.png' });
  fireEvent.click(screen.getByRole('button', { name: 'Add reply' })); await waitFor(() => expect(uploads.prepare).toHaveBeenCalledOnce());
  const signal = uploads.prepare.mock.calls[0]![3] as AbortSignal;
  rendered.rerender(<SavedCommentThread {...p} comment={{ ...root, id: 'other' }} />);
  expect(signal.aborted).toBe(true);
  await act(async () => finish({ paths: ['_studio-comments/late.png'], operationId: 'old-upload' }));
  expect(api.createCommentReply).not.toHaveBeenCalled(); expect(screen.queryByRole('img', { name: 'draft.png' })).toBeNull();
});
it('accepts pasted images and clears the dirty signal when the last image is removed', async () => {
  const p = props(); render(<SavedCommentThread {...p} />);
  fireEvent.paste(screen.getByRole('textbox'), { clipboardData: { files: [new File(['image'], 'pasted.png', { type: 'image/png' })] } });
  await screen.findByRole('img', { name: 'pasted.png' }); expect(p.onDirty).toHaveBeenLastCalledWith(true);
  fireEvent.click(screen.getByRole('button', { name: 'Remove pasted.png' }));
  await waitFor(() => expect(p.onDirty).toHaveBeenLastCalledWith(false));
  expect(api.createCommentReply).not.toHaveBeenCalled();
});
it('rejects unsupported pasted content without replacing an existing image draft', async () => {
  render(<SavedCommentThread {...props()} />); attach(); await screen.findByRole('img', { name: 'draft.png' });
  fireEvent.paste(screen.getByRole('textbox'), { clipboardData: { files: [new File(['html'], 'fake.png', { type: 'text/html' })] } });
  await screen.findByRole('alert'); expect(screen.getByRole('img', { name: 'draft.png' })).toBeVisible();
  expect(screen.queryByRole('img', { name: 'fake.png' })).toBeNull(); expect(api.createCommentReply).not.toHaveBeenCalled();
});
it('keeps an edited reply draft as a new reply only after an explicit recovery action', async () => {
  api.fetchCommentReplies.mockResolvedValue([reply]); api.editCommentReply.mockRejectedValue(new Error('Reply removed'));
  render(<SavedCommentThread {...props()} />); await screen.findByText(reply.note);
  fireEvent.click(screen.getByRole('button', { name: 'Reply actions' })); fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Recover this text' } }); fireEvent.click(screen.getByRole('button', { name: 'Save reply' }));
  await screen.findByRole('alert'); api.fetchCommentReplies.mockResolvedValue([]);
  fireEvent.click(screen.getByRole('button', { name: 'Reload comments' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Keep draft as a new reply' }));
  expect(screen.getByRole('textbox', { name: 'Reply' })).toHaveValue('Recover this text'); expect(api.createCommentReply).not.toHaveBeenCalled();
});

it('retries the exact uncertain image reply before consuming only its original files', async () => {
  api.createCommentReply.mockRejectedValueOnce(new Error('Response lost'));
  const p = props(); render(<SavedCommentThread {...p} />);
  const first = new File(['first'], 'first.png', { type: 'image/png' });
  const later = new File(['later'], 'later.png', { type: 'image/png' });
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Original note' } });
  fireEvent.change(screen.getByLabelText('Reply image files'), { target: { files: [first] } });
  fireEvent.click(screen.getByRole('button', { name: 'Add reply' }));
  await screen.findByRole('alert');
  const input = api.createCommentReply.mock.calls[0]![2];
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Newer note' } });
  fireEvent.change(screen.getByLabelText('Reply image files'), { target: { files: [later] } });
  api.createCommentReply.mockResolvedValue({ ...reply, note: input.note, attachments: input.attachments });
  fireEvent.click(screen.getByRole('button', { name: 'Retry reply save' }));
  await screen.findByText('Original note');
  expect(api.createCommentReply.mock.calls[1]![2]).toEqual(input);
  expect(uploads.prepare).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('textbox')).toHaveValue('Newer note');
  expect(screen.getByRole('button', { name: 'Remove later.png' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Remove first.png' })).toBeNull();
});
it('keeps an uncertain reply retry and discard guard when newer text is cleared', async () => {
  api.createCommentReply.mockRejectedValueOnce(new Error('Response lost'));
  const p = props(); render(<SavedCommentThread {...p} />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Original note' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add reply' }));
  await screen.findByRole('alert');
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } });
  expect(p.onDirty).toHaveBeenLastCalledWith(true);
  expect(screen.getByRole('button', { name: 'Retry reply save' })).toBeEnabled();
  api.createCommentReply.mockResolvedValue({ ...reply, note: 'Original note' });
  fireEvent.click(screen.getByRole('button', { name: 'Retry reply save' }));
  await screen.findByText('Original note');
  expect(screen.getByRole('textbox')).toHaveValue('');
});

it('uses the deletion notice for an initial expected 404 without clearing the reply draft', async () => {
  api.fetchCommentReplies.mockRejectedValue(new CommentReplyError(404));
  render(<SavedCommentThread {...props()} deleted />);
  const input = screen.getByRole('textbox', { name: 'Reply' });
  fireEvent.change(input, { target: { value: 'Keep the deleted thread draft' } });
  await waitFor(() => expect(screen.queryByText('Loading comments…')).toBeNull());
  expect(screen.getByText('This thread was deleted. Your unsaved reply is still here.')).toBeVisible();
  expect(screen.queryByText('Comments could not be loaded.')).toBeNull();
  expect(input).toHaveValue('Keep the deleted thread draft');
  expect(screen.getByRole('button', { name: 'Add reply' })).toBeDisabled();
  expect(api.createCommentReply).not.toHaveBeenCalled();
});

it('reconciles a polling 404 only after deletion is known and keeps later server failures visible', async () => {
  vi.useFakeTimers(); vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  const p = props(); let view!: ReturnType<typeof render>;
  await act(async () => { view = render(<SavedCommentThread {...p} />); });
  const input = screen.getByRole('textbox', { name: 'Reply' });
  fireEvent.change(input, { target: { value: 'Same pending reply' } });
  api.fetchCommentReplies.mockRejectedValue(new CommentReplyError(404));
  await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
  expect(screen.getByText('Comments could not be loaded.')).toBeVisible();
  view.rerender(<SavedCommentThread {...p} deleted />);
  expect(screen.queryByText('Comments could not be loaded.')).toBeNull();
  expect(screen.getByRole('textbox', { name: 'Reply' })).toBe(input);
  expect(input).toHaveValue('Same pending reply');
  api.fetchCommentReplies.mockRejectedValue(new CommentReplyError(500));
  await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
  expect(screen.getByText('Comments could not be loaded.')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Reload comments' })).toBeEnabled();
  expect(input).toHaveValue('Same pending reply'); expect(api.createCommentReply).not.toHaveBeenCalled();
});

it.each([new CommentReplyError(403), new CommentReplyError(500), new Error('Offline')])('does not hide an unexpected read failure for a deleted thread: %s', async failure => {
  api.fetchCommentReplies.mockRejectedValue(failure);
  render(<SavedCommentThread {...props()} deleted />);
  expect(await screen.findByText('Comments could not be loaded.')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Reload comments' })).toBeEnabled();
});

it('keeps a failed write visible when deletion is subsequently confirmed', async () => {
  api.createCommentReply.mockRejectedValue(new CommentReplyError(404));
  const p = props(), view = render(<SavedCommentThread {...p} />);
  const input = screen.getByRole('textbox', { name: 'Reply' });
  fireEvent.change(input, { target: { value: 'Unsaved after write refusal' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add reply' }));
  expect(await screen.findByText('The reply could not be saved. Your draft is still available.')).toBeVisible();
  view.rerender(<SavedCommentThread {...p} deleted />);
  expect(screen.getByText('The reply could not be saved. Your draft is still available.')).toBeVisible();
  expect(input).toHaveValue('Unsaved after write refusal'); expect(screen.getByRole('button', { name: 'Add reply' })).toBeDisabled();
});

it.each([403, 404])('keeps a definite write %s failure through successful quiet reads and explicit reload', async status => {
  vi.useFakeTimers(); vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  api.createCommentReply.mockRejectedValue(new CommentReplyError(status));
  await act(async () => { render(<SavedCommentThread {...props()} />); });
  const input = screen.getByRole('textbox', { name: 'Reply' });
  fireEvent.change(input, { target: { value: 'Keep this refused write' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add reply' })); });
  const message = 'The reply could not be saved. Your draft is still available.';
  expect(screen.getByText(message)).toBeVisible();
  await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
  expect(api.fetchCommentReplies).toHaveBeenCalledTimes(2);
  expect(screen.getByText(message)).toBeVisible(); expect(input).toHaveValue('Keep this refused write');
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Reload comments' })); });
  expect(api.fetchCommentReplies).toHaveBeenCalledTimes(3);
  expect(screen.getByText(message)).toBeVisible(); expect(input).toHaveValue('Keep this refused write');
  api.createCommentReply.mockResolvedValue({ ...reply, note: 'Keep this refused write' });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add reply' })); });
  expect(screen.queryByText(message)).toBeNull(); expect(input).toHaveValue('');
  expect(screen.getByText('Keep this refused write')).toBeVisible();
});

it('clears a read failure after a successful explicit reload without writing a reply', async () => {
  api.fetchCommentReplies.mockRejectedValueOnce(new CommentReplyError(500));
  render(<SavedCommentThread {...props()} />);
  expect(await screen.findByText('Comments could not be loaded.')).toBeVisible();
  api.fetchCommentReplies.mockResolvedValue([]);
  fireEvent.click(screen.getByRole('button', { name: 'Reload comments' }));
  await waitFor(() => expect(screen.queryByText('Comments could not be loaded.')).toBeNull());
  expect(api.createCommentReply).not.toHaveBeenCalled();
});

it('keeps attachment validation feedback through reads until the attachment action resolves it', async () => {
  vi.useFakeTimers(); vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  await act(async () => { render(<SavedCommentThread {...props()} />); });
  const picker = screen.getByLabelText('Reply image files');
  fireEvent.change(picker, { target: { files: [new File(['bad'], 'unsafe.txt', { type: 'text/plain' })] } });
  expect(screen.getByText('Use PNG, JPEG, GIF or WebP images.')).toBeVisible();
  await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
  expect(screen.getByText('Use PNG, JPEG, GIF or WebP images.')).toBeVisible();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Reload comments' })); });
  expect(screen.getByText('Use PNG, JPEG, GIF or WebP images.')).toBeVisible();
  fireEvent.change(picker, { target: { files: [new File(['png'], 'safe.png', { type: 'image/png' })] } });
  expect(screen.queryByText('Use PNG, JPEG, GIF or WebP images.')).toBeNull();
  expect(api.createCommentReply).not.toHaveBeenCalled();
});
