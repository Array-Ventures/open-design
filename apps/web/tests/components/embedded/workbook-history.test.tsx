// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useWorkbookHistory } from '../../../src/components/embedded/workbook/use-workbook-history';
const mocks = vi.hoisted(() => ({ list: vi.fn(), store: vi.fn(), restore: vi.fn(), preview: vi.fn(), lease: vi.fn() }));
vi.mock('../../../src/components/embedded/workbook/history-transport', () => ({ listWorkbookHistory: mocks.list }));
vi.mock('../../../src/components/embedded/workbook/draft-store', () => ({ accessWorkbookRestore: mocks.store }));
vi.mock('../../../src/components/embedded/workbook/restore-transport', async original => ({ ...await original<object>(), restoreWorkbookVersion: mocks.restore }));
vi.mock('../../../src/components/embedded/workbook/preview-transport', async original => ({ ...await original<object>(), loadWorkbookPreview: mocks.preview }));
vi.mock('../../../src/components/embedded/workbook/draft-lease', () => ({ acquireWorkbookDraftLease: mocks.lease }));
const scope = { viewerId: 'person', projectId: '18a8301a-b6e1-4001-8000-c967b1eab222', fileName: 'book.xlsx' };
const sha = 'a'.repeat(64), target = 'b'.repeat(64);
const revision = { id: 'immutable-v1', fileName: scope.fileName, version: 1, label: '', createdAt: 1, source: 'manual' as const, size: 10, current: false, contentDigest: target };
const source = { sourceSha256: sha, model: {} as never };
function fixture(dirty = false) {
  let record: unknown = null;
  mocks.store.mockImplementation(async (_scope, change) => { if (change) record = change.value; return record; });
  mocks.list.mockResolvedValue({ versions: [revision], nextCursor: 'next', currentSha256: sha });
  mocks.lease.mockResolvedValue({ release: vi.fn(async () => {}) });
  mocks.restore.mockResolvedValue({ targetSha256: target }); mocks.preview.mockResolvedValue({ ...source, sourceSha256: target });
  const options = { scope, source, ready: true, dirty: () => dirty, pause: vi.fn(async () => true), resume: vi.fn(async () => {}), accepted: vi.fn() };
  return { options, record: () => record };
}
afterEach(() => { cleanup(); vi.resetAllMocks(); });
it('browses passively, protects exact IDs, and acknowledges only after a matching refreshed model', async () => {
  const { options, record } = fixture(); const view = renderHook(() => useWorkbookHistory(options));
  await waitFor(() => expect(view.result.current.checking).toBe(false));
  act(() => view.result.current.show()); await waitFor(() => expect(view.result.current.versions).toHaveLength(1));
  expect(mocks.restore).not.toHaveBeenCalled();
  act(() => view.result.current.select(revision));
  mocks.restore.mockImplementation(async (intent, protect) => { expect(record()).toEqual(intent); await protect(); return { targetSha256: target }; });
  await act(async () => view.result.current.restore());
  expect(options.pause).toHaveBeenCalledOnce(); expect(options.accepted).toHaveBeenCalledWith({ ...source, sourceSha256: target });
  expect(options.resume).toHaveBeenCalledWith(true); expect(record()).toBeNull(); expect(view.result.current.open).toBe(false);
});
it('never prepares or replaces an unsaved draft, and rejects stale current-source selection', async () => {
  const { options } = fixture(true); const view = renderHook(() => useWorkbookHistory(options));
  await waitFor(() => expect(view.result.current.checking).toBe(false)); act(() => view.result.current.show());
  await waitFor(() => expect(view.result.current.versions).toHaveLength(1)); act(() => view.result.current.select(revision));
  await act(async () => view.result.current.restore()); expect(mocks.restore).not.toHaveBeenCalled(); expect(options.pause).not.toHaveBeenCalled();
  expect(view.result.current.error).toContain('unsaved');
});
it('retains uncertain operation IDs across retries', async () => {
  const { options, record } = fixture(); let fail = true;
  mocks.restore.mockImplementation(async () => { if (fail) throw Error('Lost response'); return { targetSha256: target }; });
  const view = renderHook(() => useWorkbookHistory(options)); await waitFor(() => expect(view.result.current.checking).toBe(false));
  act(() => view.result.current.show()); await waitFor(() => expect(view.result.current.versions).toHaveLength(1)); act(() => view.result.current.select(revision));
  await act(async () => view.result.current.restore()); const saved = record(); expect(saved).toBeTruthy(); expect(view.result.current.blocked).toBe(true);
  fail = false; await act(async () => view.result.current.restore()); expect(mocks.restore.mock.calls[1]![0]).toEqual(saved); expect(record()).toBeNull();
  expect(options.accepted).toHaveBeenCalledOnce();
});

it('does not acknowledge or clear an old account generation after unmount', async () => {
  const { options, record } = fixture(); let resolve!: (value: unknown) => void;
  mocks.restore.mockImplementation(() => new Promise(done => { resolve = done; }));
  const view = renderHook(() => useWorkbookHistory(options)); await waitFor(() => expect(view.result.current.checking).toBe(false));
  act(() => view.result.current.show()); await waitFor(() => expect(view.result.current.versions).toHaveLength(1)); act(() => view.result.current.select(revision));
  let running!: Promise<void>; act(() => { running = view.result.current.restore(); });
  await waitFor(() => expect(mocks.restore).toHaveBeenCalledOnce()); const saved = record(); view.unmount();
  await act(async () => { resolve({ targetSha256: target }); await running; });
  expect(options.accepted).not.toHaveBeenCalled(); expect(mocks.preview).not.toHaveBeenCalled(); expect(record()).toEqual(saved);
});
it('refuses a stale current SHA before starting a restore and rejects pagination across source changes', async () => {
  const { options } = fixture(); mocks.list.mockResolvedValueOnce({ versions: [revision], nextCursor: 'next', currentSha256: 'c'.repeat(64) }).mockResolvedValueOnce({ versions: [revision], nextCursor: 'next', currentSha256: 'c'.repeat(64) });
  const view = renderHook(() => useWorkbookHistory(options)); await waitFor(() => expect(view.result.current.checking).toBe(false));
  act(() => view.result.current.show()); await waitFor(() => expect(view.result.current.versions).toHaveLength(1)); act(() => view.result.current.select(revision));
  await act(async () => view.result.current.restore()); expect(mocks.restore).not.toHaveBeenCalled(); expect(view.result.current.error).toContain('current workbook changed');
  await act(async () => view.result.current.more()); expect(view.result.current.error).toContain('while loading history'); expect(view.result.current.versions).toHaveLength(1);
});

it.each([undefined, 'another-version'])('keeps the protected restore when receipt lineage is %s despite matching bytes', async lineage => {
  const { checkedWorkbookRestoreReceipt } = await vi.importActual<typeof import('../../../src/components/embedded/workbook/restore-transport')>('../../../src/components/embedded/workbook/restore-transport');
  const { options, record } = fixture();
  mocks.restore.mockImplementation(async intent => checkedWorkbookRestoreReceipt({ id: intent.operationId, projectId: intent.projectId, fileName: intent.fileName,
    renderId: '18a8301a-b6e1-4001-8000-c967b1eab223', state: 'applied', sourceSha256: intent.sourceSha256, targetSha256: intent.versionSha256,
    actualSha256: intent.versionSha256, versionId: 'restored-v2', ...(lineage ? { restoreFromVersionId: lineage } : {}) }, intent));
  const view = renderHook(() => useWorkbookHistory(options)); await waitFor(() => expect(view.result.current.checking).toBe(false));
  act(() => view.result.current.show()); await waitFor(() => expect(view.result.current.versions).toHaveLength(1)); act(() => view.result.current.select(revision));
  await act(async () => view.result.current.restore());
  expect(record()).toEqual(view.result.current.intent); expect(record()).toBeTruthy(); expect(view.result.current.blocked).toBe(true);
  expect(options.accepted).not.toHaveBeenCalled(); expect(mocks.preview).not.toHaveBeenCalled();
  expect(mocks.store.mock.calls.some(([, change]) => change && change.value === null)).toBe(false);
});
it('waits for fresh authorized history before reading restore IDs even when the preview is corrupt', async () => {
  const { options } = fixture(); let resolve!: (value: unknown) => void;
  mocks.list.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const view = renderHook(() => useWorkbookHistory({ ...options, source: null, ready: false }));
  expect(mocks.store).not.toHaveBeenCalled(); expect(view.result.current.checking).toBe(true);
  await act(async () => { resolve({ versions: [revision], nextCursor: null, currentSha256: sha }); });
  await waitFor(() => expect(view.result.current.checking).toBe(false));
  expect(mocks.store).toHaveBeenCalledExactlyOnceWith(scope); expect(view.result.current.available).toBe(true);
  expect(mocks.restore).not.toHaveBeenCalled();
});
it('recovers a corrupt current file with the exact raw history SHA without requiring an editable draft session', async () => {
  const { options, record } = fixture(); const view = renderHook(() => useWorkbookHistory({ ...options, source: null, ready: false }));
  await waitFor(() => expect(view.result.current.checking).toBe(false)); act(() => view.result.current.select(revision));
  await act(async () => view.result.current.restore());
  expect(mocks.restore.mock.calls[0]![0]).toMatchObject({ sourceSha256: sha, versionId: revision.id, versionSha256: target });
  expect(options.accepted).toHaveBeenCalledWith({ ...source, sourceSha256: target }); expect(record()).toBeNull();
});
it('refuses source changes discovered by restore preflight and never resurrects a missing current file', async () => {
  const { options, record } = fixture();
  mocks.list.mockResolvedValueOnce({ versions: [revision], nextCursor: null, currentSha256: sha }).mockResolvedValueOnce({ versions: [revision], nextCursor: null, currentSha256: 'c'.repeat(64) }).mockResolvedValueOnce({ versions: [revision], nextCursor: null, currentSha256: null });
  const view = renderHook(() => useWorkbookHistory({ ...options, source: null, ready: false }));
  await waitFor(() => expect(view.result.current.checking).toBe(false)); act(() => view.result.current.select(revision));
  await act(async () => view.result.current.restore()); expect(mocks.restore).not.toHaveBeenCalled(); expect(record()).toBeNull(); expect(view.result.current.error).toContain('current workbook changed');
  await act(async () => view.result.current.refresh()); act(() => view.result.current.select(revision));
  await act(async () => view.result.current.restore()); expect(mocks.restore).not.toHaveBeenCalled(); expect(record()).toBeNull(); expect(view.result.current.error).toContain('missing');
});
it.each([401, 403, 404])('hides metadata and controls on access denial %s without reading protected restore IDs', async status => {
  const { WorkbookHostError } = await import('../../../src/components/embedded/workbook/host-request');
  const { options } = fixture(); const lost = vi.fn(); mocks.list.mockRejectedValueOnce(new WorkbookHostError('Denied', status));
  const view = renderHook(() => useWorkbookHistory({ ...options, source: null, ready: false, onAccessLost: lost }));
  await waitFor(() => expect(view.result.current.canOpen).toBe(false));
  expect(view.result.current.versions).toEqual([]); expect(view.result.current.intent).toBeNull(); expect(view.result.current.checking).toBe(false);
  expect(mocks.store).not.toHaveBeenCalled(); expect(lost).toHaveBeenCalledOnce();
});
it('leaves an applied but unpreviewable revision recoverable through another selected revision', async () => {
  const { WorkbookHostError } = await import('../../../src/components/embedded/workbook/host-request');
  const { options, record } = fixture(); const unreadable = vi.fn();
  mocks.preview.mockRejectedValueOnce(new WorkbookHostError('Corrupt ZIP', 422));
  mocks.list.mockResolvedValueOnce({ versions: [revision], nextCursor: null, currentSha256: sha }).mockResolvedValueOnce({ versions: [revision], nextCursor: null, currentSha256: sha }).mockResolvedValueOnce({ versions: [revision], nextCursor: null, currentSha256: target });
  const view = renderHook(() => useWorkbookHistory({ ...options, source: null, ready: false, unreadable }));
  await waitFor(() => expect(view.result.current.checking).toBe(false)); act(() => view.result.current.select(revision));
  await act(async () => view.result.current.restore());
  expect(record()).toBeNull(); expect(view.result.current.open).toBe(true); expect(view.result.current.blocked).toBe(false);
  expect(unreadable).toHaveBeenCalledOnce(); expect(view.result.current.error).toContain('cannot be previewed');
});
it('hides previously authorized restore metadata on revocation while retaining its protected record', async () => {
  const { WorkbookHostError } = await import('../../../src/components/embedded/workbook/host-request');
  const { options, record } = fixture();
  const pending = { version: 1, ...scope, operationId: '18a8301a-b6e1-4001-8000-c967b1eab227', preparationId: '18a8301a-b6e1-4001-8000-c967b1eab226', sourceSha256: sha, versionSha256: target, versionId: revision.id };
  await mocks.store(scope, { expected: null, value: pending }); mocks.store.mockClear();
  const view = renderHook(() => useWorkbookHistory({ ...options, source: null, ready: false }));
  await waitFor(() => expect(view.result.current.intent).toEqual(pending));
  mocks.list.mockRejectedValueOnce(new WorkbookHostError('Access revoked', 403));
  await act(async () => view.result.current.refresh());
  expect(view.result.current.canOpen).toBe(false); expect(view.result.current.intent).toBeNull(); expect(view.result.current.versions).toEqual([]);
  expect(record()).toEqual(pending); expect(mocks.store.mock.calls.every(([, change]) => change === undefined)).toBe(true);
});

function retainedIntent() {
  return { version: 1, ...scope, operationId: '18a8301a-b6e1-4001-8000-c967b1eab227', preparationId: '18a8301a-b6e1-4001-8000-c967b1eab226', sourceSha256: sha, versionSha256: target, versionId: revision.id };
}
it('reconciles a lost applied acknowledgement after file deletion without previewing or recreating it', async () => {
  const { options, record } = fixture(); const pending = retainedIntent(), unreadable = vi.fn();
  await mocks.store(scope, { expected: null, value: pending }); mocks.store.mockClear();
  mocks.list.mockResolvedValue({ versions: [revision], nextCursor: null, currentSha256: null });
  const view = renderHook(() => useWorkbookHistory({ ...options, source: null, ready: false, unreadable }));
  await waitFor(() => expect(view.result.current.intent).toEqual(pending));
  await act(async () => view.result.current.restore());
  expect(mocks.restore).toHaveBeenCalledExactlyOnceWith(pending, expect.any(Function), expect.any(AbortSignal), { allowPrepare: false });
  expect(record()).toBeNull(); expect(view.result.current.intent).toBeNull(); expect(view.result.current.canOpen).toBe(true); expect(view.result.current.missing).toBe(true);
  expect(view.result.current.error).toContain('now missing'); expect(mocks.preview).not.toHaveBeenCalled(); expect(options.pause).not.toHaveBeenCalled();
  expect(unreadable).toHaveBeenCalledWith(expect.stringContaining('not recreated'), false);
});
it('accepts an exact terminal receipt before checking a changed source and then clears only that operation', async () => {
  const { WorkbookRestoreFinishedError } = await import('../../../src/components/embedded/workbook/restore-transport');
  const { options, record } = fixture(); const pending = retainedIntent();
  await mocks.store(scope, { expected: null, value: pending }); mocks.store.mockClear();
  mocks.list.mockResolvedValue({ versions: [revision], nextCursor: null, currentSha256: 'c'.repeat(64) });
  mocks.restore.mockRejectedValueOnce(new WorkbookRestoreFinishedError('conflict', 'The current workbook changed. Nothing was overwritten.'));
  const view = renderHook(() => useWorkbookHistory({ ...options, source: null, ready: false }));
  await waitFor(() => expect(view.result.current.intent).toEqual(pending)); await act(async () => view.result.current.restore());
  expect(mocks.restore.mock.invocationCallOrder[0]).toBeLessThan(mocks.list.mock.invocationCallOrder[1]!);
  expect(record()).toBeNull(); expect(view.result.current.sha).toBe('c'.repeat(64)); expect(options.pause).not.toHaveBeenCalled();
});
it.each([null, 'c'.repeat(64)])('keeps a receipt-404 intent protected when current SHA is %s and submits no preparation', async currentSha256 => {
  const { WorkbookRestoreReceiptUnavailableError } = await import('../../../src/components/embedded/workbook/restore-transport');
  const { options, record } = fixture(); const pending = retainedIntent();
  await mocks.store(scope, { expected: null, value: pending }); mocks.store.mockClear();
  mocks.list.mockResolvedValue({ versions: [revision], nextCursor: null, currentSha256 }); mocks.restore.mockRejectedValueOnce(new WorkbookRestoreReceiptUnavailableError());
  const view = renderHook(() => useWorkbookHistory({ ...options, source: null, ready: false }));
  await waitFor(() => expect(view.result.current.intent).toEqual(pending)); await act(async () => view.result.current.restore());
  expect(mocks.restore).toHaveBeenCalledExactlyOnceWith(pending, expect.any(Function), expect.any(AbortSignal), { allowPrepare: false });
  expect(record()).toEqual(pending); expect(view.result.current.intent).toEqual(pending); expect(options.pause).not.toHaveBeenCalled(); expect(mocks.preview).not.toHaveBeenCalled();
  expect(mocks.store.mock.calls.some(([, change]) => change && change.value === null)).toBe(false);
});
it('withdraws metadata after receipt reconciliation loses project access while retaining its protected identity', async () => {
  const { WorkbookHostError } = await import('../../../src/components/embedded/workbook/host-request');
  const { options, record } = fixture(); const pending = retainedIntent();
  await mocks.store(scope, { expected: null, value: pending }); mocks.store.mockClear();
  mocks.list.mockResolvedValueOnce({ versions: [revision], nextCursor: null, currentSha256: null }).mockRejectedValueOnce(new WorkbookHostError('Access revoked', 403));
  const view = renderHook(() => useWorkbookHistory({ ...options, source: null, ready: false }));
  await waitFor(() => expect(view.result.current.intent).toEqual(pending)); await act(async () => view.result.current.restore());
  expect(record()).toEqual(pending); expect(view.result.current.canOpen).toBe(false); expect(view.result.current.intent).toBeNull(); expect(view.result.current.versions).toEqual([]);
});
it('reconciles a terminal operation without replacing an already dirty local draft', async () => {
  const { options, record } = fixture(true); const pending = retainedIntent();
  await mocks.store(scope, { expected: null, value: pending }); mocks.store.mockClear();
  mocks.list.mockResolvedValue({ versions: [revision], nextCursor: null, currentSha256: target });
  const view = renderHook(() => useWorkbookHistory(options));
  await waitFor(() => expect(view.result.current.intent).toEqual(pending)); await act(async () => view.result.current.restore());
  expect(record()).toBeNull(); expect(options.accepted).not.toHaveBeenCalled(); expect(options.pause).not.toHaveBeenCalled(); expect(mocks.preview).not.toHaveBeenCalled();
  expect(view.result.current.error).toContain('local draft was kept');
});
it.each([false, true])('classifies preview 404 through fresh history (project denied: %s)', async denied => {
  const { WorkbookHostError } = await import('../../../src/components/embedded/workbook/host-request');
  const { options, record } = fixture(); const pending = retainedIntent(), unreadable = vi.fn();
  await mocks.store(scope, { expected: null, value: pending }); mocks.store.mockClear();
  mocks.list.mockResolvedValueOnce({ versions: [revision], nextCursor: null, currentSha256: target }).mockResolvedValueOnce({ versions: [revision], nextCursor: null, currentSha256: target });
  if (denied) mocks.list.mockRejectedValueOnce(new WorkbookHostError('Project unavailable', 403));
  else mocks.list.mockResolvedValueOnce({ versions: [revision], nextCursor: null, currentSha256: null });
  mocks.preview.mockRejectedValueOnce(new WorkbookHostError('File unavailable', 404));
  const view = renderHook(() => useWorkbookHistory({ ...options, source: null, ready: false, unreadable }));
  await waitFor(() => expect(view.result.current.intent).toEqual(pending)); await act(async () => view.result.current.restore());
  expect(view.result.current.canOpen).toBe(!denied);
  if (denied) { expect(record()).toEqual(pending); expect(view.result.current.versions).toEqual([]); expect(unreadable).not.toHaveBeenCalled(); }
  else { expect(record()).toBeNull(); expect(view.result.current.missing).toBe(true); expect(unreadable).toHaveBeenCalledWith(expect.stringContaining('not recreated'), false); }
});
it('refreshes V5 to V6 on opening after an own save without asking the workbook to reload or polling while closed', async () => {
  const { options } = fixture(); let observed = source;
  const v5 = { ...revision, id: 'v5', version: 5, contentDigest: sha, current: true };
  const v6 = { ...revision, id: 'v6', version: 6, contentDigest: target, current: true };
  mocks.list.mockResolvedValueOnce({ versions: [v5], nextCursor: null, currentSha256: sha });
  const view = renderHook(() => useWorkbookHistory({ ...options, source: observed }));
  await waitFor(() => expect(view.result.current.checking).toBe(false));
  observed = { ...source, sourceSha256: target }; view.rerender();
  await act(async () => {}); expect(mocks.list).toHaveBeenCalledOnce();
  let resolve!: (value: unknown) => void; mocks.list.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  act(() => view.result.current.show());
  await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
  expect(view.result.current.fresh).toBe(false); expect(view.result.current.loading).toBe(true); expect(view.result.current.error).toBeNull();
  await act(async () => view.result.current.restore()); expect(mocks.restore).not.toHaveBeenCalled();
  await act(async () => { resolve({ versions: [v6, { ...v5, current: false }], nextCursor: null, currentSha256: target }); });
  await waitFor(() => expect(view.result.current.fresh).toBe(true));
  expect(view.result.current.sha).toBe(target); expect(view.result.current.versions[0]).toEqual(v6); expect(view.result.current.error).toBeNull();
  expect(mocks.preview).not.toHaveBeenCalled(); expect(options.accepted).not.toHaveBeenCalled();
  await act(async () => {}); expect(mocks.list).toHaveBeenCalledTimes(2);
  act(() => view.result.current.close()); mocks.list.mockResolvedValueOnce({ versions: [v6], nextCursor: null, currentSha256: target });
  act(() => view.result.current.show()); await waitFor(() => expect(view.result.current.fresh).toBe(true));
  expect(mocks.list).toHaveBeenCalledTimes(3);
});
it('refreshes an open history on acknowledged-head changes and suppresses its late previous-head response', async () => {
  const { options } = fixture(); let observed = source;
  const view = renderHook(() => useWorkbookHistory({ ...options, source: observed }));
  await waitFor(() => expect(view.result.current.checking).toBe(false));
  let old!: (value: unknown) => void; mocks.list.mockImplementationOnce(() => new Promise(done => { old = done; }));
  act(() => view.result.current.show()); await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
  const oldSignal = mocks.list.mock.calls[1]![2] as AbortSignal;
  const v6 = { ...revision, id: 'v6', version: 6, contentDigest: target, current: true };
  mocks.list.mockResolvedValueOnce({ versions: [v6], nextCursor: null, currentSha256: target });
  observed = { ...source, sourceSha256: target }; view.rerender();
  await waitFor(() => expect(view.result.current.fresh).toBe(true)); expect(oldSignal.aborted).toBe(true);
  await act(async () => { old({ versions: [revision], nextCursor: null, currentSha256: sha }); });
  expect(view.result.current.sha).toBe(target); expect(view.result.current.versions).toEqual([v6]); expect(mocks.list).toHaveBeenCalledTimes(3);
});
it('keeps a failed head refresh retryable without admitting a restore or continuously refetching', async () => {
  const { options } = fixture(); const view = renderHook(() => useWorkbookHistory(options));
  await waitFor(() => expect(view.result.current.checking).toBe(false)); mocks.list.mockRejectedValueOnce(Error('Offline'));
  act(() => view.result.current.show()); await waitFor(() => expect(view.result.current.error).toBe('Offline'));
  expect(view.result.current.fresh).toBe(false); expect(view.result.current.loading).toBe(false);
  await act(async () => view.result.current.restore()); expect(mocks.restore).not.toHaveBeenCalled(); expect(mocks.list).toHaveBeenCalledTimes(2);
  await act(async () => view.result.current.refresh()); expect(view.result.current.fresh).toBe(true); expect(mocks.list).toHaveBeenCalledTimes(3);
});
