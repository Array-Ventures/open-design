import { beforeEach, expect, it, vi } from 'vitest';
import type { WorkbookDraftLease } from '../../src/components/embedded/workbook/draft-lease';
const scope = { viewerId: 'person-one', projectId: '18a8301a-b6e1-4001-8000-c967b1eab222', fileName: 'Forecast.xlsx', draftId: '18a8301a-b6e1-4001-8000-c967b1eab224' };
function deferred() { let resolve!: () => void; let reject!: (error: Error) => void; const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; }
function lease() { const release = vi.fn(async (drain: () => Promise<void>) => { await drain(); }); return { release } satisfies WorkbookDraftLease; }
beforeEach(() => vi.resetModules());
it('blocks reopening until pending journal drain and browser release both complete', async () => {
  const { retireWorkbookDraft, awaitRetiredWorkbookDrafts } = await import('../../src/components/embedded/workbook/draft-retirement');
  const drain = deferred(), browser = deferred(), owned = lease();
  owned.release.mockImplementation(async work => { await work(); await browser.promise; });
  retireWorkbookDraft(scope, owned, drain.promise);
  let reopened = false; const ready = awaitRetiredWorkbookDrafts(scope).then(() => { reopened = true; });
  await Promise.resolve(); expect(reopened).toBe(false);
  drain.resolve(); await Promise.resolve(); expect(reopened).toBe(false);
  browser.resolve(); await ready; expect(reopened).toBe(true); expect(owned.release).toHaveBeenCalledTimes(1);
  await awaitRetiredWorkbookDrafts(scope); expect(owned.release).toHaveBeenCalledTimes(1);
});
it('retains a failed retirement for same-tab retry rather than dropping its ownership handle', async () => {
  const { retireWorkbookDraft, awaitRetiredWorkbookDrafts } = await import('../../src/components/embedded/workbook/draft-retirement');
  const owned = lease(); owned.release.mockRejectedValueOnce(Error('browser release interrupted'));
  retireWorkbookDraft(scope, owned, Promise.resolve());
  await vi.waitFor(() => expect(owned.release).toHaveBeenCalledTimes(1));
  await awaitRetiredWorkbookDrafts(scope); expect(owned.release).toHaveBeenCalledTimes(2);
  await awaitRetiredWorkbookDrafts(scope); expect(owned.release).toHaveBeenCalledTimes(2);
});
it('never treats a rejected drain as completed and reports the keep-copy/reload recovery path', async () => {
  const { retireWorkbookDraft, awaitRetiredWorkbookDrafts } = await import('../../src/components/embedded/workbook/draft-retirement');
  const owned = lease(), drain = deferred(); retireWorkbookDraft(scope, owned, drain.promise); drain.reject(Error('journal write failed'));
  await expect(awaitRetiredWorkbookDrafts(scope)).rejects.toThrow(/Keep a recovery copy and reload/);
  await expect(awaitRetiredWorkbookDrafts(scope)).rejects.toThrow(/Keep a recovery copy and reload/);
  expect(owned.release).toHaveBeenCalledTimes(2);
});
it('groups all draft branches of the same artifact while isolating account, project and file', async () => {
  const { retireWorkbookDraft, awaitRetiredWorkbookDrafts } = await import('../../src/components/embedded/workbook/draft-retirement');
  const drain = deferred(), first = lease(), second = lease();
  retireWorkbookDraft(scope, first, drain.promise);
  retireWorkbookDraft({ ...scope, draftId: '18a8301a-b6e1-4001-8000-c967b1eab225' }, second, drain.promise);
  for (const other of [{ viewerId: 'person-two' }, { projectId: '18a8301a-b6e1-4001-8000-c967b1eab226' }, { fileName: 'Other.xlsx' }]) await awaitRetiredWorkbookDrafts({ ...scope, ...other });
  let done = false; const ready = awaitRetiredWorkbookDrafts(scope).then(() => { done = true; }); await Promise.resolve(); expect(done).toBe(false);
  drain.resolve(); await ready; expect(first.release).toHaveBeenCalledTimes(1); expect(second.release).toHaveBeenCalledTimes(1);
});
it('observes void cleanup rejections and deduplicates repeat retirement of the same lease', async () => {
  const { retireWorkbookDraft, awaitRetiredWorkbookDrafts } = await import('../../src/components/embedded/workbook/draft-retirement');
  const unhandled = vi.fn(); process.on('unhandledRejection', unhandled);
  try {
    const owned = lease(), failed = Promise.reject(Error('unavailable'));
    retireWorkbookDraft(scope, owned, failed); retireWorkbookDraft(scope, owned, failed);
    await new Promise(resolve => setTimeout(resolve, 0)); expect(unhandled).not.toHaveBeenCalled(); expect(owned.release).toHaveBeenCalledTimes(1);
    await expect(awaitRetiredWorkbookDrafts(scope)).rejects.toThrow('could not be released safely');
  } finally { process.off('unhandledRejection', unhandled); }
});
