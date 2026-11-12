// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FileViewer } from '../../src/components/FileViewer';
import { CommentReviewProvider } from '../../src/components/embedded/CommentReview';
import type { PreviewComment, ProjectFile } from '../../src/types';
const confirmDiscard = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<boolean>>(async () => false));
vi.mock('../../src/components/embedded/host-context', async original => ({ ...await original<object>(), confirmHostFeedbackDiscard: confirmDiscard }));
vi.mock('../../src/components/embedded/comment-reply-api', () => ({ fetchCommentReplies: async () => [], createCommentReply: vi.fn(), editCommentReply: vi.fn(), deleteCommentReply: vi.fn() }));
vi.mock('../../src/components/embedded/host-viewer', () => ({ useEmbeddedMentionBots: () => [], useEmbeddedViewer: () => ({ memberId: 'evebot:person', displayName: 'Person' }) }));
const discardWrite = vi.fn();
const host = { postMessage: vi.fn() }, parent = Object.getOwnPropertyDescriptor(window, 'parent');
const file: ProjectFile = { name: 'deck.html', path: 'deck.html', type: 'file', size: 100, mtime: 1, kind: 'html', mime: 'text/html' };
const root = (id: string, slideIndex: number, filePath = file.name) => ({ id, projectId: 'project', conversationId: 'project', filePath, elementId: id, selector: 'h1', label: id, text: id, htmlHint: '', position: { x: 20, y: 20, width: 150, height: 30 }, note: `Note ${id}`, status: 'open', createdAt: 1, updatedAt: 1, slideIndex, authorMemberId: 'evebot:person' }) as PreviewComment;
const comments = [root('first', 0), root('second', 1), root('third', 0), root('internal', 0, 'internal.html')];
beforeEach(() => { vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }); Object.defineProperty(window, 'parent', { configurable: true, value: host }); host.postMessage.mockClear(); discardWrite.mockClear(); confirmDiscard.mockReset(); confirmDiscard.mockResolvedValue(false); vi.stubGlobal('fetch', vi.fn(async () => Response.json({}))); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); if (parent) Object.defineProperty(window, 'parent', parent); });
const tree = (projectId = 'project', activeFile = file, roots = comments) => <CommentReviewProvider projectId={projectId} changeStatus={vi.fn()}><FileViewer projectId={projectId} projectKind="prototype" embedded inlineAnnotations isDeck file={activeFile} liveHtml="<html><body><section class='slide'><h1>One</h1></section><section class='slide'><h1>Two</h1></section></body></html>" previewComments={roots} onDiscardPreviewCommentWrite={discardWrite} /></CommentReviewProvider>;
async function setup() {
  const view = render(tree());
  const frame = screen.getByTestId('artifact-preview-frame') as HTMLIFrameElement;
  const post = vi.spyOn(frame.contentWindow!, 'postMessage');
  const dispatch = async (data: object) => { await act(async () => window.dispatchEvent(new MessageEvent('message', { source: (screen.getByTestId('artifact-preview-frame') as HTMLIFrameElement).contentWindow, data }))); };
  await dispatch({ type: 'od:url-selection-bridge-ready', href: frame.src });
  await dispatch({ type: 'od:slide-state', active: 0, count: 2 });
  await dispatch({ type: 'od:comment-targets', targets: comments.filter(c => c.filePath === file.name) });
  async function control(action: string, projectId = 'project') {
    await waitFor(() => expect(host.postMessage.mock.calls.some(([v]) => v.type === 'studio:feedback-state' && v.projectId === projectId)).toBe(true));
    const state = host.postMessage.mock.calls.filter(([v]) => v.type === 'studio:feedback-state' && v.projectId === projectId).at(-1)![0];
    await act(async () => window.dispatchEvent(new MessageEvent('message', { source: host as unknown as Window, origin: window.location.origin, data: { type: 'studio:feedback-control', projectId, controllerId: state.controllerId, action } })));
  }
  return { view, frame, post, dispatch, control };
}
async function showAll() { fireEvent.click(screen.getByRole('button', { name: 'Comment actions' })); fireEvent.click(await screen.findByRole('button', { name: 'View all comments' })); }
async function filter(name: string) { fireEvent.click(screen.getByRole('button', { name: 'Filter comments' })); fireEvent.click(await screen.findByRole('button', { name })); }
it('lists all artifact slides and navigates a selected off-page thread through the existing slide bridge', async () => {
  const { post, control } = await setup(); await control('comments');
  expect(await screen.findByText('Note first')).toBeVisible(); expect(screen.getByText('Note second')).toBeVisible(); expect(screen.queryByText('Note internal')).toBeNull();
  fireEvent.click(screen.getAllByTestId('comment-side-item').find(node => node.textContent?.includes('Note second'))!);
  await waitFor(() => expect(post).toHaveBeenCalledWith({ type: 'od:slide', action: 'go', index: 1 }, '*'));
  expect(await screen.findByRole('textbox', { name: 'Reply' })).toBeVisible();
});
it('filters the current slide without discarding a mounted reply draft and updates scope on slide changes', async () => {
  const { control, dispatch, post } = await setup(); await control('comments');
  fireEvent.click(screen.getAllByTestId('comment-side-item').find(node => node.textContent?.includes('Note first'))!);
  const reply = await screen.findByRole('textbox', { name: 'Reply' }); fireEvent.change(reply, { target: { value: 'Keep this unsent reply' } });
  await showAll();
  await filter('This page'); expect(screen.queryByText('Note second')).toBeNull();
  await filter('All pages'); expect(screen.getByText('Note second')).toBeVisible();
  post.mockClear();
  fireEvent.click(screen.getAllByTestId('comment-side-item').find(node => node.textContent?.includes('Note second'))!);
  await waitFor(() => expect(confirmDiscard).toHaveBeenCalledWith('project', 'comment'));
  expect(post).not.toHaveBeenCalledWith({ type: 'od:slide', action: 'go', index: 1 }, '*');
  fireEvent.click(screen.getByRole('button', { name: /go back/i }));
  expect(screen.getByRole('textbox', { name: 'Reply' })).toBe(reply); expect(reply).toHaveValue('Keep this unsent reply');
  await showAll(); await filter('This page');
  await dispatch({ type: 'od:slide-state', active: 1, count: 2 });
  expect(screen.getByText('Note second')).toBeVisible(); expect(screen.queryAllByTestId('comment-side-item').some(row => row.textContent?.includes('Note first'))).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: /go back/i })); expect(screen.getByRole('textbox', { name: 'Reply' })).toHaveValue('Keep this unsent reply');
});

async function pendingRetarget() {
  const context = await setup(); await context.control('comments');
  fireEvent.click(screen.getAllByTestId('comment-side-item').find(node => node.textContent?.includes('Note first'))!);
  fireEvent.change(await screen.findByRole('textbox', { name: 'Reply' }), { target: { value: 'Original unsent reply' } });
  await showAll();
  let finish!: (value: boolean) => void;
  confirmDiscard.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  context.post.mockClear();
  fireEvent.click(screen.getAllByTestId('comment-side-item').find(node => node.textContent?.includes('Note second'))!);
  await waitFor(() => expect(confirmDiscard).toHaveBeenCalledWith('project', 'comment'));
  return { ...context, finish };
}
it('applies a confirmed retarget only when its captured composer and draft still match', async () => {
  const { finish, post } = await pendingRetarget();
  await act(async () => finish(true));
  expect(post).toHaveBeenCalledWith({ type: 'od:slide', action: 'go', index: 1 }, '*');
  expect(await screen.findByRole('textbox', { name: 'Reply' })).toHaveValue('');
  expect(screen.getByText('Note second')).toBeVisible();
});
it('ignores delayed consent after newer typing in the same already-dirty reply', async () => {
  const { finish, post } = await pendingRetarget();
  fireEvent.click(screen.getByRole('button', { name: /go back/i }));
  const reply = screen.getByRole('textbox', { name: 'Reply' }); fireEvent.change(reply, { target: { value: 'Newer unsent reply' } });
  await act(async () => finish(true));
  expect(post).not.toHaveBeenCalledWith({ type: 'od:slide', action: 'go', index: 1 }, '*');
  expect(reply).toHaveValue('Newer unsent reply'); expect(screen.getByText('Note first')).toBeVisible();
});
it.each(['file', 'project'] as const)('ignores delayed consent after %s replacement and retains the replacement draft', async changed => {
  const { finish, view, control, dispatch } = await pendingRetarget();
  const projectId = changed === 'project' ? 'other-project' : 'project';
  const activeFile = changed === 'file' ? { ...file, name: 'other.html', path: 'other.html' } : file;
  const next = [root('new-first', 0, activeFile.name), root('new-second', 1, activeFile.name)].map(c => ({ ...c, projectId }));
  view.rerender(tree(projectId, activeFile, next));
  const frame = screen.getByTestId('artifact-preview-frame') as HTMLIFrameElement;
  const post = vi.spyOn(frame.contentWindow!, 'postMessage');
  await dispatch({ type: 'od:url-selection-bridge-ready', href: frame.src });
  await dispatch({ type: 'od:slide-state', active: 0, count: 2 });
  await dispatch({ type: 'od:comment-targets', targets: next });
  await control('comments', projectId);
  fireEvent.click(screen.getAllByTestId('comment-side-item').find(node => node.textContent?.includes('Note new-first'))!);
  const reply = await screen.findByRole('textbox', { name: 'Reply' }); fireEvent.change(reply, { target: { value: 'Replacement draft' } });
  post.mockClear(); await act(async () => finish(true));
  expect(post).not.toHaveBeenCalledWith({ type: 'od:slide', action: 'go', index: 1 }, '*');
  expect(screen.getByRole('textbox', { name: 'Reply' })).toBe(reply); expect(reply).toHaveValue('Replacement draft'); expect(screen.getByText('Note new-first')).toBeVisible();
});
it('ignores a pending consent after unmount', async () => {
  const { finish, view, post } = await pendingRetarget(); view.unmount(); post.mockClear(); discardWrite.mockClear();
  await act(async () => finish(true)); expect(post).not.toHaveBeenCalled(); expect(discardWrite).not.toHaveBeenCalled();
});
it('invalidates earlier consent when another accepted retarget replaces the composer', async () => {
  const { finish, post } = await pendingRetarget();
  confirmDiscard.mockResolvedValueOnce(true);
  fireEvent.click(screen.getAllByTestId('comment-side-item').find(node => node.textContent?.includes('Note third'))!);
  const reply = await screen.findByRole('textbox', { name: 'Reply' });
  await waitFor(() => expect(reply).toHaveValue(''));
  fireEvent.change(reply, { target: { value: 'Draft after replacement' } });
  post.mockClear(); await act(async () => finish(true));
  expect(post).not.toHaveBeenCalledWith({ type: 'od:slide', action: 'go', index: 1 }, '*');
  expect(reply).toHaveValue('Draft after replacement');
});
it('filters a direct native all-comments list while the preview remains interactive', async () => {
  const { control, dispatch } = await setup();
  await control('comments');
  const state = () => host.postMessage.mock.calls.filter(([value]) => value.type === 'studio:feedback-state').at(-1)![0];
  expect(state().commenting).toBe(false);
  expect(screen.getByText('Note first')).toBeVisible(); expect(screen.getByText('Note second')).toBeVisible();
  await filter('This page');
  expect(screen.getByText('Note first')).toBeVisible(); expect(screen.queryByText('Note second')).toBeNull();
  expect(state().commenting).toBe(false);
  await dispatch({ type: 'od:slide-state', active: 1, count: 2 });
  expect(screen.getByText('Note second')).toBeVisible(); expect(screen.queryByText('Note first')).toBeNull();
  await filter('All pages');
  expect(screen.getByText('Note first')).toBeVisible(); expect(screen.getByText('Note second')).toBeVisible();
  expect(state().commenting).toBe(false);
});
