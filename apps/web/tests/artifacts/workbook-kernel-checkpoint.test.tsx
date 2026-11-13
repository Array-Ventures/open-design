// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { WorkbookDocument } from '@open-design/contracts/runtime/workbook';
import type { IWorkbookData } from '@univerjs/presets';
import { gridWorkbook } from '../../src/components/embedded/workbook/grid-model';
import { useWorkbookEditor } from '../../src/components/embedded/workbook/use-workbook-editor';
import { loadWorkbookPreview } from '../../src/components/embedded/workbook/preview-transport';
import { saveWorkbook } from '../../src/components/embedded/workbook/save-transport';
import type { WorkbookCheckpoint, WorkbookJournal } from '../../src/components/embedded/workbook/workbook-writer';
vi.mock('../../src/components/embedded/workbook/save-transport', async original => ({ ...await original<object>(), saveWorkbook: vi.fn() }));
vi.mock('../../src/components/embedded/workbook/preview-transport', async original => ({ ...await original<object>(), loadWorkbookPreview: vi.fn() }));
const projectId = '66a28381-a8cf-40cd-91d2-b1f9cd696ac0', fileName = 'Forecast.xlsx';
const source = { sourceSha256: 'a'.repeat(64), model: { version: 1, date1904: false, activeSheetId: 's', styles: [{}], features: { charts: 0, drawings: 0, externalLinks: 0, macros: false, signed: false }, sheets: [{ id: 's', name: 'Sheet', visibility: 'visible', rowCount: 100, columnCount: 26, cells: [{ row: 0, column: 0, kind: 'number', value: 1 }], merges: [], rowDimensions: [], columnDimensions: [], frozenRows: 0, frozenColumns: 0 }] } satisfies WorkbookDocument };
function snapshot(value: number) { const data = gridWorkbook(source.model, `${projectId}:${fileName}`, 'Forecast').data as IWorkbookData; data.sheets.s!.cellData![0]![0]!.v = value; return data; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function save(controllerId: string, targetProject = projectId) { window.dispatchEvent(new MessageEvent('message', { source: window, origin: window.location.origin, data: { type: 'studio:workbook-control', projectId: targetProject, controllerId, action: 'save' } })); }
beforeEach(() => { vi.clearAllMocks(); vi.spyOn(window, 'postMessage').mockImplementation(() => {}); vi.mocked(saveWorkbook).mockRejectedValue(Error('response lost')); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('carries the drained pending identity, acknowledgement and edits made during save into a replacement kernel', async () => {
  const finalIdentity = crypto.randomUUID(), finish = deferred<void>();
  const checkpoints: (WorkbookCheckpoint | null)[] = [], journal = { save: vi.fn(async (checkpoint: WorkbookCheckpoint | null) => { checkpoints.push(structuredClone(checkpoint)); }) };
  vi.mocked(saveWorkbook).mockImplementationOnce(async (attempt, signal, prepared) => {
    await new Promise<void>(resolve => signal!.addEventListener('abort', () => resolve(), { once: true }));
    // A transport's last preparation checkpoint can finish after Grid teardown.
    attempt.renderId = finalIdentity; await prepared?.();
    await finish.promise; throw new DOMException('Aborted', 'AbortError');
  });
  const hook = renderHook(() => useWorkbookEditor(projectId, fileName, source, vi.fn(), undefined, journal));
  await act(() => hook.result.current.ready(snapshot(1)));
  act(() => { hook.result.current.snapshot(snapshot(2)); save(hook.result.current.controllerId); });
  await waitFor(() => expect(saveWorkbook).toHaveBeenCalledOnce());
  act(() => hook.result.current.snapshot(snapshot(3))); // edits while the value-2 save is pending
  const before = hook.result.current.checkpoint()!;
  let recreated!: Promise<void>;
  act(() => { recreated = hook.result.current.ready(snapshot(3)); });
  await waitFor(() => expect(checkpoints.some(checkpoint => checkpoint?.pending?.intent.renderId === finalIdentity)).toBe(true));
  await act(async () => { finish.resolve(); await recreated; });
  const after = hook.result.current.checkpoint()!;
  expect(after).toEqual({ ...before, pending: { ...before.pending!, intent: { ...before.pending!.intent, renderId: finalIdentity } } });
  expect(after.acknowledged.sheets.s!.cellData![0]![0]!.v).toBe(1);
  expect(after.desired.sheets.s!.cellData![0]![0]!.v).toBe(3);
  expect(after.pending!.snapshot.sheets.s!.cellData![0]![0]!.v).toBe(2);
  expect(hook.result.current.state).toMatchObject({ dirty: true, saving: false });
  act(() => save(hook.result.current.controllerId));
  await waitFor(() => expect(saveWorkbook).toHaveBeenCalledTimes(2));
  const retried = vi.mocked(saveWorkbook).mock.calls[1]![0];
  expect(retried).toMatchObject({ operationId: before.pending!.intent.id, preparationId: before.pending!.intent.preparationId, renderId: finalIdentity, plan: before.pending!.intent.plan });
  await waitFor(() => expect(hook.result.current.state.saving).toBe(false));
});

it('shares one retirement between concurrent ready calls and preserves an unsaved draft', async () => {
  const persisted = deferred<void>(), journal = { save: vi.fn(async () => { await persisted.promise; }) };
  const hook = renderHook(() => useWorkbookEditor(projectId, fileName, source, vi.fn(), undefined, journal));
  await act(() => hook.result.current.ready(snapshot(1))); act(() => hook.result.current.snapshot(snapshot(2)));
  const before = hook.result.current.checkpoint();
  let first!: Promise<void>, second!: Promise<void>;
  act(() => { first = hook.result.current.ready(snapshot(2)); second = hook.result.current.ready(snapshot(2)); });
  await act(async () => { persisted.resolve(); await Promise.all([first, second]); });
  expect(hook.result.current.checkpoint()).toEqual(before); expect(hook.result.current.state.dirty).toBe(true);
});

it.each(['source', 'account lease', 'project', 'file'] as const)('refuses an automatic kernel carry after %s changes', async change => {
  const oldWrites: (WorkbookCheckpoint | null)[] = [], journal: WorkbookJournal = { save: vi.fn(async checkpoint => { oldWrites.push(structuredClone(checkpoint)); }) };
  const props = { projectId, fileName, source, journal };
  const hook = renderHook(props => useWorkbookEditor(props.projectId, props.fileName, props.source, vi.fn(), undefined, props.journal), { initialProps: props });
  await act(() => hook.result.current.ready(snapshot(1))); act(() => hook.result.current.snapshot(snapshot(2)));
  const oldReady = hook.result.current.ready;
  const next = { ...props, ...(change === 'source' ? { source: { ...source, sourceSha256: 'b'.repeat(64) } } : {}), ...(change === 'account lease' ? { journal: { save: vi.fn(async () => {}) } } : {}), ...(change === 'project' ? { projectId: crypto.randomUUID() } : {}), ...(change === 'file' ? { fileName: 'Other.xlsx' } : {}) };
  hook.rerender(next); await act(() => hook.result.current.ready(snapshot(7)));
  expect(hook.result.current.checkpoint()?.acknowledged).toEqual(snapshot(7));
  expect(hook.result.current.checkpoint()?.desired).toEqual(snapshot(7));
  expect(hook.result.current.checkpoint()?.pending).toBeNull();
  expect(hook.result.current.state.dirty).toBe(false);
  const fresh = hook.result.current.checkpoint(); await act(() => oldReady(snapshot(99)));
  expect(hook.result.current.checkpoint()).toEqual(fresh);
  expect(oldWrites.some(checkpoint => checkpoint?.desired.sheets.s!.cellData![0]![0]!.v === 2)).toBe(true);
});

it('does not revive a retiring checkpoint after access loss invalidates its generation', async () => {
  const persisted = deferred<void>(), journal = { save: vi.fn(async () => { await persisted.promise; }) };
  const hook = renderHook(({ loaded }) => useWorkbookEditor(projectId, fileName, loaded, vi.fn(), undefined, journal), { initialProps: { loaded: source as typeof source | null } });
  await act(() => hook.result.current.ready(snapshot(1))); act(() => hook.result.current.snapshot(snapshot(2)));
  let recreating!: Promise<void>; act(() => { recreating = hook.result.current.ready(snapshot(2)); });
  hook.rerender({ loaded: null });
  await act(async () => { persisted.resolve(); await recreating; });
  expect(hook.result.current.checkpoint()).toBeNull(); expect(hook.result.current.state.dirty).toBe(false);
  expect(journal.save).not.toHaveBeenCalledWith(null);
});


it.each([true, false])('consumes the actual hook receipt as an explicit ACK with history=%s before notifying the parent', async history => {
  const target = { ...source, sourceSha256: 'b'.repeat(64) }, records: (WorkbookCheckpoint | null)[] = [];
  vi.mocked(loadWorkbookPreview).mockResolvedValue(target);
  vi.mocked(saveWorkbook).mockImplementation(async (attempt, _signal, prepared) => {
    attempt.renderId = crypto.randomUUID(); await prepared?.();
    return { id: attempt.operationId, projectId, fileName, renderId: attempt.renderId, state: 'applied', sourceSha256: source.sourceSha256,
      targetSha256: target.sourceSha256, actualSha256: target.sourceSha256, sourceVersionId: history ? 'before' : null, versionId: 'after' };
  });
  const acknowledged = vi.fn(() => {
    expect(records.some(record => record?.pending?.acknowledgement)).toBe(true);
    if (history) expect(records.at(-1)?.sourceAcknowledgement).toMatchObject({ kind: 'history', provenance: { sourceVersionId: 'before', versionId: 'after' } });
    else expect(records.at(-1)).toBeNull();
  });
  const journal = { save: async (value: WorkbookCheckpoint | null) => { records.push(structuredClone(value)); } };
  const hook = renderHook(() => useWorkbookEditor(projectId, fileName, source, acknowledged, undefined, journal));
  await act(() => hook.result.current.ready(snapshot(1)));
  act(() => { hook.result.current.snapshot(snapshot(2)); save(hook.result.current.controllerId); });
  await waitFor(() => expect(acknowledged).toHaveBeenCalledOnce());
  expect(hook.result.current.state).toMatchObject({ dirty: false, saving: false, error: null });
  expect(hook.result.current.checkpoint()?.sourceAcknowledgement).toMatchObject({ kind: history ? 'history' : 'unavailable' });
});
