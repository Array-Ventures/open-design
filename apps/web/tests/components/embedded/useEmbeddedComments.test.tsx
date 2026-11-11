// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PreviewComment } from '../../../src/types';

const api = vi.hoisted(() => ({ list: vi.fn(), save: vi.fn(), remove: vi.fn(), reorder: vi.fn(), upload: vi.fn(), stage: vi.fn(), prepare: vi.fn() }));
vi.mock('../../../src/providers/registry', () => ({ fetchPreviewComments: api.list, upsertPreviewComment: api.save, deletePreviewComment: api.remove, patchPreviewCommentSortKey: api.reorder, uploadProjectFiles: api.upload }));
vi.mock('../../../src/components/embedded/host-context', async original => ({ ...await original<typeof import('../../../src/components/embedded/host-context')>(), stageHostContext: api.stage, prepareHostFeedback: api.prepare }));
import { useEmbeddedComments } from '../../../src/components/embedded/useEmbeddedComments';
const target = { filePath: 'index.html', elementId: 'heading', selector: '#heading', label: 'Heading', text: 'Original', position: { x: 0, y: 0, width: 100, height: 20 }, htmlHint: '<h1>Original</h1>' };
const comment = { ...target, id: 'comment-a', note: 'Change heading', conversationId: 'project-a', attachments: [] } as unknown as PreviewComment;
beforeEach(() => { api.list.mockResolvedValue([]); api.stage.mockResolvedValue(true); api.prepare.mockResolvedValue('11111111-1111-4111-8111-111111111111'); api.save.mockResolvedValue(comment); });
afterEach(() => { cleanup(); vi.resetAllMocks(); });
describe('embedded persistent annotations', () => {
  it('saves in the project comment container and stages only after an explicit attach', async () => {
    const { result } = renderHook(() => useEmbeddedComments('project-a'));
    await waitFor(() => expect(result.current.state).toBe('success'));
    await act(async () => { await result.current.save(target, 'Change heading', false); });
    expect(api.save).toHaveBeenCalledWith('project-a', 'project-a', expect.objectContaining({ target, note: 'Change heading' }));
    expect(result.current.comments).toEqual([comment]); expect(api.stage).not.toHaveBeenCalled();
    await act(async () => { await result.current.save(target, 'Change heading', true); });
    expect(api.stage).toHaveBeenCalledWith('project-a', 'Change heading', expect.any(String), expect.any(String), [], [expect.objectContaining({ kind: 'comment', filePath: target.filePath })], expect.any(Function));
  });
  it('preserves saved comments when the host refuses a draft handoff', async () => {
    api.stage.mockResolvedValue(false);
    const { result } = renderHook(() => useEmbeddedComments('project-a'));
    await waitFor(() => expect(result.current.state).toBe('success'));
    await act(async () => { await result.current.save(target, 'Change heading', true); });
    expect(result.current.comments).toEqual([comment]);
    expect(result.current.notice).toContain('Comment saved');
  });
  it('does not save a partial image comment and reports upload failure', async () => {
    api.upload.mockResolvedValue({ uploaded: [], failed: [{ name: 'image.png' }] });
    const { result } = renderHook(() => useEmbeddedComments('project-a'));
    await waitFor(() => expect(result.current.state).toBe('success'));
    await act(async () => { expect(await result.current.save(target, 'Change', false, [new File(['image'], 'image.png')])).toBeNull(); });
    expect(api.save).not.toHaveBeenCalled(); expect(result.current.notice).toContain('not saved');
  });
});

it('does not stage a saved comment after its artifact closes during save', async () => {
  let finish!: (value: PreviewComment) => void;
  api.save.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const view = renderHook(() => useEmbeddedComments('project-a'));
  await waitFor(() => expect(view.result.current.state).toBe('success'));
  let pending!: ReturnType<typeof view.result.current.save>;
  act(() => { pending = view.result.current.save(target, 'Change heading', true); });
  await waitFor(() => expect(api.save).toHaveBeenCalledOnce());
  view.unmount();
  await act(async () => { finish(comment); await pending; });
  expect(api.stage).not.toHaveBeenCalled();
});
it('does not create a comment when an image finishes uploading after closing', async () => {
  let finish!: (value: { uploaded: { path: string; name: string }[]; failed: [] }) => void;
  api.upload.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const view = renderHook(() => useEmbeddedComments('project-a'));
  await waitFor(() => expect(view.result.current.state).toBe('success'));
  let pending!: ReturnType<typeof view.result.current.save>;
  act(() => { pending = view.result.current.save(target, 'Change heading', false, [new File(['image'], 'figure.png')]); });
  await waitFor(() => expect(api.upload).toHaveBeenCalledOnce());
  const signal = api.upload.mock.calls[0]![4] as AbortSignal;
  view.unmount(); expect(signal.aborted).toBe(true);
  await act(async () => { finish({ uploaded: [{ path: '_studio-comments/figure.png', name: 'figure.png' }], failed: [] }); await pending; });
  expect(api.save).not.toHaveBeenCalled();
  expect(api.stage).not.toHaveBeenCalled();
});
it('does not continue preparation in another project after a route change', async () => {
  let finish!: (value: string) => void;
  api.prepare.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const view = renderHook(({ projectId }) => useEmbeddedComments(projectId), { initialProps: { projectId: 'project-a' } });
  await waitFor(() => expect(view.result.current.state).toBe('success'));
  let pending!: ReturnType<typeof view.result.current.save>;
  act(() => { pending = view.result.current.save(target, 'Change heading', true); });
  view.rerender({ projectId: 'project-b' });
  await act(async () => { finish('old-preparation'); await pending; });
  expect(api.save).not.toHaveBeenCalled();
  expect(api.stage).not.toHaveBeenCalled();
});

it('reuses a saved create receipt when its explicit draft handoff is retried', async () => {
  api.stage.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  const { result } = renderHook(() => useEmbeddedComments('project-a'));
  await waitFor(() => expect(result.current.state).toBe('success'));
  await act(async () => { await result.current.save(target, 'Change heading', true); });
  await act(async () => { await result.current.save(target, 'Change heading', true); });
  expect(api.save).toHaveBeenCalledOnce();
  expect(api.stage).toHaveBeenCalledTimes(2);
  expect(api.stage.mock.calls[1]![2]).toBe(api.stage.mock.calls[0]![2]);
  expect(result.current.comments).toEqual([comment]);
});
it('rejects an old-project callback invoked after a route change', async () => {
  const view = renderHook(({ projectId }) => useEmbeddedComments(projectId), { initialProps: { projectId: 'project-a' } });
  await waitFor(() => expect(view.result.current.state).toBe('success'));
  const stale = view.result.current.save;
  view.rerender({ projectId: 'project-b' });
  await act(async () => { expect(await stale(target, 'Old selection', true)).toBeNull(); });
  expect(api.prepare).not.toHaveBeenCalled();
  expect(api.save).not.toHaveBeenCalled();
});

it('does not reuse a saved handoff receipt after the selected target geometry changes', async () => {
  api.stage.mockResolvedValue(false);
  const { result } = renderHook(() => useEmbeddedComments('project-a'));
  await waitFor(() => expect(result.current.state).toBe('success'));
  await act(async () => { await result.current.save(target, 'Change heading', true); });
  const moved = { ...target, position: { ...target.position, x: 240 } };
  await act(async () => { await result.current.save(moved, 'Change heading', true); });
  expect(api.save).toHaveBeenCalledTimes(2);
  expect(api.save.mock.calls[1]![2].target.position.x).toBe(240);
});

it('does not resurrect a deleted comment from a refused handoff receipt', async () => {
  api.stage.mockResolvedValue(false); api.remove.mockResolvedValue(true);
  const { result } = renderHook(() => useEmbeddedComments('project-a'));
  await waitFor(() => expect(result.current.state).toBe('success'));
  await act(async () => { await result.current.save(target, 'Change heading', true); });
  const oldOperation = api.stage.mock.calls[0]![2];
  await act(async () => { await result.current.remove(comment.id); });
  expect(result.current.comments).toEqual([]);
  await act(async () => { await result.current.save(target, 'Change heading', true); });
  expect(api.save).toHaveBeenCalledTimes(2);
  expect(api.stage.mock.calls[1]![2]).not.toBe(oldOperation);
});
