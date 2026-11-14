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
const api = vi.hoisted(() => ({ viewer: true, read: vi.fn(), documentSave: vi.fn(), save: vi.fn(), send: vi.fn(), confirm: vi.fn(), remove: vi.fn(), status: vi.fn(), replies: vi.fn(), createReply: vi.fn(), editReply: vi.fn(), deleteReply: vi.fn() }));
vi.mock('../../../src/components/embedded/host-viewer', () => ({ useEmbeddedViewer: () => api.viewer ? ({ memberId: 'evebot:person', displayName: 'Person' }) : null, useEmbeddedMentionBots: () => [{ id: 'chief', name: 'Chief' }] }));
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
function Harness({ initial = [], documentObserved = observed }: { initial?: PreviewComment[]; documentObserved?: typeof observed }) {
  const [comments, update] = useState(initial);
  return <CommentReviewProvider projectId="project" changeStatus={async (id, status) => { api.status(id, status); update(current => current.map(comment => comment.id === id ? { ...comment, status } : comment)); return true; }}>
    <DocumentEditor projectId="project" fileName="report.html" title="Report" observed={documentObserved} onSaved={() => {}} feedback={{ previewComments: comments, previewCommentsState: 'success', onSavePreviewComment: async (...args) => {
      const saved = await api.save(...args); if (saved) update(current => [...current.filter(comment => comment.id !== saved.id), saved]); return saved;
    }, onRemovePreviewComment: async id => { api.remove(id); update(current => current.filter(comment => comment.id !== id)); return true; }, onSendBoardCommentAttachments: api.send }} />
  </CommentReviewProvider>;
}
beforeEach(() => {
  api.viewer = true;
  Object.defineProperty(window, 'parent', { configurable: true, value: host });
  api.replies.mockResolvedValue([]); api.confirm.mockResolvedValue(false); api.send.mockResolvedValue({ status: 'queued', commentIds: ['root'] });
  api.save.mockImplementation(async (target, note) => ({ ...target, id: 'root', projectId: 'project', conversationId: 'project', note, status: 'open', authorMemberId: 'evebot:person', authorDisplayName: 'Person', createdAt: 1, updatedAt: 1, editToken: 'token' }));
});
afterEach(() => { cleanup(); vi.clearAllMocks(); if (originalParent) Object.defineProperty(window, 'parent', originalParent); });
async function selectAndOpen() {
  const root = screen.getByRole('textbox', { name: 'Report' }), text = document.createTreeWalker(root, NodeFilter.SHOW_TEXT).nextNode()!;
  const range = document.createRange(); range.setStart(text, 0); range.setEnd(text, Math.min(5, text.textContent!.length));
  act(() => { window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range); document.dispatchEvent(new Event('selectionchange')); });
  fireEvent(root, new MouseEvent('pointerup', { bubbles: true, button: 0 }));
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
  fireEvent(screen.getByRole('textbox', { name: 'Report' }), new MouseEvent('pointerup', { bubbles: true, button: 0 }));
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
  fireEvent.click(screen.getByRole('checkbox', { name: 'Add to chat' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save comment' }));
  await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1));
  expect(input).toHaveValue('Saved but not handed off');
  await waitFor(() => expect(host.postMessage.mock.calls.filter(call => call[0].type === 'studio:feedback-state').at(-1)![0].dirty).toBe(true));
  expect(screen.getByRole('checkbox', { name: 'Add to chat' })).toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: 'Save comment' }));
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
  command('comment'); await screen.findByText('No comments yet. Select text to add one.');
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
  expect(document.getElementById(screen.getByRole('textbox', { name: 'Comment on selected text' }).getAttribute('aria-describedby')!)!.textContent).toBe(quote);
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

it('keeps unsent selected-text feedback and the same editor while navigating a document section', async () => {
  const documentObserved = { ...observed, html: documentHtml('Report', '<h1 data-od-id="intro">Intro</h1><p data-od-id="body">Body</p><h2 data-od-id="next">Next section</h2>') };
  render(<Harness documentObserved={documentObserved} />);
  const active = editor(), content = screen.getByRole('textbox', { name: 'Report' });
  const input = await selectAndOpen(); fireEvent.change(input, { target: { value: 'Unsent section feedback' } });
  const before = input.getAttribute('aria-describedby');
  const quote = document.getElementById(before!)!;
  fireEvent.click(screen.getByRole('button', { name: 'Document outline' }));
  fireEvent.click(screen.getByRole('button', { name: 'Section 2, heading level 2: Next section' }));
  await waitFor(() => expect(content.querySelector('h2')).toHaveFocus());
  expect(editor()).toBe(active); expect(screen.getByRole('textbox', { name: 'Report' })).toBe(content);
  expect(input).toHaveValue('Unsent section feedback'); expect(input).toHaveAccessibleDescription(quote.textContent!);
  expect(api.save).not.toHaveBeenCalled(); expect(api.documentSave).not.toHaveBeenCalled(); expect(api.send).not.toHaveBeenCalled();
});

it('returns from All comments to the same thread without discarding its unsent reply', async () => {
  render(<Harness />);
  const input = await selectAndOpen();
  fireEvent.change(input, { target: { value: 'Retained thread' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save comment' }));
  const reply = await screen.findByRole('textbox', { name: 'Reply' });
  fireEvent.change(reply, { target: { value: 'Keep this unsent reply' } });
  const thread = screen.getByTestId('saved-comment-thread');
  fireEvent.click(screen.getByRole('button', { name: /^All comments$/ }));
  fireEvent.click(await screen.findByRole('button', { name: /Retained thread/ }));
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Reply' })).toBeVisible());
  expect(screen.getByRole('textbox', { name: 'Reply' })).toBe(reply);
  expect(screen.getByTestId('saved-comment-thread')).toBe(thread);
  expect(reply).toHaveValue('Keep this unsent reply');
  expect(api.confirm).not.toHaveBeenCalled();
  expect(api.createReply).not.toHaveBeenCalled();
  expect(api.documentSave).not.toHaveBeenCalled();
});


it('browses the retained thread from the host without confirming or discarding its reply', async () => {
  render(<Harness />);
  const input = await selectAndOpen(); fireEvent.change(input, { target: { value: 'Retained host thread' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save comment' }));
  const reply = await screen.findByRole('textbox', { name: 'Reply' });
  fireEvent.change(reply, { target: { value: 'Keep this host reply' } });
  const thread = screen.getByTestId('saved-comment-thread');
  command('comments');
  const row = await screen.findByRole('button', { name: /Retained host thread/ });
  expect(reply).not.toBeVisible(); expect(api.confirm).not.toHaveBeenCalled();
  fireEvent.click(row);
  expect(await screen.findByRole('textbox', { name: 'Reply' })).toBe(reply);
  expect(screen.getByTestId('saved-comment-thread')).toBe(thread);
  expect(reply).toHaveValue('Keep this host reply');
  expect(api.createReply).not.toHaveBeenCalled(); expect(api.documentSave).not.toHaveBeenCalled();
  expect(api.save).toHaveBeenCalledTimes(1);
});

it('still confirms closing a retained thread with an unsent reply', async () => {
  render(<Harness />); const input = await selectAndOpen();
  fireEvent.change(input, { target: { value: 'Close protected thread' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save comment' }));
  const reply = await screen.findByRole('textbox', { name: 'Reply' });
  fireEvent.change(reply, { target: { value: 'Keep this reply on denied close' } });
  fireEvent.click(screen.getByRole('button', { name: 'Close comments' }));
  await waitFor(() => expect(api.confirm).toHaveBeenCalledWith('project', 'comment'));
  expect(reply).toBeVisible(); expect(reply).toHaveValue('Keep this reply on denied close');
});

it.each(['new', 'edit'] as const)('still protects a dirty %s root when the host requests the list', async mode => {
  render(<Harness />); let input = await selectAndOpen();
  if (mode === 'edit') {
    fireEvent.change(input, { target: { value: 'Existing root' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save comment' }));
    await screen.findByRole('textbox', { name: 'Reply' });
    fireEvent.click(screen.getByRole('button', { name: 'Comment actions' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    input = await screen.findByRole('textbox', { name: 'Comment on selected text' });
  }
  fireEvent.change(input, { target: { value: 'Protected root draft' } }); command('comments');
  await waitFor(() => expect(api.confirm).toHaveBeenCalledWith('project', 'comment'));
  expect(input).toBeVisible(); expect(input).toHaveValue('Protected root draft');
});

it('does not navigate the host list during a pending root handoff', async () => {
  let finish!: (value: { status: string; commentIds: string[] }) => void;
  api.send.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(<Harness />); const input = await selectAndOpen();
  fireEvent.change(input, { target: { value: 'Pending handoff root' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save comment' }));
  const reply = await screen.findByRole('textbox', { name: 'Reply' });
  fireEvent.click(screen.getByRole('button', { name: 'Add comment to chat' }));
  await waitFor(() => expect(api.send).toHaveBeenCalledTimes(1));
  command('comments'); await act(async () => {});
  expect(reply).toBeVisible(); expect(screen.queryByRole('button', { name: /Pending handoff root/ })).toBeNull();
  expect(api.confirm).not.toHaveBeenCalled();
  await act(async () => finish({ status: 'queued', commentIds: ['root'] }));
  command('comments'); expect(await screen.findByRole('button', { name: /Pending handoff root/ })).toBeVisible();
});

it('defaults a fresh mentioned comment to chat staging but preserves an explicit opt-out', async () => {
  render(<Harness />);
  const input = await selectAndOpen();
  const checkbox = screen.getByRole('checkbox', { name: 'Add to chat' });
  expect(checkbox).not.toBeChecked();
  fireEvent.change(input, { target: { value: '@Chief please revise' } });
  expect(checkbox).toBeChecked(); expect(api.save).not.toHaveBeenCalled(); expect(api.send).not.toHaveBeenCalled();
  fireEvent.click(checkbox);
  fireEvent.change(input, { target: { value: '@Chief please revise @Chief again' } });
  expect(checkbox).not.toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: 'Save comment' }));
  await waitFor(() => expect(api.save).toHaveBeenCalledOnce());
  expect(api.save.mock.calls[0]![2]).toBe(false);
});


it('fails closed if the viewer disappears while a mentioned root draft is open', async () => {
  const view = render(<Harness />); const input = await selectAndOpen();
  fireEvent.change(input, { target: { value: '@Chief revise' } });
  expect(screen.getByRole('checkbox', { name: 'Add to chat' })).toBeChecked();
  api.viewer = false; view.rerender(<Harness />);
  expect(screen.queryByRole('checkbox', { name: 'Add to chat' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Save comment' })).toBeNull();
  expect(input).toHaveAttribute('readonly'); expect(api.save).not.toHaveBeenCalled();
  api.viewer = true; view.rerender(<Harness />);
  expect(screen.getByRole('checkbox', { name: 'Add to chat' })).toBeChecked();
});
it('offers the mention default when explicitly editing a saved root, never when reading its thread', async () => {
  const target = documentCommentTarget('report.html', { version: 1, start: { block: 'body', offset: 0 }, end: { block: 'body', offset: 5 }, quote: 'Ready' });
  const saved = { ...target, id: 'root', projectId: 'project', conversationId: 'project', note: '@Chief original', status: 'open' as const, authorMemberId: 'evebot:person', createdAt: 1, updatedAt: 1 };
  render(<Harness initial={[saved]} />); command('comments');
  fireEvent.click(await screen.findByRole('button', { name: /@Chief original/ }));
  await screen.findByRole('textbox', { name: 'Reply' });
  expect(screen.queryByRole('checkbox', { name: 'Add to chat' })).toBeNull();
  expect(api.save).not.toHaveBeenCalled(); expect(api.send).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Comment actions' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
  expect(screen.getByRole('checkbox', { name: 'Add to chat' })).toBeChecked();
  expect(api.save).not.toHaveBeenCalled(); expect(api.send).not.toHaveBeenCalled();
});

it.each([true, false])('explicitly opens the completed pointer range and retains drafts/threads with authored identities=%s', async authored => {
  render(<Harness documentObserved={{ ...observed, html: documentHtml('Report', authored ? '<p data-od-id="body">Ready for review</p>' : '<p>Ready for review</p>') }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Editing, mode' })); fireEvent.click(await screen.findByRole('button', { name: 'Viewing' }));
  command('comment'); await screen.findByText('No comments yet. Select text to add one.');
  const root = screen.getByRole('textbox', { name: 'Report' }), text = root.querySelector('p')!.firstChild!.firstChild!;
  const select = (end: number) => act(() => { const range = document.createRange(); range.setStart(text, 6); range.setEnd(text, end); window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range); document.dispatchEvent(new Event('selectionchange')); });
  fireEvent.pointerDown(root, { button: 0 }); select(7);
  expect(screen.queryByRole('textbox', { name: 'Comment on selected text' })).toBeNull();
  select(9); expect(screen.queryByRole('textbox', { name: 'Comment on selected text' })).toBeNull();
  fireEvent(root, new MouseEvent('pointerup', { bubbles: true, button: 0 }));
  expect(screen.queryByRole('textbox', { name: 'Comment on selected text' })).toBeNull();
  command('comment');
  const input = await screen.findByRole('textbox', { name: 'Comment on selected text' });
  expect(input).toHaveAccessibleDescription('for');
  expect(document.activeElement).toBe(input);
  fireEvent.change(input, { target: { value: 'Retain this exact anchor' } });
  select(16); fireEvent(root, new MouseEvent('pointerup', { bubbles: true, button: 0 }));
  expect(input).toHaveValue('Retain this exact anchor'); expect(input).toHaveAccessibleDescription('for');
  expect(editor().isEditable()).toBe(false); expect(api.documentSave).not.toHaveBeenCalled(); expect(api.save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Save comment' })); await screen.findByRole('textbox', { name: 'Reply' });
  select(16); fireEvent(root, new MouseEvent('pointerup', { bubbles: true, button: 0 }));
  expect(screen.queryByRole('textbox', { name: 'Comment on selected text' })).toBeNull();
  expect(screen.getByLabelText('Selected document text').textContent).toBe('for'); expect(api.save).toHaveBeenCalledTimes(1); expect(api.send).not.toHaveBeenCalled();
});

it('waits for Shift release before explicitly opening the finished keyboard selection and ignores collapsed selections', async () => {
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Editing, mode' })); fireEvent.click(await screen.findByRole('button', { name: 'Viewing' }));
  command('comment'); await screen.findByText('No comments yet. Select text to add one.');
  const root = screen.getByRole('textbox', { name: 'Report' }), text = root.querySelector('p')!.firstChild!.firstChild!;
  const select = (end: number) => act(() => { const range = document.createRange(); range.setStart(text, 6); range.setEnd(text, end); window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range); document.dispatchEvent(new Event('selectionchange')); });
  select(6); fireEvent(root, new MouseEvent('pointerup', { bubbles: true, button: 0 })); expect(screen.queryByRole('textbox', { name: 'Comment on selected text' })).toBeNull();
  fireEvent.keyDown(root, { key: 'Shift', shiftKey: true }); select(7); fireEvent.keyUp(root, { key: 'ArrowRight', shiftKey: true });
  expect(screen.queryByRole('textbox', { name: 'Comment on selected text' })).toBeNull();
  select(9); fireEvent.keyUp(root, { key: 'Shift', shiftKey: false });
  expect(screen.queryByRole('textbox', { name: 'Comment on selected text' })).toBeNull();
  command('comment');
  await screen.findByRole('textbox', { name: 'Comment on selected text' }); expect(screen.getByRole('textbox', { name: 'Comment on selected text' })).toHaveAccessibleDescription('for');
});

it('keeps selection gestures passive while the comment list is displayed', async () => {
  render(<Harness />); command('comment'); await screen.findByText('No comments yet. Select text to add one.');
  await screen.findByText('No comments yet. Select text to add one.');
  const root = screen.getByRole('textbox', { name: 'Report' }), text = root.querySelector('p')!.firstChild!.firstChild!, range = document.createRange();
  range.setStart(text, 0); range.setEnd(text, 5);
  act(() => { window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range); document.dispatchEvent(new Event('selectionchange')); });
  fireEvent(root, new MouseEvent('pointerup', { bubbles: true, button: 0 }));
  expect(screen.queryByRole('textbox', { name: 'Comment on selected text' })).toBeNull(); expect(api.save).not.toHaveBeenCalled();
  expect(host.postMessage.mock.calls.filter(call => call[0].type === 'studio:feedback-state').at(-1)![0].dirty).toBe(false);
});

it('keeps the mounted thread and its reply draft hidden while the comment list is displayed', async () => {
  // Browser acceptance qualifies actual utility hit-testing/display. This case
  // primarily protects reply state against replacing hiding with unmounting.
  const utilities = document.createElement('style'); utilities.textContent = '.flex{display:flex}.hidden{display:none}'; document.head.appendChild(utilities);
  try {
    render(<Harness />); const input = await selectAndOpen(); fireEvent.change(input, { target: { value: 'Saved root' } }); fireEvent.click(screen.getByRole('button', { name: 'Save comment' }));
    const reply = await screen.findByRole('textbox', { name: 'Reply' }); fireEvent.change(reply, { target: { value: 'Retained reply draft' } });
    const quote = screen.getByLabelText('Selected document text'), thread = screen.getByRole('region', { name: 'Comment thread' });
    fireEvent.click(screen.getByRole('button', { name: 'All comments' }));
    expect(getComputedStyle(quote.parentElement!).display).toBe('none');
    expect(quote).not.toBeVisible(); expect(thread).not.toBeVisible(); expect(screen.queryByRole('button', { name: 'Add comment to chat' })).toBeNull();
    expect(thread.isConnected).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Saved root/ }));
    expect(screen.getByRole('textbox', { name: 'Reply' })).toBe(reply); expect(reply).toHaveValue('Retained reply draft'); expect(quote).toBeVisible();
  } finally { utilities.remove(); }
});

it('opens the list without a genuine completed gesture, including a stale model selection', async () => {
  render(<Harness />);
  act(() => editor().update(() => { const text = $getRoot().getFirstDescendant()!; if ($isTextNode(text)) text.select(0, 5); }, { discrete: true }));
  command('comment');
  await screen.findByText('No comments yet. Select text to add one.');
  expect(screen.queryByRole('textbox', { name: 'Comment on selected text' })).toBeNull();
  expect(screen.getByRole('toolbar', { name: 'Document insertion' })).toBeVisible();
  expect(api.documentSave).not.toHaveBeenCalled(); expect(api.save).not.toHaveBeenCalled();
});

it('autofocuses only the explicit composer and closes a mention-only draft without discard', async () => {
  render(<Harness />);
  const input = await selectAndOpen();
  expect(input).toHaveFocus(); expect(input).toHaveAccessibleDescription('Ready');
  expect(screen.getByRole('dialog', { name: 'Document comments' }).querySelector('blockquote')).toBeNull();
  fireEvent.change(input, { target: { value: '@Chief ' } });
  expect(screen.getByRole('button', { name: 'Save comment' })).toBeDisabled();
  expect(screen.getByRole('checkbox', { name: 'Add to chat' })).toBeChecked();
  fireEvent.keyDown(input, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Document comments' })).toBeNull());
  expect(api.confirm).not.toHaveBeenCalled(); expect(api.save).not.toHaveBeenCalled(); expect(api.send).not.toHaveBeenCalled();
});

it('highlights the exact saved range without changing editor state or native selection and clears it on close', async () => {
  const registry = new Map<string, Set<Range>>();
  const originalCSS = globalThis.CSS;
  vi.stubGlobal('CSS', { ...originalCSS, highlights: registry });
  vi.stubGlobal('Highlight', class extends Set<Range> { constructor(...ranges: Range[]) { super(ranges); } });
  try {
    const target = documentCommentTarget('report.html', { version: 1, start: { block: 'body', offset: 6 }, end: { block: 'body', offset: 9 }, quote: 'for' });
    const saved: PreviewComment = { ...target, id: 'saved', projectId: 'project', conversationId: 'project', note: 'Existing thread', status: 'open', authorMemberId: 'evebot:person', createdAt: 1, updatedAt: 1 };
    render(<Harness initial={[saved]} />);
    const root = screen.getByRole('textbox', { name: 'Report' }), text = document.createTreeWalker(root, NodeFilter.SHOW_TEXT).nextNode()!;
    const before = JSON.stringify(editor().getEditorState().toJSON());
    const native = document.createRange(); native.setStart(text, 0); native.setEnd(text, 5);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(native);
    command('comments'); fireEvent.click(await screen.findByRole('button', { name: /Existing thread/ }));
    await screen.findByRole('textbox', { name: 'Reply' });
    expect(registry.size).toBe(1);
    const ranges = [...registry.values()][0]!;
    expect([...ranges].map(range => range.toString())).toEqual(['for']);
    expect(window.getSelection()!.toString()).toBe('Ready');
    expect(JSON.stringify(editor().getEditorState().toJSON())).toBe(before);
    expect(api.documentSave).not.toHaveBeenCalled(); expect(api.save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Close comments' }));
    await waitFor(() => expect(registry.size).toBe(0));
    command('comment'); await screen.findByRole('button', { name: /Existing thread/ });
    expect(screen.queryByRole('textbox', { name: 'Comment on selected text' })).toBeNull();
  } finally { cleanup(); vi.unstubAllGlobals(); }
});

it('grows and shrinks the compact composer within five rows without losing its draft or focus', async () => {
  render(<Harness />);
  const input = await selectAndOpen() as HTMLTextAreaElement;
  input.style.lineHeight = '20px';
  // jsdom has no layout. Supply measured content heights to exercise the real
  // component's native input sizing path; actual Chromium layout is separate.
  Object.defineProperty(input, 'scrollHeight', { configurable: true, get: () => input.value ? input.value.split('\n').length * 20 : 20 });
  expect(input).toHaveFocus(); expect(input).toHaveAttribute('rows', '1');
  const draft = 'One\nTwo\nThree';
  fireEvent.input(input, { target: { value: draft } });
  expect(input).toHaveValue(draft); expect(input.style.height).toBe('60px'); expect(input.style.overflowY).toBe('hidden');
  const long = 'One\nTwo\nThree\nFour\nFive\nSix\nSeven';
  fireEvent.input(input, { target: { value: long } });
  expect(input).toHaveValue(long); expect(input.style.height).toBe('100px'); expect(input.style.maxHeight).toBe('100px'); expect(input.style.overflowY).toBe('auto');
  fireEvent.input(input, { target: { value: 'Short' } });
  expect(input).toHaveValue('Short'); expect(input.style.height).toBe('20px'); expect(input.style.overflowY).toBe('hidden');
  expect(input).toHaveFocus(); expect(api.save).not.toHaveBeenCalled(); expect(api.documentSave).not.toHaveBeenCalled(); expect(api.send).not.toHaveBeenCalled();
});

it('keeps the comment placeholder separate from the draft and submission guard', async () => {
  render(<Harness />);
  const input = await selectAndOpen();
  expect(screen.getByPlaceholderText('Add a comment')).toBe(input);
  expect(input).toHaveValue(''); expect(screen.getByRole('button', { name: 'Save comment' })).toBeDisabled();
  fireEvent.input(input, { target: { value: 'A real note' } });
  expect(input).toHaveValue('A real note'); expect(screen.getByRole('button', { name: 'Save comment' })).toBeEnabled();
  fireEvent.input(input, { target: { value: '' } });
  expect(input).toHaveValue(''); expect(input).toHaveAttribute('placeholder', 'Add a comment');
  expect(screen.getByRole('button', { name: 'Save comment' })).toBeDisabled();
  expect(api.save).not.toHaveBeenCalled(); expect(api.send).not.toHaveBeenCalled();
});
