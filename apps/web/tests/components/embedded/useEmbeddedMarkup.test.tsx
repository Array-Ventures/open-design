// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ prepare: vi.fn(), stage: vi.fn(), clear: vi.fn() }));
const actor = vi.hoisted(() => ({ id: 'person-a' }));
vi.mock('../../../src/components/PreviewDrawOverlay', () => ({ ANNOTATION_EVENT: 'opendesign:annotation' }));
vi.mock('../../../src/components/embedded/host-viewer', () => ({ useEmbeddedViewer: () => ({ memberId: actor.id }) }));
vi.mock('../../../src/components/embedded/host-context', () => ({ stageHostContext: api.stage }));
vi.mock('../../../src/components/embedded/feedback-image-upload', () => ({ FeedbackImageUpload: class {
  prepare(...args: unknown[]) { return api.prepare(...args); }
  clear() { api.clear(); }
} }));
import { useEmbeddedMarkup } from '../../../src/components/embedded/useEmbeddedMarkup';
const receipt = { operationId: 'operation', paths: ['_studio-comments/mark.png'] };
function submit() {
  const ack = vi.fn();
  act(() => { window.dispatchEvent(new CustomEvent('opendesign:annotation', { detail: { action: 'draft', filePath: 'index.html', note: 'Change this area', file: new File(['mark'], 'mark.png'), ack } })); });
  return ack;
}
beforeEach(() => { actor.id = 'person-a'; api.prepare.mockResolvedValue(receipt); api.stage.mockResolvedValue(true); });
afterEach(() => { cleanup(); vi.resetAllMocks(); });
it('stages the captured file only after its upload and acknowledges acceptance', async () => {
  renderHook(() => useEmbeddedMarkup('project', ['index.html']));
  const ack = submit();
  await waitFor(() => expect(ack).toHaveBeenCalledWith({ ok: true }));
  expect(api.stage).toHaveBeenCalledWith('project', 'Change this area', 'operation', undefined, receipt.paths, [expect.objectContaining({ kind: 'markup', filePath: 'index.html' })], expect.any(Function));
});
it('rejects a late image receipt after closing and aborts its upload scope', async () => {
  let finish!: (value: typeof receipt) => void;
  api.prepare.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const view = renderHook(() => useEmbeddedMarkup('project', ['index.html']));
  const ack = submit();
  const signal = api.prepare.mock.calls[0]![3] as AbortSignal;
  view.unmount(); expect(signal.aborted).toBe(true);
  await act(async () => { finish(receipt); });
  expect(api.stage).not.toHaveBeenCalled(); expect(ack).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
});
it('does not retarget pending markup after its file disappears', async () => {
  let finish!: (value: typeof receipt) => void;
  api.prepare.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const view = renderHook(({ files }) => useEmbeddedMarkup('project', files), { initialProps: { files: ['index.html'] } });
  const ack = submit(); view.rerender({ files: ['other.html'] });
  await act(async () => { finish(receipt); });
  expect(api.stage).not.toHaveBeenCalled(); expect(ack).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
});
it('invalidates pending markup when the signed-in viewer changes', async () => {
  let finish!: (value: typeof receipt) => void;
  api.prepare.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const view = renderHook(() => useEmbeddedMarkup('project', ['index.html']));
  const ack = submit(); const signal = api.prepare.mock.calls[0]![3] as AbortSignal;
  actor.id = 'person-b'; view.rerender(); expect(signal.aborted).toBe(true);
  await act(async () => { finish(receipt); });
  expect(api.stage).not.toHaveBeenCalled(); expect(ack).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
});
it('does not report a successful handoff to a closed markup surface', async () => {
  let finish!: (value: boolean) => void;
  api.stage.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const view = renderHook(() => useEmbeddedMarkup('project', ['index.html']));
  const ack = submit(); await waitFor(() => expect(api.stage).toHaveBeenCalledOnce());
  view.unmount(); await act(async () => { finish(true); });
  expect(ack).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
});
