// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { StrictMode, type ReactNode } from 'react';
import type { PreviewComment } from '../../../src/types';
import { useRootCommentEditor } from '../../../src/components/embedded/useRootCommentEditor';
import { RootCommentWriteError } from '../../../src/providers/comment-write-error';
afterEach(cleanup);
const root = { id: 'root', note: 'Original', editToken: 'original', attachments: [] } as unknown as PreviewComment;
const initial = { existing: root as PreviewComment | null, retained: root, draft: 'Local edit', hasExtras: false, selectionKey: 'root', onDraft: vi.fn() };
it('retains the original baseline across refresh and explicitly rebases without replacing local text', async () => {
  const view = renderHook(props => useRootCommentEditor(props), { initialProps: { ...initial, onDraft: vi.fn() } });
  const latest = { ...root, note: 'Remote edit', editToken: 'latest' };
  view.rerender({ ...initial, existing: latest }); expect(view.result.current.stale).toBe(true);
  const save = vi.fn().mockRejectedValue(new RootCommentWriteError(409, 'COMMENT_EDIT_CONFLICT'));
  await act(async () => { await view.result.current.save(save); });
  expect(save).toHaveBeenLastCalledWith(root); expect(view.result.current.failure).toContain('preserved');
  act(() => view.result.current.rebase()); expect(view.result.current.stale).toBe(false);
  const next = vi.fn(); await act(async () => { await view.result.current.save(next); });
  expect(next).toHaveBeenCalledWith(latest); expect(initial.onDraft).not.toHaveBeenCalled();
});
it('does not apply late failures or acknowledgements to another selected root', async () => {
  const view = renderHook(props => useRootCommentEditor(props), { initialProps: initial });
  let fail!: (error: Error) => void;
  let pending!: Promise<void>;
  act(() => { pending = view.result.current.save(() => new Promise((_resolve, reject) => { fail = reject; })); });
  const other = { ...root, id: 'other', editToken: 'other' };
  view.rerender({ ...initial, existing: other, retained: other, selectionKey: 'other' });
  await act(async () => { fail(new RootCommentWriteError(409)); await pending; });
  expect(view.result.current.failure).toBeNull();
  const next = vi.fn(); await act(async () => { await view.result.current.save(next); });
  expect(next).toHaveBeenCalledWith(other);
});
it('keeps a deleted root draft without implicitly creating a replacement', async () => {
  const view = renderHook(props => useRootCommentEditor(props), { initialProps: initial });
  view.rerender({ ...initial, existing: null }); expect(view.result.current.deleted).toBe(true);
  const save = vi.fn(); await act(async () => { await view.result.current.save(save); }); expect(save).not.toHaveBeenCalled();
});
it('retains a usable baseline through Strict Mode effect cleanup and accepts its own save token', async () => {
  const view = renderHook(() => useRootCommentEditor(initial), { wrapper: ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode> });
  const accepted = { ...root, note: 'Local edit', editToken: 'accepted' };
  const save = vi.fn().mockResolvedValue(accepted); await act(async () => { await view.result.current.save(save); });
  expect(save).toHaveBeenCalledWith(root);
  const next = vi.fn(); await act(async () => { await view.result.current.save(next); }); expect(next).toHaveBeenCalledWith(accepted);
});
it('blocks implicit recreation after a deleted uncertain create and resets only on a new selection', async () => {
  const empty = { ...initial, existing: null, retained: null as PreviewComment | null };
  const view = renderHook(props => useRootCommentEditor(props), { initialProps: empty });
  const deleted = vi.fn().mockRejectedValue(new RootCommentWriteError(410));
  await act(async () => { await view.result.current.save(deleted); }); expect(view.result.current.deleted).toBe(true);
  const repeat = vi.fn(); await act(async () => { await view.result.current.save(repeat); }); expect(repeat).not.toHaveBeenCalled();
  view.rerender({ ...empty, selectionKey: 'new selection' }); expect(view.result.current.deleted).toBe(false);
});
it('does not roll an acknowledged baseline back when unchanged parent props rerender first', async () => {
  const onDraft = vi.fn();
  const props = { ...initial, draft: 'Local edit', onDraft };
  const view = renderHook(value => useRootCommentEditor(value), { initialProps: props });
  const accepted = { ...root, note: 'Local edit', editToken: 'accepted' };
  await act(async () => { await view.result.current.save(async () => accepted); });
  const laterCallback = vi.fn();
  view.rerender({ ...props, onDraft: laterCallback });
  expect(laterCallback).not.toHaveBeenCalled(); expect(view.result.current.stale).toBe(false);
  const next = vi.fn(); await act(async () => { await view.result.current.save(next); }); expect(next).toHaveBeenCalledWith(accepted);
});
