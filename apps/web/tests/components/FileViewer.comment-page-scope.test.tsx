// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FileViewer } from '../../src/components/FileViewer';
import { CommentReviewProvider } from '../../src/components/embedded/CommentReview';
import type { PreviewComment, ProjectFile } from '../../src/types';
const confirmDiscard = vi.hoisted(() => vi.fn(async () => false));
vi.mock('../../src/components/embedded/host-context', async original => ({ ...await original<object>(), confirmHostFeedbackDiscard: confirmDiscard }));
vi.mock('../../src/components/embedded/comment-reply-api', () => ({ fetchCommentReplies: async () => [], createCommentReply: vi.fn(), editCommentReply: vi.fn(), deleteCommentReply: vi.fn() }));
vi.mock('../../src/components/embedded/host-viewer', () => ({ useEmbeddedMentionBots: () => [], useEmbeddedViewer: () => ({ memberId: 'evebot:person', displayName: 'Person' }) }));
const host = { postMessage: vi.fn() }, parent = Object.getOwnPropertyDescriptor(window, 'parent');
const file: ProjectFile = { name: 'deck.html', path: 'deck.html', type: 'file', size: 100, mtime: 1, kind: 'html', mime: 'text/html' };
const root = (id: string, slideIndex: number, filePath = file.name) => ({ id, projectId: 'project', conversationId: 'project', filePath, elementId: id, selector: 'h1', label: id, text: id, htmlHint: '', position: { x: 20, y: 20, width: 150, height: 30 }, note: `Note ${id}`, status: 'open', createdAt: 1, updatedAt: 1, slideIndex, authorMemberId: 'evebot:person' }) as PreviewComment;
const comments = [root('first', 0), root('second', 1), root('internal', 0, 'internal.html')];
beforeEach(() => { vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }); Object.defineProperty(window, 'parent', { configurable: true, value: host }); host.postMessage.mockClear(); confirmDiscard.mockClear(); vi.stubGlobal('fetch', vi.fn(async () => Response.json({}))); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); if (parent) Object.defineProperty(window, 'parent', parent); });
async function setup() {
  render(<CommentReviewProvider projectId="project" changeStatus={vi.fn()}><FileViewer projectId="project" projectKind="prototype" embedded inlineAnnotations isDeck file={file} liveHtml="<html><body><section class='slide'><h1>One</h1></section><section class='slide'><h1>Two</h1></section></body></html>" previewComments={comments} /></CommentReviewProvider>);
  const frame = screen.getByTestId('artifact-preview-frame') as HTMLIFrameElement;
  const post = vi.spyOn(frame.contentWindow!, 'postMessage');
  const dispatch = async (data: object) => { await act(async () => window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data }))); };
  await dispatch({ type: 'od:url-selection-bridge-ready', href: frame.src });
  await dispatch({ type: 'od:slide-state', active: 0, count: 2 });
  await dispatch({ type: 'od:comment-targets', targets: comments.filter(c => c.filePath === file.name) });
  async function control(action: string) {
    await waitFor(() => expect(host.postMessage.mock.calls.some(([v]) => v.type === 'studio:feedback-state')).toBe(true));
    const state = host.postMessage.mock.calls.filter(([v]) => v.type === 'studio:feedback-state').at(-1)![0];
    await act(async () => window.dispatchEvent(new MessageEvent('message', { source: host as unknown as Window, origin: window.location.origin, data: { type: 'studio:feedback-control', projectId: 'project', controllerId: state.controllerId, action } })));
  }
  return { frame, post, dispatch, control };
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
