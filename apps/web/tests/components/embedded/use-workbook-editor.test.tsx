import { seedWorkbookStructureIdentity } from '../../../src/components/embedded/workbook/grid-structure-identity';
// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CellValueType, type IWorkbookData } from '@univerjs/presets';
import type { WorkbookDocument } from '@open-design/contracts/runtime/workbook';
import { useWorkbookEditor } from '../../../src/components/embedded/workbook/use-workbook-editor';
import { gridWorkbook } from '../../../src/components/embedded/workbook/grid-model';
const host = vi.hoisted(() => ({ save: vi.fn(), load: vi.fn() }));
vi.mock('../../../src/components/embedded/workbook/save-transport', async original => ({ ...await original<object>(), saveWorkbook: host.save }));
vi.mock('../../../src/components/embedded/workbook/preview-transport', () => ({ loadWorkbookPreview: host.load }));
const projectId = '18a8301a-b6e1-4001-8000-c967b1eab222';
const model: WorkbookDocument = { version: 1, date1904: false, activeSheetId: 's', styles: [{}], features: { charts: 0, drawings: 0, externalLinks: 0, macros: false, signed: false }, sheets: [{ id: 's', name: 'Sheet', visibility: 'visible', rowCount: 100, columnCount: 26, cells: [{ row: 0, column: 0, kind: 'number', value: 1 }], merges: [], rowDimensions: [], columnDimensions: [], frozenRows: 0, frozenColumns: 0 }] };
const source = { sourceSha256: 'a'.repeat(64), model }, target = { sourceSha256: 'b'.repeat(64), model };
const initial = gridWorkbook(model, 'grid', 'Forecast').data as IWorkbookData;
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.resetAllMocks(); });
function edit() { const next = structuredClone(initial); next.sheets.s!.cellData![0]![0] = { v: 2, t: CellValueType.NUMBER }; return next; }
function command(controllerId: string, origin = window.location.origin, at: MessageEventSource = window) {
  window.dispatchEvent(new MessageEvent('message', { source: at, origin, data: { type: 'studio:workbook-control', action: 'save', projectId, controllerId } }));
}
function latestController(post: { mock: { calls: unknown[][] } }) {
  return post.mock.calls.filter(call => (call[0] as { type?: string }).type === 'studio:workbook-state').at(-1)![0] as { controllerId: string };
}
it('accepts only its host-bound save command and acknowledges only a refreshed matching target', async () => {
  const post = vi.spyOn(window, 'postMessage'), acknowledged = vi.fn(), dirty = vi.fn();
  host.save.mockResolvedValue({ targetSha256: target.sourceSha256 }); host.load.mockResolvedValue(target);
  const { result } = renderHook(() => useWorkbookEditor(projectId, 'Forecast.xlsx', source, acknowledged, dirty));
  await act(async () => { await result.current.ready(initial); result.current.snapshot(edit()); });
  const { controllerId } = latestController(post);
  act(() => { command(controllerId, 'http://wrong.test'); command('wrong'); command(controllerId, window.location.origin, {} as Window); }); expect(host.save).not.toHaveBeenCalled();
  await act(async () => command(controllerId));
  await waitFor(() => expect(acknowledged).toHaveBeenCalledWith(target));
  expect(result.current.state).toEqual({ dirty: false, saving: false, error: null }); expect(dirty).toHaveBeenLastCalledWith(false);
});
it('retains the frozen operation and dirty grid when a refreshed file is newer than the receipt', async () => {
  const post = vi.spyOn(window, 'postMessage'), acknowledged = vi.fn(); host.save.mockResolvedValue({ targetSha256: target.sourceSha256 }); host.load.mockResolvedValue({ ...target, sourceSha256: 'c'.repeat(64) });
  const { result } = renderHook(() => useWorkbookEditor(projectId, 'Forecast.xlsx', source, acknowledged));
  await act(async () => { await result.current.ready(initial); result.current.snapshot(edit()); }); const { controllerId } = latestController(post);
  await act(async () => command(controllerId)); await waitFor(() => expect(result.current.state.error).toContain('changed after saving'));
  expect(result.current.state.dirty).toBe(true); expect(acknowledged).not.toHaveBeenCalled();
  host.load.mockResolvedValue(target); await act(async () => command(controllerId)); await waitFor(() => expect(result.current.state.dirty).toBe(false));
  expect(host.save.mock.calls[0]![0]).toBe(host.save.mock.calls[1]![0]); expect(host.load.mock.calls[0]![2]).not.toBe(host.load.mock.calls[1]![2]);
});
it('aborts on unmount and ignores late save responses', async () => {
  const post = vi.spyOn(window, 'postMessage'), acknowledged = vi.fn(); let resolve!: (value: unknown) => void;
  host.save.mockImplementation(() => new Promise(done => { resolve = done; }));
  const view = renderHook(() => useWorkbookEditor(projectId, 'Forecast.xlsx', source, acknowledged));
  await act(async () => { await view.result.current.ready(initial); view.result.current.snapshot(edit()); }); await act(async () => command(latestController(post).controllerId));
  const signal = host.save.mock.calls[0]![1] as AbortSignal; view.unmount(); expect(signal.aborted).toBe(true);
  await act(async () => resolve({ targetSha256: target.sourceSha256 })); expect(acknowledged).not.toHaveBeenCalled();
});
it('stops the old writer when access removes its source and clears the visible dirty state', async () => {
  const post = vi.spyOn(window, 'postMessage'), acknowledged = vi.fn(); let observed: typeof source | null = source;
  host.save.mockImplementation(() => new Promise(() => {}));
  const view = renderHook(() => useWorkbookEditor(projectId, 'Forecast.xlsx', observed, acknowledged));
  await act(async () => { await view.result.current.ready(initial); view.result.current.snapshot(edit()); }); await act(async () => command(latestController(post).controllerId));
  const signal = host.save.mock.calls[0]![1] as AbortSignal; observed = null; view.rerender();
  expect(signal.aborted).toBe(true); expect(view.result.current.state.dirty).toBe(false); expect(acknowledged).not.toHaveBeenCalled();
});

it('pauses only a clean writer and ignores snapshots until that writer resumes', async () => {
  const view = renderHook(() => useWorkbookEditor(projectId, 'Forecast.xlsx', source, vi.fn()));
  await act(async () => { await view.result.current.ready(initial); });
  await act(async () => { expect(await view.result.current.pause()).toBe(true); });
  act(() => view.result.current.snapshot(edit())); expect(view.result.current.state.dirty).toBe(false);
  await act(async () => view.result.current.resumeClean());
  act(() => view.result.current.snapshot(edit())); expect(view.result.current.state.dirty).toBe(true);
  await act(async () => { expect(await view.result.current.pause()).toBe(false); });
});
it('opens history only for the exact host/controller and publishes its pending restore guard', async () => {
  const post = vi.spyOn(window, 'postMessage'), show = vi.fn();
  const view = renderHook(() => useWorkbookEditor(projectId, 'Forecast.xlsx', source, vi.fn(), undefined, undefined, undefined, { open: true, blocked: true, show }));
  const controllerId = view.result.current.controllerId;
  for (const origin of ['http://wrong.test', window.location.origin]) act(() => window.dispatchEvent(new MessageEvent('message', { source: window, origin, data: { type: 'studio:workbook-control', projectId, controllerId, action: 'history' } })));
  expect(show).toHaveBeenCalledOnce();
  expect(latestController(post)).toMatchObject({ dirty: true, restoring: true, historyOpen: true });
});
it('can freeze an empty clean corrupt-file editor but hides controls when history access is denied', async () => {
  const post = vi.spyOn(window, 'postMessage'), show = vi.fn();
  const view = renderHook(() => useWorkbookEditor(projectId, 'Forecast.xlsx', null, vi.fn(), undefined, undefined, undefined, { open: false, blocked: true, visible: false, show }));
  await act(async () => { expect(await view.result.current.pause()).toBe(true); });
  expect(post.mock.calls.some(([value]) => value.type === 'studio:workbook-unavailable')).toBe(true);
  act(() => window.dispatchEvent(new MessageEvent('message', { source: window, origin: window.location.origin, data: { type: 'studio:workbook-control', projectId, controllerId: view.result.current.controllerId, action: 'history' } })));
  expect(show).not.toHaveBeenCalled();
});

it('uses a fresh identity baseline after a clean protected kernel handoff instead of carrying the retired generation', async () => {
  const qualified = { ...source, model: { ...model, worksheetStructureEditable: true } };
  const journal = { save: vi.fn(async () => {}) }, acknowledged = vi.fn();
  const view = renderHook(() => useWorkbookEditor(projectId, 'Forecast.xlsx', qualified, acknowledged, undefined, journal));
  const first = seedWorkbookStructureIdentity(initial, source.sourceSha256), second = seedWorkbookStructureIdentity(initial, source.sourceSha256);
  await act(async () => { await view.result.current.ready(first); });
  await act(async () => { await view.result.current.ready(second); });
  const desired = structuredClone(second); desired.sheets.s!.cellData![0]![0]!.v = 2;
  act(() => view.result.current.snapshot(desired));
  expect(view.result.current.state).toMatchObject({ dirty: true, error: null });
  expect(view.result.current.checkpoint()!.acknowledged.custom).toEqual(second.custom);
});
