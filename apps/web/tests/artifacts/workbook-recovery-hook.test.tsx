// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useWorkbookRecovery } from '../../src/components/embedded/workbook/use-workbook-recovery';
import { acquireWorkbookDraftLease } from '../../src/components/embedded/workbook/draft-lease';
import { listWorkbookDrafts, readWorkbookDraft, saveWorkbookDraft } from '../../src/components/embedded/workbook/draft-store';
import { workbookRecoveryFixture } from '../helpers/workbook-recovery-fixture';
import { awaitRetiredWorkbookDrafts } from '../../src/components/embedded/workbook/draft-retirement';
vi.mock('../../src/components/embedded/workbook/draft-lease', () => ({ acquireWorkbookDraftLease: vi.fn() }));
vi.mock('../../src/components/embedded/workbook/draft-store', () => ({ listWorkbookDrafts: vi.fn(), readWorkbookDraft: vi.fn(), saveWorkbookDraft: vi.fn() }));
const scope = { viewerId: 'evebot:person', projectId: '66a28381-a8cf-40cd-91d2-b1f9cd696ac0', fileName: 'Forecast.xlsx' };
const draftId = '66a28381-a8cf-40cd-91d2-b1f9cd696ac1';
const head = { id: 'branch', draftId, artifactKey: 'artifact', updatedAt: 1 };
const acquire = vi.mocked(acquireWorkbookDraftLease), list = vi.mocked(listWorkbookDrafts), read = vi.mocked(readWorkbookDraft), save = vi.mocked(saveWorkbookDraft);
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
beforeEach(() => { vi.resetAllMocks(); list.mockResolvedValue([]); save.mockResolvedValue(); });
afterEach(async () => { cleanup(); await awaitRetiredWorkbookDrafts(scope); });
it('reads nothing until a fresh authorized preview exists', async () => {
  const hook = renderHook(() => useWorkbookRecovery(scope, false, async () => {}));
  expect(hook.result.current.session).toBeNull(); expect(list).not.toHaveBeenCalled(); expect(acquire).not.toHaveBeenCalled();
});
it('claims a distinct new editor branch and writes only inside its account and artifact', async () => {
  const release = vi.fn(async drain => { await drain(); }); acquire.mockResolvedValue({ release });
  const hook = renderHook(() => useWorkbookRecovery(scope, true, async () => {}));
  await waitFor(() => expect(hook.result.current.session).not.toBeNull());
  const session = hook.result.current.session!;
  expect(session.scope).toEqual({ ...scope, draftId: expect.any(String) });
  expect(session.scope.draftId).not.toBe(draftId);
  await session.journal.save(null); expect(save).toHaveBeenCalledWith(session.scope, null);
});
it('prompts before reading a retained branch and refuses a branch still owned by another tab', async () => {
  list.mockResolvedValue([head]); acquire.mockResolvedValue(null);
  const hook = renderHook(() => useWorkbookRecovery(scope, true, async () => {}));
  await waitFor(() => expect(hook.result.current.drafts).toHaveLength(1));
  expect(read).not.toHaveBeenCalled();
  await act(() => hook.result.current.restore(draftId));
  expect(acquire).toHaveBeenCalledWith({ ...scope, draftId }, expect.any(AbortSignal));
  expect(read).not.toHaveBeenCalled(); expect(hook.result.current.session).toBeNull(); expect(hook.result.current.error).toContain('another tab');
});
it('refuses to delete a draft owned by another editor', async () => {
  list.mockResolvedValue([head]); acquire.mockResolvedValue(null);
  const hook = renderHook(() => useWorkbookRecovery(scope, true, async () => {}));
  await waitFor(() => expect(hook.result.current.drafts).toHaveLength(1));
  await act(() => hook.result.current.discard(draftId));
  expect(save).not.toHaveBeenCalled(); expect(hook.result.current.drafts).toHaveLength(1);
});
it('does not discard a closed editor branch whose save result remains uncertain', async () => {
  list.mockResolvedValue([head]); const checkpoint = workbookRecoveryFixture(scope.projectId, scope.fileName);
  checkpoint.pending = { intent: { id: crypto.randomUUID(), preparationId: crypto.randomUUID(), previewId: crypto.randomUUID(), plan: { sourceSha256: checkpoint.source.sourceSha256, edits: [] } }, snapshot: checkpoint.desired };
  read.mockResolvedValue(checkpoint); const release = vi.fn(async drain => { await drain(); }); acquire.mockResolvedValue({ release });
  const hook = renderHook(() => useWorkbookRecovery(scope, true, async () => {}));
  await waitFor(() => expect(hook.result.current.drafts).toHaveLength(1)); await act(() => hook.result.current.discard(draftId));
  expect(save).not.toHaveBeenCalled(); expect(hook.result.current.error).toContain('check its save status'); expect(release).toHaveBeenCalledOnce();
});
it('waits for deletion to commit before removing a branch from the recovery list', async () => {
  const commit = deferred<void>(); save.mockReturnValue(commit.promise);
  list.mockResolvedValueOnce([head]).mockResolvedValueOnce([]);
  const release = vi.fn(async drain => { await drain(); }); acquire.mockResolvedValue({ release });
  const hook = renderHook(() => useWorkbookRecovery(scope, true, async () => {}));
  await waitFor(() => expect(hook.result.current.drafts).toHaveLength(1));
  let deleting!: Promise<void>; act(() => { deleting = hook.result.current.discard(draftId); });
  await waitFor(() => expect(save).toHaveBeenCalled()); expect(hook.result.current.drafts).toHaveLength(1);
  await act(async () => { commit.resolve(); await deleting; });
  expect(hook.result.current.drafts).toHaveLength(0); expect(release).toHaveBeenCalledOnce();
});
it('detaches the writer synchronously and keeps its lease until the journal settles', async () => {
  const drain = deferred<void>(), finished = vi.fn(), close = vi.fn(() => drain.promise);
  const release = vi.fn(async callback => { await callback(); finished(); }); acquire.mockResolvedValue({ release });
  const hook = renderHook(() => useWorkbookRecovery(scope, true, close));
  await waitFor(() => expect(hook.result.current.session).not.toBeNull()); hook.unmount();
  expect(close).toHaveBeenCalledOnce(); expect(finished).not.toHaveBeenCalled();
  await act(async () => { drain.resolve(); await Promise.resolve(); }); expect(finished).toHaveBeenCalledOnce();
});
it('releases a late grant after unmount without reading a draft or publishing an editor', async () => {
  list.mockResolvedValue([head]); const grant = deferred<Awaited<ReturnType<typeof acquireWorkbookDraftLease>>>(); acquire.mockReturnValue(grant.promise);
  const release = vi.fn(async drain => { await drain(); });
  const hook = renderHook(() => useWorkbookRecovery(scope, true, async () => {}));
  await waitFor(() => expect(hook.result.current.drafts).toHaveLength(1));
  let restoring!: Promise<void>; act(() => { restoring = hook.result.current.restore(draftId); });
  await waitFor(() => expect(acquire).toHaveBeenCalledOnce());
  hook.unmount(); await act(async () => { grant.resolve({ release }); await restoring; });
  expect(read).not.toHaveBeenCalled(); expect(release).toHaveBeenCalledOnce();
});
it('clears busy and retains an actionable error if a temporary lease cannot release', async () => {
  list.mockResolvedValue([head]); read.mockResolvedValue(null);
  const release = vi.fn(async drain => { await drain(); }).mockRejectedValueOnce(new Error('browser release failed'));
  acquire.mockResolvedValue({ release });
  const hook = renderHook(() => useWorkbookRecovery(scope, true, async () => {}));
  await waitFor(() => expect(hook.result.current.drafts).toHaveLength(1)); await act(() => hook.result.current.restore(draftId));
  expect(hook.result.current.busy).toBe(false); expect(hook.result.current.error).toContain('released safely');
  await awaitRetiredWorkbookDrafts(scope); expect(release).toHaveBeenCalledTimes(2);
});
