// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi, type MockInstance } from 'vitest';
import type { WorkbookDocument } from '@open-design/contracts/runtime/workbook';
import type { IWorkbookData } from '@univerjs/presets';
import { gridWorkbook } from '../../src/components/embedded/workbook/grid-model';
import { useWorkbookEditor } from '../../src/components/embedded/workbook/use-workbook-editor';
import { cancelWorkbookSavePreparation } from '../../src/components/embedded/workbook/cancel-transport';
import { saveWorkbook } from '../../src/components/embedded/workbook/save-transport';
import { WorkbookSaveTerminalError } from '../../src/components/embedded/workbook/save-terminal';
vi.mock('../../src/components/embedded/workbook/cancel-transport', () => ({ cancelWorkbookSavePreparation: vi.fn() }));
vi.mock('../../src/components/embedded/workbook/save-transport', async original => ({ ...await original<object>(), saveWorkbook: vi.fn() }));
const projectId = '66a28381-a8cf-40cd-91d2-b1f9cd696ac0', fileName = 'Forecast.xlsx';
const source = { sourceSha256: 'a'.repeat(64), model: { version: 1, date1904: false, activeSheetId: 's', styles: [{}], features: { charts: 0, drawings: 0, externalLinks: 0, macros: false, signed: false }, sheets: [{ id: 's', name: 'Sheet', visibility: 'visible', rowCount: 100, columnCount: 26, cells: [{ row: 0, column: 0, kind: 'number', value: 1 }], merges: [], rowDimensions: [], columnDimensions: [], frozenRows: 0, frozenColumns: 0 }] } satisfies WorkbookDocument };
function snapshot(value: number) { const data = gridWorkbook(source.model, `${projectId}:${fileName}`, 'Forecast').data as IWorkbookData; data.sheets.s!.cellData![0]![0]!.v = value; return data; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
let post: MockInstance<Window['postMessage']>;
beforeEach(() => { vi.clearAllMocks(); vi.mocked(cancelWorkbookSavePreparation).mockRejectedValue(new Error('The save is still uncertain.')); post = vi.spyOn(window, 'postMessage').mockImplementation(() => {}); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
type Posted = { type: string; controllerId: string; accepted?: boolean };
const messages = () => post.mock.calls.map(call => call[0] as Posted);
function controllerId() { return messages().find(data => data.type === 'studio:workbook-state')!.controllerId; }
function request(type: string, extra = {}, origin = window.location.origin) {
  window.dispatchEvent(new MessageEvent('message', { source: window, origin, data: { type, projectId, controllerId: controllerId(), ...extra } }));
}
const replies = () => messages().filter(data => data.type === 'studio:workbook-discarded');
it('acknowledges discard only after its protected draft deletion commits', async () => {
  const deletion = deferred<void>(), discarded = vi.fn(), save = vi.fn(async (checkpoint: unknown) => { if (checkpoint === null) await deletion.promise; });
  const journal = { save };
  const hook = renderHook(() => useWorkbookEditor(projectId, fileName, source, vi.fn(), undefined, journal, discarded));
  await act(() => hook.result.current.ready(snapshot(1)));
  act(() => hook.result.current.snapshot(snapshot(2)));
  await waitFor(() => expect(save).toHaveBeenCalled());
  const requestId = crypto.randomUUID();
  act(() => request('studio:discard-workbook', { requestId }));
  await waitFor(() => expect(messages().some(message => message.type === 'studio:workbook-discard-ready')).toBe(true));
  expect(save).not.toHaveBeenCalledWith(null);
  act(() => request('studio:commit-workbook-discard', { requestId }));
  await waitFor(() => expect(save).toHaveBeenCalledWith(null));
  expect(replies()).toHaveLength(0); expect(hook.result.current.state.dirty).toBe(true);
  await act(async () => { deletion.resolve(); });
  await waitFor(() => expect(replies()).toHaveLength(1));
  expect(replies()[0]!.accepted).toBe(true); expect(discarded).toHaveBeenCalledOnce(); expect(hook.result.current.state.dirty).toBe(false);
});
it('keeps the editor and draft dirty when deletion fails and permits retry', async () => {
  let reject = true; const discarded = vi.fn(), save = vi.fn(async (checkpoint: unknown) => { if (checkpoint === null && reject) throw Error('storage failure'); });
  const journal = { save };
  const hook = renderHook(() => useWorkbookEditor(projectId, fileName, source, vi.fn(), undefined, journal, discarded));
  await act(() => hook.result.current.ready(snapshot(1)));
  act(() => hook.result.current.snapshot(snapshot(2)));
  const requestId = crypto.randomUUID();
  act(() => request('studio:discard-workbook', { requestId }));
  await waitFor(() => expect(messages().some(message => message.type === 'studio:workbook-discard-ready')).toBe(true));
  act(() => request('studio:commit-workbook-discard', { requestId }));
  await waitFor(() => expect(replies()).toHaveLength(1));
  expect(replies()[0]!.accepted).toBe(false); expect(hook.result.current.state.dirty).toBe(true);
  expect(hook.result.current.checkpoint()?.desired.sheets.s!.cellData![0]![0]!.v).toBe(2); expect(discarded).not.toHaveBeenCalled();
  reject = false; act(() => request('studio:commit-workbook-discard', { requestId }));
  await waitFor(() => expect(replies()).toHaveLength(2)); expect(replies()[1]!.accepted).toBe(true);
});
it('refuses discard while a save result is uncertain', async () => {
  vi.mocked(saveWorkbook).mockRejectedValue(new Error('response lost'));
  const save = vi.fn(async () => {}), journal = { save }, hook = renderHook(() => useWorkbookEditor(projectId, fileName, source, vi.fn(), undefined, journal));
  await act(() => hook.result.current.ready(snapshot(1)));
  act(() => { hook.result.current.snapshot(snapshot(2)); request('studio:workbook-control', { action: 'save' }); });
  await waitFor(() => expect(hook.result.current.state.error).toBe('response lost'));
  act(() => request('studio:discard-workbook', { requestId: crypto.randomUUID() }));
  await waitFor(() => expect(replies()).toHaveLength(1));
  expect(replies()[0]!.accepted).toBe(false); expect(save).not.toHaveBeenCalledWith(null); expect(hook.result.current.state.dirty).toBe(true);
});
it('ignores discard requests from a wrong origin, controller or invalid identity', async () => {
  const save = vi.fn(async () => {}), journal = { save }, hook = renderHook(() => useWorkbookEditor(projectId, fileName, source, vi.fn(), undefined, journal));
  await act(() => hook.result.current.ready(snapshot(1)));
  act(() => hook.result.current.snapshot(snapshot(2)));
  await waitFor(() => expect(save).toHaveBeenCalled()); const before = save.mock.calls.length;
  act(() => {
    request('studio:discard-workbook', { requestId: crypto.randomUUID() }, 'https://wrong.invalid');
    request('studio:discard-workbook', { requestId: crypto.randomUUID(), controllerId: crypto.randomUUID() });
    request('studio:discard-workbook', { requestId: 'wrong' });
  });
  await act(async () => { await Promise.resolve(); }); expect(save).toHaveBeenCalledTimes(before); expect(replies()).toHaveLength(0);
});
it('permits discard after a verified terminal conflict and preserves the pending fence for uncertain errors', async () => {
  vi.mocked(saveWorkbook).mockImplementation(async attempt => { throw new WorkbookSaveTerminalError(attempt.operationId, attempt.renderId ?? crypto.randomUUID(), 'conflict'); });
  const save = vi.fn(async () => {}), journal = { save }, hook = renderHook(() => useWorkbookEditor(projectId, fileName, source, vi.fn(), undefined, journal));
  await act(() => hook.result.current.ready(snapshot(1)));
  act(() => { hook.result.current.snapshot(snapshot(2)); request('studio:workbook-control', { action: 'save' }); });
  await waitFor(() => expect(hook.result.current.state.error).toContain('changed elsewhere'));
  expect(hook.result.current.checkpoint()?.pending).toBeNull();
  const requestId = crypto.randomUUID();
  act(() => request('studio:discard-workbook', { requestId }));
  await waitFor(() => expect(messages().some(message => message.type === 'studio:workbook-discard-ready')).toBe(true));
  act(() => request('studio:commit-workbook-discard', { requestId }));
  await waitFor(() => expect(replies()).toHaveLength(1)); expect(replies()[0]!.accepted).toBe(true); expect(save).toHaveBeenCalledWith(null);
});
it('keeps the old journal drain reachable after current project access is lost', async () => {
  const storage = deferred<void>(), save = vi.fn(async () => { await storage.promise; }), finished = vi.fn();
  const journal = { save };
  const hook = renderHook(({ loaded }) => useWorkbookEditor(projectId, fileName, loaded, vi.fn(), undefined, journal), { initialProps: { loaded: source as typeof source | null } });
  await act(() => hook.result.current.ready(snapshot(1))); act(() => hook.result.current.snapshot(snapshot(2)));
  await waitFor(() => expect(save).toHaveBeenCalled()); hook.rerender({ loaded: null });
  const closed = hook.result.current.close().then(finished); await act(async () => { await Promise.resolve(); });
  expect(finished).not.toHaveBeenCalled(); await act(async () => { storage.resolve(); await closed; }); expect(finished).toHaveBeenCalledOnce();
});
it('waits for retired checkpoints before accepting replacement grid changes', async () => {
  const storage = deferred<void>(), values: number[] = [];
  const save = vi.fn(async (checkpoint: import('../../src/components/embedded/workbook/workbook-writer').WorkbookCheckpoint | null) => {
    if (!checkpoint) return; const value = checkpoint.desired.sheets.s!.cellData![0]![0]!.v as number;
    values.push(value); if (value === 2) await storage.promise;
  });
  const journal = { save };
  const hook = renderHook(() => useWorkbookEditor(projectId, fileName, source, vi.fn(), undefined, journal));
  await act(() => hook.result.current.ready(snapshot(1))); act(() => hook.result.current.snapshot(snapshot(2)));
  await waitFor(() => expect(values).toEqual([2]));
  let replacement!: Promise<void>; act(() => { replacement = hook.result.current.ready(snapshot(1)); });
  await act(async () => { await Promise.resolve(); }); expect(values).toEqual([2]);
  await act(async () => { storage.resolve(); await replacement; });
  act(() => hook.result.current.snapshot(snapshot(3))); await waitFor(() => expect(values).toEqual([2, 3]));
  expect(hook.result.current.checkpoint()?.desired.sheets.s!.cellData![0]![0]!.v).toBe(3);
});
it('keeps the frozen desired edits after cancelling a prepared discard and journals the no-write proof', async () => {
  vi.mocked(saveWorkbook).mockRejectedValue(Error('response lost'));
  vi.mocked(cancelWorkbookSavePreparation).mockImplementation(async attempt => ({ state: 'unadmitted', projectId, operationId: attempt.operationId, preparationId: attempt.preparationId, fileName, sourceSha256: source.sourceSha256, renderId: attempt.renderId ?? null }));
  const save = vi.fn(async () => {}), journal = { save }, hook = renderHook(() => useWorkbookEditor(projectId, fileName, source, vi.fn(), undefined, journal));
  await act(() => hook.result.current.ready(snapshot(1)));
  act(() => { hook.result.current.snapshot(snapshot(2)); request('studio:workbook-control', { action: 'save' }); });
  await waitFor(() => expect(hook.result.current.checkpoint()?.pending).not.toBeNull());
  const requestId = crypto.randomUUID(); act(() => request('studio:discard-workbook', { requestId }));
  await waitFor(() => expect(messages().some(message => message.type === 'studio:workbook-discard-ready')).toBe(true));
  expect(save).not.toHaveBeenCalledWith(null);
  act(() => request('studio:cancel-workbook-discard', { requestId }));
  await waitFor(() => expect(hook.result.current.discarding).toBe(false));
  expect(hook.result.current.checkpoint()?.pending).toBeNull();
  expect(hook.result.current.checkpoint()?.desired.sheets.s!.cellData![0]![0]!.v).toBe(2);
  expect(hook.result.current.state.dirty).toBe(true); expect(save).not.toHaveBeenCalledWith(null);
  act(() => request('studio:commit-workbook-discard', { requestId })); await act(async () => { await Promise.resolve(); }); expect(save).not.toHaveBeenCalledWith(null);
});
it('rejects a delayed preparation after Keep Editing without deleting its journal', async () => {
  vi.mocked(saveWorkbook).mockRejectedValue(Error('response lost'));
  const proof = deferred<Awaited<ReturnType<typeof cancelWorkbookSavePreparation>>>(); vi.mocked(cancelWorkbookSavePreparation).mockReturnValue(proof.promise);
  const save = vi.fn(async () => {}), journal = { save }, hook = renderHook(() => useWorkbookEditor(projectId, fileName, source, vi.fn(), undefined, journal));
  await act(() => hook.result.current.ready(snapshot(1)));
  act(() => { hook.result.current.snapshot(snapshot(2)); request('studio:workbook-control', { action: 'save' }); });
  await waitFor(() => expect(hook.result.current.state.error).toBe('response lost'));
  const intent = hook.result.current.checkpoint()!.pending!.intent, requestId = crypto.randomUUID();
  act(() => request('studio:discard-workbook', { requestId })); await waitFor(() => expect(cancelWorkbookSavePreparation).toHaveBeenCalled());
  act(() => request('studio:cancel-workbook-discard', { requestId }));
  await act(async () => proof.resolve({ state: 'unadmitted', projectId, operationId: intent.id, preparationId: intent.preparationId, fileName, sourceSha256: source.sourceSha256, renderId: null }));
  await waitFor(() => expect(hook.result.current.discarding).toBe(false));
  expect(save).not.toHaveBeenCalledWith(null); expect(hook.result.current.state.dirty).toBe(true);
});
it('never commits the old prepared discard against a replacement source', async () => {
  const save = vi.fn(async () => {}), journal = { save };
  const hook = renderHook(({ loaded }) => useWorkbookEditor(projectId, fileName, loaded, vi.fn(), undefined, journal), { initialProps: { loaded: source } });
  await act(() => hook.result.current.ready(snapshot(1))); act(() => hook.result.current.snapshot(snapshot(2)));
  const requestId = crypto.randomUUID(); act(() => request('studio:discard-workbook', { requestId }));
  await waitFor(() => expect(messages().some(message => message.type === 'studio:workbook-discard-ready')).toBe(true));
  hook.rerender({ loaded: { ...source, sourceSha256: 'b'.repeat(64) } });
  act(() => request('studio:commit-workbook-discard', { requestId })); await act(async () => { await Promise.resolve(); });
  expect(save).not.toHaveBeenCalledWith(null);
});
