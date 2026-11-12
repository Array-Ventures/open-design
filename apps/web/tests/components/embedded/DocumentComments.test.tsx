// @vitest-environment jsdom
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { $getRoot, $isTextNode, type LexicalEditor } from 'lexical';
import type { PreviewComment } from '@open-design/contracts';
import { DocumentSurface } from '../../../src/components/embedded/document/DocumentSurface';
import { DocumentEditor } from '../../../src/components/embedded/document/DocumentEditor';
import { documentHtml } from '../../../src/components/embedded/document/document-html';
import { readDocumentCommentAnchor, documentCommentTarget } from '../../../src/components/embedded/document/document-comment-anchor';
import { CommentReviewProvider } from '../../../src/components/embedded/CommentReview';
const api = vi.hoisted(() => ({ read: vi.fn(), documentSave: vi.fn(), save: vi.fn(), send: vi.fn(), confirm: vi.fn(), remove: vi.fn(), status: vi.fn(), replies: vi.fn(), createReply: vi.fn(), editReply: vi.fn(), deleteReply: vi.fn() }));
vi.mock('../../../src/components/embedded/host-viewer', () => ({ useEmbeddedViewer: () => ({ memberId: 'evebot:person', displayName: 'Person' }), useEmbeddedMentionBots: () => [{ id: 'chief', name: 'Chief' }] }));
vi.mock('../../../src/components/embedded/host-context', () => ({ confirmHostFeedbackDiscard: api.confirm }));
vi.mock('../../../src/components/embedded/document/document-file', () => ({ saveDocumentFile: api.documentSave, readDocumentFile: api.read }));
vi.mock('../../../src/components/embedded/comment-reply-api', async original => ({ ...await original<object>(), fetchCommentReplies: api.replies, createCommentReply: api.createReply, editCommentReply: api.editReply, deleteCommentReply: api.deleteReply }));
const imageUpload = vi.hoisted(() => vi.fn());
vi.mock('../../../src/components/embedded/document/document-image-upload', () => ({ uploadDocumentImage: imageUpload }));
const originalParent = Object.getOwnPropertyDescriptor(window, 'parent');
const host = { postMessage: vi.fn() };
const observed = { html: documentHtml('Report', '<p data-od-id="body">Ready for review</p>'), sha256: 'original' };
function editor(): LexicalEditor { return (screen.getByRole('textbox', { name: 'Report' }) as HTMLElement & { __lexicalEditor: LexicalEditor }).__lexicalEditor; }
function command(action: string, overrides = {}) {
  const state = host.postMessage.mock.calls.filter(call => call[0].type === 'studio:feedback-state').at(-1)![0];
  act(() => window.dispatchEvent(new MessageEvent('message', { source: host as unknown as Window, origin: window.location.origin, data: { type: 'studio:feedback-control', projectId: 'project', controllerId: state.controllerId, action, ...overrides } })));
}
function Harness({ initial = [] }: { initial?: PreviewComment[] }) {
  const [comments, update] = useState(initial);
  return <CommentReviewProvider projectId="project" changeStatus={async (id, status) => { api.status(id, status); update(current => current.map(comment => comment.id === id ? { ...comment, status } : comment)); return true; }}>
    <DocumentEditor projectId="project" fileName="report.html" title="Report" observed={observed} onSaved={() => {}} feedback={{ previewComments: comments, previewCommentsState: 'success', onSavePreviewComment: async (...args) => {
      const saved = await api.save(...args); if (saved) update(current => [...current.filter(comment => comment.id !== saved.id), saved]); return saved;
    }, onRemovePreviewComment: async id => { api.remove(id); update(current => current.filter(comment => comment.id !== id)); return true; }, onSendBoardCommentAttachments: api.send }} />
  </CommentReviewProvider>;
}
beforeEach(() => {
  Object.defineProperty(window, 'parent', { configurable: true, value: host });
  api.replies.mockResolvedValue([]); api.confirm.mockResolvedValue(false); api.send.mockResolvedValue({ status: 'queued', commentIds: ['root'] });
  api.save.mockImplementation(async (target, note) => ({ ...target, id: 'root', projectId: 'project', conversationId: 'project', note, status: 'open', authorMemberId: 'evebot:person', authorDisplayName: 'Person', createdAt: 1, updatedAt: 1, editToken: 'token' }));
});
afterEach(() => { cleanup(); vi.clearAllMocks(); if (originalParent) Object.defineProperty(window, 'parent', originalParent); });
async function selectAndOpen() {
  act(() => editor().update(() => { const text = $getRoot().getFirstDescendant()!; if ($isTextNode(text)) text.select(0, 5); }, { discrete: true }));
  command('comment'); return screen.findByRole('textbox', { name: 'Comment on selected text' });
}
it('saves exact structured selection with mentions, opens the real reply thread and stages contextual chat', async () => {
  render(<Harness />);
  const input = await selectAndOpen(); fireEvent.change(input, { target: { value: '@Ch' } }); fireEvent.input(input); fireEvent.select(input, { target: { selectionStart: 3 } });
  expect(await screen.findByRole('option', { name: 'Chief' })).toBeTruthy();
  fireEvent.keyDown(input, { key: 'Enter' }); expect(input).toHaveValue('@Chief ');
  fireEvent.change(input, { target: { value: '@Chief revise this' } }); fireEvent.click(screen.getByRole('button', { name: 'Save comment' }));
  await screen.findByText('@Chief revise this'); expect(api.save).toHaveBeenCalledTimes(1);
  const target = api.save.mock.calls[0]![0]; expect(readDocumentCommentAnchor(target)?.quote).toBe('Ready'); expect(target.filePath).toBe('report.html');
  expect(host.postMessage.mock.calls.filter(call => call[0].type === 'studio:feedback-state').at(-1)![0]).toMatchObject({ markupAvailable: false, commentsAvailable: true });
  await screen.findByRole('textbox', { name: 'Reply' });
  fireEvent.click(screen.getByRole('button', { name: 'Add comment to chat' }));
  await waitFor(() => expect(api.send).toHaveBeenCalledTimes(1)); expect(api.documentSave).not.toHaveBeenCalled(); expect(api.send.mock.calls[0]![0][0]).toMatchObject({ comment: '@Chief revise this', currentText: 'Ready', filePath: 'report.html' });
});
it('preserves unsent root draft when close is refused and rejects a stale controller', async () => {
  render(<Harness />); command('comment', { controllerId: 'stale' }); expect(screen.queryByRole('dialog')).toBeNull();
  const input = await selectAndOpen(); fireEvent.change(input, { target: { value: 'Keep this draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'Close comments' }));
  await waitFor(() => expect(api.confirm).toHaveBeenCalledWith('project', 'comment'));
  expect(input).toHaveValue('Keep this draft');
  act(() => { editor().update(() => { const text = $getRoot().getFirstDescendant(); if ($isTextNode(text)) text.setTextContent('Changed document'); }, { discrete: true }); });
  expect(screen.getByText('The selected text changed. The original selection is retained.')).toBeTruthy();
  expect(input).toHaveValue('Keep this draft');
});
it('keeps newer typing while an earlier root save completes', async () => {
  let finish!: (comment: PreviewComment) => void;
  api.save.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(<Harness />); const input = await selectAndOpen(); fireEvent.change(input, { target: { value: 'First' } }); fireEvent.click(screen.getByRole('button', { name: 'Save comment' }));
  await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1)); fireEvent.change(input, { target: { value: 'Newer draft' } });
  await act(async () => finish({ ...api.save.mock.calls[0]![0], id: 'root', projectId: 'project', conversationId: 'project', note: 'First', status: 'open', authorMemberId: 'evebot:person', createdAt: 1, updatedAt: 1, editToken: 'token' }));
  expect(screen.getByRole('textbox', { name: 'Comment on selected text' })).toHaveValue('Newer draft');
});

it('supports root/reply edits, deletion, resolution and reopening through the existing authorized thread controls', async () => {
  render(<Harness />); const input = await selectAndOpen(); fireEvent.change(input, { target: { value: 'Root note' } }); fireEvent.click(screen.getByRole('button', { name: 'Save comment' }));
  const replyInput = await screen.findByRole('textbox', { name: 'Reply' });
  const reply = { id: 'reply', commentId: 'root', authorMemberId: 'evebot:person', authorDisplayName: 'Person', note: 'Reply one', createdAt: 1, updatedAt: 1, revision: 1 };
  api.createReply.mockResolvedValue(reply); fireEvent.change(replyInput, { target: { value: 'Reply one' } }); fireEvent.click(screen.getByRole('button', { name: 'Add reply' }));
  await screen.findByText('Reply one'); expect(api.createReply.mock.calls[0]![2]).toMatchObject({ note: 'Reply one', operationId: expect.any(String) });
  fireEvent.click(screen.getByRole('button', { name: 'Reply actions' })); fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Edit reply' }), { target: { value: 'Reply two' } }); api.editReply.mockResolvedValue({ ...reply, note: 'Reply two', revision: 2 });
  fireEvent.click(screen.getByRole('button', { name: 'Save reply' })); await screen.findByText('Reply two'); expect(api.editReply.mock.calls[0]![3]).toMatchObject({ expectedRevision: 1, note: 'Reply two' });
  fireEvent.click(screen.getByRole('button', { name: 'Reply actions' })); api.deleteReply.mockResolvedValue(true); fireEvent.click(await screen.findByRole('button', { name: 'Delete reply' }));
  await waitFor(() => expect(screen.queryByText('Reply two')).toBeNull()); expect(api.deleteReply.mock.calls[0]![3]).toBe(2);
  fireEvent.click(screen.getByRole('button', { name: 'Comment actions' })); fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Comment on selected text' }), { target: { value: 'Edited root' } }); fireEvent.click(screen.getByRole('button', { name: 'Save comment' }));
  await screen.findByText('Edited root'); expect(api.save.mock.calls[1]![4]).toBe('root'); expect(api.save.mock.calls[1]![5]).toMatchObject({ editToken: 'token' });
  fireEvent.click(screen.getByRole('button', { name: 'Resolve comment' })); await waitFor(() => expect(api.status).toHaveBeenCalledWith('root', 'resolved'));
  command('comments'); await screen.findByText('No open comments.');
  fireEvent.click(screen.getByRole('button', { name: 'Filter comments' })); fireEvent.click(await screen.findByRole('button', { name: 'Show resolved' }));
  fireEvent.click(await screen.findByRole('button', { name: /Edited root/ })); await screen.findByRole('textbox', { name: 'Reply' });
  fireEvent.click(screen.getByRole('button', { name: 'Comment actions' })); fireEvent.click(await screen.findByRole('button', { name: 'Reopen' })); await waitFor(() => expect(api.status).toHaveBeenCalledWith('root', 'open'));
  fireEvent.click(screen.getByRole('button', { name: 'Comment actions' })); fireEvent.click(await screen.findByRole('button', { name: 'Delete thread' })); await waitFor(() => expect(api.remove).toHaveBeenCalledWith('root'));
});

it('captures real DOM selection in Viewing mode without enabling editing', async () => {
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Editing, mode' })); fireEvent.click(await screen.findByRole('button', { name: 'Viewing' }));
  expect(editor().isEditable()).toBe(false);
  const text = screen.getByRole('textbox', { name: 'Report' }).querySelector('p')!.firstChild!.firstChild!;
  const range = document.createRange(); range.setStart(text, 6); range.setEnd(text, 9);
  act(() => { window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range); document.dispatchEvent(new Event('selectionchange')); });
  command('comment'); await screen.findByRole('textbox', { name: 'Comment on selected text' }); expect(screen.getByText('for')).toBeTruthy(); expect(editor().isEditable()).toBe(false);
});
it('retains an unsent comment while an agent refreshes the document source', async () => {
  api.read.mockResolvedValueOnce(observed).mockResolvedValue({ html: documentHtml('Report', '<p data-od-id="body">Agent replaced body</p>'), sha256: 'changed' });
  const feedback = { previewComments: [], previewCommentsState: 'success' as const, onSavePreviewComment: api.save };
  const view = render(<DocumentSurface projectId="project" fileName="report.html" title="Report" generation={0} fallback={<div>Fallback</div>} onSaved={() => {}} feedback={feedback} />);
  await screen.findByRole('textbox', { name: 'Report' }); const input = await selectAndOpen(); fireEvent.change(input, { target: { value: 'Keep draft during refresh' } });
  await waitFor(() => expect(host.postMessage.mock.calls.filter(call => call[0].type === 'studio:feedback-state').at(-1)![0].dirty).toBe(true));
  view.rerender(<DocumentSurface projectId="project" fileName="report.html" title="Report" generation={1} fallback={<div>Fallback</div>} onSaved={() => {}} feedback={feedback} />);
  await screen.findByText('Document changed elsewhere.'); expect(input).toHaveValue('Keep draft during refresh'); expect(screen.getByRole('textbox', { name: 'Report' })).toHaveTextContent('Ready for review');
});
it('shows a foreign-author thread without root edit/delete/resolve privileges', async () => {
  const target = documentCommentTarget('report.html', { version: 1, start: { block: 'body', offset: 0 }, end: { block: 'body', offset: 5 }, quote: 'Ready' });
  render(<Harness initial={[{ ...target, id: 'foreign', projectId: 'project', conversationId: 'project', note: 'Foreign root', status: 'open', authorMemberId: 'evebot:other', authorDisplayName: 'Other', createdAt: 1, updatedAt: 1 }]} />);
  command('comments'); fireEvent.click(await screen.findByRole('button', { name: /Foreign root/ })); await screen.findByRole('textbox', { name: 'Reply' });
  expect(screen.queryByRole('button', { name: 'Resolve comment' })).toBeNull(); expect(screen.queryByRole('button', { name: 'Comment actions' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Comment actions' })); expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull(); expect(screen.queryByRole('button', { name: 'Delete thread' })).toBeNull(); expect(screen.queryByRole('button', { name: 'Add comment to chat' })).toBeNull();
});

it('keeps a saved-but-unhanded comment dirty until its contextual chat handoff is retried', async () => {
  const normal = api.save.getMockImplementation()!;
  api.save.mockImplementationOnce(async (...args) => ({ ...await normal(...args), handoffPending: true }));
  render(<Harness />); const input = await selectAndOpen(); fireEvent.change(input, { target: { value: 'Saved but not handed off' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save comment and add to chat' }));
  await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1));
  expect(input).toHaveValue('Saved but not handed off');
  await waitFor(() => expect(host.postMessage.mock.calls.filter(call => call[0].type === 'studio:feedback-state').at(-1)![0].dirty).toBe(true));
  fireEvent.click(screen.getByRole('button', { name: 'Save comment and add to chat' }));
  await screen.findByRole('textbox', { name: 'Reply' }); expect(api.save.mock.calls[1]![4]).toBe('root'); expect(api.save.mock.calls[1]![2]).toBe(true);
});

it('refuses a confirmed reload if a newer comment draft was typed during that confirmation', async () => {
  api.read.mockResolvedValue(observed);
  const feedback = { previewComments: [], previewCommentsState: 'success' as const, onSavePreviewComment: api.save };
  const view = render(<DocumentSurface projectId="project" fileName="report.html" title="Report" generation={0} fallback={<div>Fallback</div>} onSaved={() => {}} feedback={feedback} />);
  await screen.findByRole('textbox', { name: 'Report' }); const input = await selectAndOpen(); fireEvent.change(input, { target: { value: 'Old draft' } });
  api.read.mockResolvedValue({ html: documentHtml('Report', '<p data-od-id="body">Agent replaced body</p>'), sha256: 'changed' });
  view.rerender(<DocumentSurface projectId="project" fileName="report.html" title="Report" generation={1} fallback={<div>Fallback</div>} onSaved={() => {}} feedback={feedback} />);
  await screen.findByText('Document changed elsewhere.');
  let confirm!: (value: boolean) => void; api.confirm.mockImplementationOnce(() => new Promise(resolve => { confirm = resolve; }));
  fireEvent.click(screen.getByRole('button', { name: 'Load latest document' })); await waitFor(() => expect(api.confirm).toHaveBeenCalled());
  fireEvent.change(input, { target: { value: 'Newer draft' } });
  await act(async () => confirm(true));
  expect(input).toHaveValue('Newer draft'); expect(screen.getByRole('textbox', { name: 'Report' })).toHaveTextContent('Ready for review');
});

it('does not reuse an old selection after a person collapses the document selection', async () => {
  render(<Harness />); await selectAndOpen(); fireEvent.click(screen.getByRole('button', { name: 'Close comments' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Document comments' })).toBeNull());
  act(() => editor().update(() => { $getRoot().getFirstDescendant()!.selectEnd(); }, { discrete: true }));
  command('comment'); await screen.findByText('Select text in the document to comment.');
  expect(screen.queryByRole('textbox', { name: 'Comment on selected text' })).toBeNull();
});

it.each(['html', 'markdown'] as const)('reopens a comment-only %s document with stable identities without writing its source', async format => {
  const { readMarkdownDocument } = await import('../../../src/components/embedded/document/markdown-document');
  const source = format === 'markdown' ? { ...await readMarkdownDocument('Ready for review', 'Report'), sha256: 'same-source', format } : { html: documentHtml('Report', '<p>Ready for review</p>'), sha256: 'same-source', format };
  const feedback = { previewComments: [] as PreviewComment[], previewCommentsState: 'success' as const, onSavePreviewComment: api.save };
  const first = render(<DocumentEditor projectId="project" fileName={`report.${format === 'html' ? 'html' : 'md'}`} title="Report" observed={source} onSaved={() => {}} feedback={feedback} />);
  const input = await selectAndOpen(); fireEvent.change(input, { target: { value: 'Reopen me' } }); fireEvent.click(screen.getByRole('button', { name: 'Save comment' }));
  await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1)); const saved = await api.save.mock.results[0]!.value;
  expect(api.documentSave).not.toHaveBeenCalled(); first.unmount(); host.postMessage.mockClear();
  render(<DocumentEditor projectId="project" fileName={`report.${format === 'html' ? 'html' : 'md'}`} title="Report" observed={source} onSaved={() => {}} feedback={{ ...feedback, previewComments: [saved] }} />);
  command('comments'); fireEvent.click(await screen.findByRole('button', { name: /Reopen me/ })); await screen.findByRole('textbox', { name: 'Reply' });
  expect(screen.queryByText('The selected text changed or was removed. The saved thread is still available.')).toBeNull();
  expect(api.documentSave).not.toHaveBeenCalled();
});

it('does not let an older close confirmation discard newly typed comment text', async () => {
  render(<Harness />); const input = await selectAndOpen(); fireEvent.change(input, { target: { value: 'Before confirmation' } });
  let finish!: (value: boolean) => void; api.confirm.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  fireEvent.click(screen.getByRole('button', { name: 'Close comments' })); await waitFor(() => expect(api.confirm).toHaveBeenCalled());
  fireEvent.change(input, { target: { value: 'Typed during confirmation' } }); await act(async () => finish(true));
  expect(input).toHaveValue('Typed during confirmation'); expect(screen.getByRole('dialog', { name: 'Document comments' })).toBeTruthy();
});

it('reopens and edits a saved long multiline quote beyond the generic database excerpt', async () => {
  const quote = ('Exact  spaces\nUnicode 😀 selected text.\n').repeat(10) + 'Quoted tail beyond the old 160-character cap';
  const target = documentCommentTarget('report.html', { version: 1, start: { block: 'body', offset: 0 }, end: { block: 'body', offset: quote.length }, quote });
  const saved: PreviewComment = { ...target, id: 'long-root', projectId: 'project', conversationId: 'project', note: 'Long root', status: 'open', authorMemberId: 'evebot:person', authorDisplayName: 'Person', createdAt: 1, updatedAt: 1, text: quote.replace(/\s+/g, ' ').slice(0, 160) };
  const source = { html: documentHtml('Report', '<p data-od-id="body">' + quote.replace(/\n/g, '<br>') + '</p>'), sha256: 'source' };
  render(<CommentReviewProvider projectId="project" changeStatus={async () => true}><DocumentEditor projectId="project" fileName="report.html" title="Report" observed={source} onSaved={() => {}} feedback={{ previewComments: [saved], previewCommentsState: 'success', onSavePreviewComment: api.save }} /></CommentReviewProvider>);
  command('comments'); const row = await screen.findByRole('button', { name: /Long root/ }); expect(row.textContent).toContain(quote);
  fireEvent.click(row); await screen.findByRole('textbox', { name: 'Reply' });
  expect(screen.getByRole('dialog', { name: 'Document comments' }).querySelector('blockquote')!.textContent).toBe(quote);
  fireEvent.click(screen.getByRole('button', { name: 'Comment actions' })); fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
  await screen.findByRole('textbox', { name: 'Comment on selected text' });
  expect(screen.getByRole('dialog', { name: 'Document comments' }).querySelector('blockquote')!.textContent).toBe(quote);
});

it.each(['ltr', 'rtl'])('resizes the comments pane with logical keyboard directions in %s', async direction => {
  render(<Harness />); command('comments'); const separator = await screen.findByRole('separator', { name: 'Resize document comments' });
  separator.style.direction = direction;
  expect(separator).toHaveAttribute('aria-valuenow', '320');
  fireEvent.keyDown(separator, { key: 'ArrowLeft' }); expect(separator).toHaveAttribute('aria-valuenow', direction === 'rtl' ? '304' : '336');
  fireEvent.keyDown(separator, { key: 'ArrowRight' }); expect(separator).toHaveAttribute('aria-valuenow', '320');
  fireEvent.keyDown(separator, { key: 'Home' }); expect(separator).toHaveAttribute('aria-valuenow', '240');
  fireEvent.keyDown(separator, { key: 'End' }); expect(separator).toHaveAttribute('aria-valuenow', '480');
});

it('withdraws document formatting while reviewing comments and restores it after close', async () => {
  render(<Harness />);
  expect(screen.getByRole('toolbar', { name: 'Document insertion' })).toBeTruthy();
  await selectAndOpen();
  await waitFor(() => expect(screen.queryByRole('toolbar', { name: 'Document insertion' })).toBeNull());
  expect(editor().isEditable()).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Close comments' }));
  await waitFor(() => expect(screen.getByRole('toolbar', { name: 'Document insertion' })).toBeTruthy());
  expect(api.documentSave).not.toHaveBeenCalled();
});

it('keeps a pending image upload and its receipt through comment visibility changes', async () => {
  let finish!: (value: { name: string; alt: string; width: number; height: number }) => void;
  imageUpload.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Image' }));
  fireEvent.change(screen.getByLabelText('Choose document image'), { target: { files: [new File(['fixture'], 'figure.png', { type: 'image/png' })] } });
  const signal = imageUpload.mock.calls.at(-1)![2] as AbortSignal;
  // A newer edit makes automatic insertion inappropriate: retain its receipt.
  act(() => editor().update(() => { const text = $getRoot().getFirstDescendant()!; if ($isTextNode(text)) text.setTextContent('Ready for review updated'); }, { discrete: true }));
  await selectAndOpen();
  expect(signal.aborted).toBe(false);
  await act(async () => finish({ name: '_studio-document-assets/figure.png', alt: 'Retained upload', width: 400, height: 200 }));
  expect(screen.getByText('Image uploaded. Choose a location, then select Image to insert.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Close comments' }));
  const insert = await screen.findByRole('button', { name: 'Insert uploaded image' });
  fireEvent.click(insert);
  expect(await screen.findByRole('img', { name: 'Retained upload' })).toBeTruthy();
  expect(imageUpload).toHaveBeenCalledTimes(1);
});
