// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import * as store from '../../../src/components/embedded/workbook/draft-store';
import { WorkbookHostError } from '../../../src/components/embedded/workbook/host-request';
import { useMissingWorkbookRestores } from '../../../src/components/embedded/workbook/use-missing-workbook-restores';
const host = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../../../src/components/embedded/workbook/host-request', async original => ({ ...await original<object>(), workbookHostRequest: host.request }));
vi.mock('../../../src/components/embedded/workbook/draft-store', async original => { const actual = await original<typeof import('../../../src/components/embedded/workbook/draft-store')>(); return { ...actual, accessWorkbookRestore: vi.fn(actual.accessWorkbookRestore), readWorkbookDraft: vi.fn(actual.readWorkbookDraft), listWorkbookDrafts: vi.fn(actual.listWorkbookDrafts) }; });
const projectId = '18a8301a-b6e1-4001-8000-c967b1eab222', fileName = 'missing.xlsx';
const scope = { viewerId: 'person-one', projectId, fileName };
const pending = { version: 1 as const, ...scope, operationId: '18a8301a-b6e1-4001-8000-c967b1eab227', preparationId: '18a8301a-b6e1-4001-8000-c967b1eab226', sourceSha256: 'a'.repeat(64), versionSha256: 'b'.repeat(64), versionId: 'v1' };
beforeEach(async () => {
  vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('IDBKeyRange', IDBKeyRange);
  await store.accessWorkbookRestore(scope, { expected: null, value: pending }); vi.mocked(store.accessWorkbookRestore).mockClear();
  host.request.mockResolvedValue({ projectId, fileName, currentSha256: null, versions: [], nextCursor: null });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.resetAllMocks(); vi.unstubAllGlobals(); });
it('authorizes the candidate through fresh history before reading its protected identity; never reads draft bytes', async () => {
  let authorize!: (value: unknown) => void; host.request.mockImplementationOnce(() => new Promise(resolve => { authorize = resolve; }));
  const view = renderHook(() => useMissingWorkbookRestores(scope.viewerId, projectId, [], 1));
  await waitFor(() => expect(host.request).toHaveBeenCalledOnce()); expect(store.accessWorkbookRestore).not.toHaveBeenCalled(); expect(view.result.current.files).toEqual([]);
  await act(async () => authorize({ projectId, fileName, currentSha256: null, versions: [], nextCursor: null }));
  await waitFor(() => expect(view.result.current.files).toEqual([fileName]));
  expect(store.accessWorkbookRestore).toHaveBeenCalledExactlyOnceWith(scope); expect(store.readWorkbookDraft).not.toHaveBeenCalled(); expect(store.listWorkbookDrafts).not.toHaveBeenCalled();
});
it.each([401, 403, 404])('does not expose or read protected metadata after history denial %s', async status => {
  host.request.mockRejectedValueOnce(new WorkbookHostError('Denied', status)); const view = renderHook(() => useMissingWorkbookRestores(scope.viewerId, projectId, [], 1));
  await waitFor(() => expect(view.result.current.loading).toBe(false)); expect(view.result.current.files).toEqual([]); expect(store.accessWorkbookRestore).not.toHaveBeenCalled();
});
it('isolates account/project keys and ignores a late authorization response after account switch', async () => {
  let resolve!: (value: unknown) => void; host.request.mockImplementationOnce(() => new Promise(done => { resolve = done; })); let viewer = scope.viewerId;
  const view = renderHook(() => useMissingWorkbookRestores(viewer, projectId, [], 1)); await waitFor(() => expect(host.request).toHaveBeenCalledOnce());
  viewer = 'person-two'; view.rerender(); await act(async () => resolve({ projectId, fileName, currentSha256: null, versions: [], nextCursor: null }));
  await waitFor(() => expect(view.result.current.loading).toBe(false)); expect(view.result.current.files).toEqual([]); expect(store.accessWorkbookRestore).not.toHaveBeenCalled();
  view.unmount(); host.request.mockClear();
  const foreign = renderHook(() => useMissingWorkbookRestores(scope.viewerId, '18a8301a-b6e1-4001-8000-c967b1eab223', [], 1));
  await waitFor(() => expect(foreign.result.current.loading).toBe(false)); expect(host.request).not.toHaveBeenCalled();
});
it('leaves listed workbooks on their real artifact surface and scans no identity until a viewer is bound', async () => {
  const view = renderHook(() => useMissingWorkbookRestores(null, projectId, [], 1)); await act(async () => {}); expect(host.request).not.toHaveBeenCalled(); view.unmount();
  const listed = renderHook(() => useMissingWorkbookRestores(scope.viewerId, projectId, [fileName], 1)); await waitFor(() => expect(listed.result.current.loading).toBe(false));
  expect(host.request).not.toHaveBeenCalled(); expect(store.accessWorkbookRestore).not.toHaveBeenCalled();
});
it('offers a scoped retry after transient key discovery failure without reading any unverified identity', async () => {
  const scan = vi.spyOn(store, 'listWorkbookRestoreFileNames').mockRejectedValueOnce(Error('Storage temporarily unavailable'));
  const view = renderHook(() => useMissingWorkbookRestores(scope.viewerId, projectId, [], 1));
  await waitFor(() => expect(view.result.current.error).toBe('Local restore recovery could not be checked. Try again.'));
  expect(host.request).not.toHaveBeenCalled(); expect(store.accessWorkbookRestore).not.toHaveBeenCalled(); expect(view.result.current.files).toEqual([]);
  act(() => view.result.current.refresh()); await waitFor(() => expect(view.result.current.files).toEqual([fileName]));
  expect(view.result.current.error).toBeNull(); expect(scan).toHaveBeenCalledTimes(2);
});
