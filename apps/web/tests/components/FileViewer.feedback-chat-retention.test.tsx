// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FileViewer } from '../../src/components/FileViewer';
import { EmbeddedViewerProvider } from '../../src/components/embedded/host-viewer';
import { CommentReviewProvider } from '../../src/components/embedded/CommentReview';
import type { PreviewComment, ProjectFile } from '../../src/types';
const confirmDiscard = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<boolean>>(async () => false));
vi.mock('../../src/components/embedded/host-context', async original => ({ ...await original<object>(), confirmHostFeedbackDiscard: confirmDiscard }));
const mutations = vi.hoisted(() => ({ create: vi.fn(), edit: vi.fn(), remove: vi.fn() }));
vi.mock('../../src/components/embedded/comment-reply-api', () => ({ fetchCommentReplies: async () => [], createCommentReply: mutations.create, editCommentReply: mutations.edit, deleteCommentReply: mutations.remove }));
const discardWrite = vi.fn();
const host = { postMessage: vi.fn() }, parent = Object.getOwnPropertyDescriptor(window, 'parent');
const file: ProjectFile = { name: 'deck.html', path: 'deck.html', type: 'file', size: 100, mtime: 1, kind: 'html', mime: 'text/html' };
const root = (id: string, slideIndex: number, filePath = file.name) => ({ id, projectId: 'project', conversationId: 'project', filePath, elementId: id, selector: 'h1', label: id, text: id, htmlHint: '', position: { x: 20, y: 20, width: 150, height: 30 }, note: `Note ${id}`, status: 'open', createdAt: 1, updatedAt: 1, slideIndex, authorMemberId: 'evebot:person' }) as PreviewComment;
const comments = [root('first', 0), root('second', 1)];
let hidden = false;
beforeEach(() => { hidden = false;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => { const width = hidden ? 0 : 900, height = hidden ? 0 : 650; return { x: 0, y: 0, left: 0, top: 0, width, height, right: width, bottom: height, toJSON() {} }; });
  vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL: () => 'blob:retained-image', revokeObjectURL: vi.fn() }));
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Object.defineProperty(window, 'parent', { configurable: true, value: host });
  host.postMessage.mockClear(); discardWrite.mockClear(); for (const write of Object.values(mutations)) write.mockReset();
  confirmDiscard.mockReset(); confirmDiscard.mockResolvedValue(false); vi.stubGlobal('fetch', vi.fn(async () => Response.json({})));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); if (parent) Object.defineProperty(window, 'parent', parent); });
const tree = (projectId = 'project', activeFile = file, roots = comments) => <EmbeddedViewerProvider projectId={projectId}><CommentReviewProvider projectId={projectId} changeStatus={vi.fn()}><FileViewer projectId={projectId} projectKind="prototype" embedded inlineAnnotations isDeck file={activeFile} liveHtml="<html><body><section class='slide'><h1>One</h1></section><section class='slide'><h1>Two</h1></section></body></html>" previewComments={roots} onDiscardPreviewCommentWrite={discardWrite} /></CommentReviewProvider></EmbeddedViewerProvider>;
async function context(id: string, name = 'Person') { await act(async () => window.dispatchEvent(new MessageEvent('message', { source: host as unknown as Window, origin: window.location.origin, data: { type: 'studio:host-context', projectId: 'project', viewer: { id, name } } }))); }
async function setup() {
  render(tree());
  const frame = screen.getByTestId('artifact-preview-frame') as HTMLIFrameElement;
  const dispatch = async (data: object) => { await act(async () => window.dispatchEvent(new MessageEvent('message', { source: (screen.getByTestId('artifact-preview-frame') as HTMLIFrameElement).contentWindow, data }))); };
  await context('person');
  await dispatch({ type: 'od:url-selection-bridge-ready', href: frame.src });
  await dispatch({ type: 'od:slide-state', active: 0, count: 2 });
  await dispatch({ type: 'od:comment-targets', targets: comments.filter(c => c.filePath === file.name) });
  async function control(action: string, projectId = 'project') {
    await waitFor(() => expect(host.postMessage.mock.calls.some(([v]) => v.type === 'studio:feedback-state' && v.projectId === projectId)).toBe(true));
    const state = host.postMessage.mock.calls.filter(([v]) => v.type === 'studio:feedback-state' && v.projectId === projectId).at(-1)![0];
    await act(async () => window.dispatchEvent(new MessageEvent('message', { source: host as unknown as Window, origin: window.location.origin, data: { type: 'studio:feedback-control', projectId, controllerId: state.controllerId, action } })));
  }
  return { frame, control };
}
it('retains the real reply and attachment when initial mobile chat binding hides and restores the artifact', async () => {
  const { frame, control } = await setup(); await control('comments');
  fireEvent.click(screen.getAllByTestId('comment-side-item').find(node => node.textContent?.includes('Note first'))!);
  const reply = await screen.findByRole('textbox', { name: 'Reply' });
  const thread = screen.getByTestId('saved-comment-thread');
  fireEvent.change(reply, { target: { value: 'Keep this unsent reply through initial chat binding' } });
  const image = new File(['owned raster fixture'], 'unsent.png', { type: 'image/png' });
  fireEvent.change(screen.getByLabelText('Reply image files'), { target: { files: [image] } });
  expect(screen.getByRole('button', { name: /Remove.*unsent.png/ })).toBeVisible();
  // The native initial chooser is opened from a library artifact, then Chief
  // binds on a compact viewport. PanelSlot hides the same outer Studio iframe
  // with display:none; its real layout measures zero until Return to artifact.
  discardWrite.mockClear();
  hidden = true; await act(async () => window.dispatchEvent(new Event('resize')));
  hidden = false; await act(async () => window.dispatchEvent(new Event('resize')));
  expect(screen.getByTestId('artifact-preview-frame')).toBe(frame);
  expect(screen.getByTestId('saved-comment-thread')).toBe(thread);
  expect(screen.getByRole('textbox', { name: 'Reply' })).toBe(reply);
  expect(reply).toHaveValue('Keep this unsent reply through initial chat binding');
  expect(screen.getByRole('button', { name: /Remove.*unsent.png/ })).toBeVisible();
  expect(discardWrite).not.toHaveBeenCalled(); expect(confirmDiscard).not.toHaveBeenCalled();
  for (const write of Object.values(mutations)) expect(write).not.toHaveBeenCalled();
});

it('retains same-human context refreshes but clears private reply text and images on a real actor change', async () => {
  const { control } = await setup(); await control('comments');
  fireEvent.click(screen.getAllByTestId('comment-side-item').find(node => node.textContent?.includes('Note first'))!);
  const reply = await screen.findByRole('textbox', { name: 'Reply' });
  fireEvent.change(reply, { target: { value: 'Private unsent text' } });
  fireEvent.change(screen.getByLabelText('Reply image files'), { target: { files: [new File(['raster'], 'private.png', { type: 'image/png' })] } });
  await context('person', 'Updated name');
  expect(reply).toHaveValue('Private unsent text'); expect(screen.getByRole('button', { name: 'Remove private.png' })).toBeVisible();
  await context('another-person', 'Another person');
  expect(screen.getByRole('textbox', { name: 'Reply' })).toHaveValue('');
  expect(screen.queryByRole('button', { name: 'Remove private.png' })).toBeNull();
  for (const write of Object.values(mutations)) expect(write).not.toHaveBeenCalled();
});
