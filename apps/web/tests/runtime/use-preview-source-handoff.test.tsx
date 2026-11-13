// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { usePreviewSourceHandoff } from '../../src/runtime/use-preview-source-handoff';
afterEach(cleanup);
const first = { generation: 'first' }, next = { generation: 'next' }, latest = { generation: 'latest' };
function gate() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
it('waits for the exact outgoing capture before admitting a replacement', async () => {
  const pending = gate(), capture = vi.fn(() => pending.promise);
  const { result, rerender } = renderHook(({ candidate, enabled }) => usePreviewSourceHandoff(candidate, 'same-file', enabled, capture), { initialProps: { candidate: first, enabled: false } });
  expect(result.current).toBe(true); rerender({ candidate: next, enabled: true }); expect(result.current).toBe(false);
  await waitFor(() => expect(capture).toHaveBeenCalledWith(true));
  await act(async () => pending.resolve()); await waitFor(() => expect(result.current).toBe(true));
});
it('retires a superseded capture without admitting the newer candidate early', async () => {
  const older = gate(), newer = gate(), capture = vi.fn().mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
  const { result, rerender } = renderHook(({ candidate }) => usePreviewSourceHandoff(candidate, 'same-file', candidate !== first, capture), { initialProps: { candidate: first } });
  rerender({ candidate: next }); await waitFor(() => expect(capture).toHaveBeenCalledTimes(1));
  rerender({ candidate: latest }); await waitFor(() => expect(capture).toHaveBeenCalledTimes(2));
  await act(async () => older.resolve()); expect(result.current).toBe(false);
  await act(async () => newer.resolve()); await waitFor(() => expect(result.current).toBe(true));
});
it('does not block a different scope or keep a replacement blocked after capture failure', async () => {
  const pending = gate(), capture = vi.fn().mockReturnValueOnce(pending.promise).mockRejectedValueOnce(new Error('Frame retired'));
  const { result, rerender } = renderHook(({ candidate, scope, enabled }) => usePreviewSourceHandoff(candidate, scope, enabled, capture), { initialProps: { candidate: first, scope: 'first-file', enabled: false } });
  rerender({ candidate: next, scope: 'first-file', enabled: true }); await waitFor(() => expect(capture).toHaveBeenCalledTimes(1));
  rerender({ candidate: latest, scope: 'other-file', enabled: false }); expect(result.current).toBe(true);
  await act(async () => pending.resolve()); expect(result.current).toBe(true);
  rerender({ candidate: next, scope: 'other-file', enabled: true }); await waitFor(() => expect(result.current).toBe(true));
});
