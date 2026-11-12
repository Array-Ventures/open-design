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
  const { options } = fixture(); mocks.list.mockResolvedValueOnce({ versions: [revision], nextCursor: 'next', currentSha256: 'c'.repeat(64) });
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
it('waits for an authorized preview before reading restore IDs without depending on editor recovery readiness', async () => {
  const { options } = fixture(); let readable = false;
  const view = renderHook(() => useWorkbookHistory({ ...options, source: readable ? source : null, ready: false }));
  expect(mocks.store).not.toHaveBeenCalled(); expect(view.result.current.checking).toBe(true);
  act(() => view.result.current.show()); expect(mocks.list).not.toHaveBeenCalled();
  readable = true; view.rerender(); await waitFor(() => expect(view.result.current.checking).toBe(false));
  expect(mocks.store).toHaveBeenCalledExactlyOnceWith(scope);
  await waitFor(() => expect(mocks.list).toHaveBeenCalledOnce());
  expect(mocks.restore).not.toHaveBeenCalled();
});
