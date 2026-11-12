import { afterEach, expect, it, vi } from 'vitest';
import { acquireWorkbookDraftLease } from '../../src/components/embedded/workbook/draft-lease';

const scope = { viewerId: 'person-one', projectId: '18a8301a-b6e1-4001-8000-c967b1eab222', fileName: 'Forecast.xlsx', draftId: '18a8301a-b6e1-4001-8000-c967b1eab224' };
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
function browser() {
  const held = new Set<string>();
  const gate = deferred(); let delayed = false;
  const request = vi.fn(async (key: string, options: LockOptions, callback: (lock: Lock | null) => Promise<void>) => {
    expect(options).toEqual({ mode: 'exclusive', ifAvailable: true });
    await Promise.resolve(); if (delayed) await gate.promise;
    if (held.has(key)) return callback(null);
    held.add(key);
    try { await callback({ name: key, mode: 'exclusive' } as Lock); }
    finally { held.delete(key); }
  });
  vi.stubGlobal('navigator', { locks: { request } });
  return { held, request, delay: () => { delayed = true; }, resume: gate.resolve };
}
afterEach(() => vi.unstubAllGlobals());
it('refuses another owner of the exact draft while allowing independent accounts, files and branches', async () => {
  const locks = browser(); const lease = await acquireWorkbookDraftLease(scope); expect(lease).not.toBeNull();
  expect(await acquireWorkbookDraftLease(scope)).toBeNull();
  for (const changed of [{ viewerId: 'person-two' }, { fileName: 'Other.xlsx' }, { projectId: '18a8301a-b6e1-4001-8000-c967b1eab223' }, { draftId: '18a8301a-b6e1-4001-8000-c967b1eab225' }]) {
    const other = await acquireWorkbookDraftLease({ ...scope, ...changed }); expect(other).not.toBeNull(); await other!.release(async () => {});
  }
  await lease!.release(async () => {}); expect(locks.held.size).toBe(0);
});
it('holds ownership through pending journal writes and shares idempotent release', async () => {
  browser(); const lease = (await acquireWorkbookDraftLease(scope))!; const pending = deferred(); const drain = vi.fn(() => pending.promise);
  const first = lease.release(drain), second = lease.release(drain); expect(first).toBe(second);
  expect(await acquireWorkbookDraftLease(scope)).toBeNull(); pending.resolve(); await first;
  expect(drain).toHaveBeenCalledTimes(1); await lease.release(drain); expect(drain).toHaveBeenCalledTimes(1);
  const next = (await acquireWorkbookDraftLease(scope))!; await next.release(async () => {});
});
it('retains ownership on asynchronous and synchronous drain failure until a successful retry', async () => {
  browser(); const lease = (await acquireWorkbookDraftLease(scope))!;
  await expect(lease.release(async () => { throw Error('journal failed'); })).rejects.toThrow('journal failed');
  await expect(lease.release(() => { throw Error('drain threw'); })).rejects.toThrow('drain threw');
  expect(await acquireWorkbookDraftLease(scope)).toBeNull(); await lease.release(async () => {});
  const next = (await acquireWorkbookDraftLease(scope))!; await next.release(async () => {});
});
it('fails closed when unavailable or already cancelled', async () => {
  vi.stubGlobal('navigator', {}); expect(await acquireWorkbookDraftLease(scope)).toBeNull();
  const locks = browser(), cancel = new AbortController(); cancel.abort();
  expect(await acquireWorkbookDraftLease(scope, cancel.signal)).toBeNull(); expect(locks.request).not.toHaveBeenCalled();
});
it('cancels promptly and relinquishes a late grant after unmount without handing out a lease', async () => {
  const locks = browser(); locks.delay(); const cancel = new AbortController();
  const pending = acquireWorkbookDraftLease(scope, cancel.signal); cancel.abort(); expect(await pending).toBeNull();
  locks.resume(); await Promise.all(locks.request.mock.results.map(result => result.value)); expect(locks.held.size).toBe(0);
  const next = (await acquireWorkbookDraftLease(scope))!; await next.release(async () => {});
});
it('does not drop active ownership on later abort before the caller drains its journal', async () => {
  browser(); const cancel = new AbortController(), lease = (await acquireWorkbookDraftLease(scope, cancel.signal))!;
  cancel.abort(); expect(await acquireWorkbookDraftLease(scope)).toBeNull(); await lease.release(async () => {});
});
it('surfaces browser acquisition errors without fallback ownership', async () => {
  browser(); vi.stubGlobal('navigator', { locks: { request: () => Promise.reject(Error('denied')) } });
  await expect(acquireWorkbookDraftLease(scope)).rejects.toThrow('denied');
  vi.stubGlobal('navigator', { locks: { request: () => { throw Error('unsupported context'); } } });
  await expect(acquireWorkbookDraftLease(scope)).rejects.toThrow('unsupported context');
});
it('reports browser release failure after drain without an unhandled request rejection', async () => {
  const locks = browser(); const original = locks.request.getMockImplementation()!;
  locks.request.mockImplementation(async (...args) => { await original(...args); throw Error('browser release failed'); });
  const lease = (await acquireWorkbookDraftLease(scope))!;
  await expect(lease.release(async () => {})).rejects.toThrow('browser release failed');
  expect(locks.held.size).toBe(0);
});
