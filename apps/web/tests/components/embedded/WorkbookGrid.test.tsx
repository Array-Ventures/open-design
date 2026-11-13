// @vitest-environment jsdom
import { legacyWorkbookWrite } from '../../fixtures/workbook-write-result';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { WorkbookWriter } from '../../../src/components/embedded/workbook/workbook-writer';
import { gridWorkbook } from '../../../src/components/embedded/workbook/grid-model';
import type { IWorkbookData } from '@univerjs/presets';
import { CommandType } from '@univerjs/presets';
import { ICommandService } from '@univerjs/core';
import type { WorkbookDocument } from '@open-design/contracts/runtime/workbook';
import { WorkbookGrid } from '../../../src/components/embedded/workbook/WorkbookGrid';

const runtime = vi.hoisted(() => ({ visibilityBefore: vi.fn(), visibilityBeforeOff: vi.fn(), navigationCommand: vi.fn(), navigationShortcut: vi.fn(), navigationCommandOff: vi.fn(), navigationShortcutOff: vi.fn(), firstCell: vi.fn(), scrollToCell: vi.fn(), events: [] as string[], richInputs: [] as { dispose: ReturnType<typeof vi.fn> }[], workers: [] as { dispose: ReturnType<typeof vi.fn> }[], inputs: [] as { dispose: ReturnType<typeof vi.fn> }[], rendered: Promise.resolve(), context: vi.fn(), created: vi.fn(), register: vi.fn(), dispose: vi.fn(), off: vi.fn(), selectionOff: vi.fn(), theme: vi.fn(), dark: vi.fn(),
  calculation: null as null | ((state: { phase: string; stored: number; unavailable: number; paused: boolean }) => void),
  input: null as null | ((message: string) => void), live: false, fail: null as null | (() => void), calculationDisposed: vi.fn(),
  getRange: vi.fn(), select: vi.fn(), createWorkbook: vi.fn(), editable: vi.fn(), activeSheet: vi.fn(), saved: vi.fn(), listener: null as null | ((event: { type: number; id: string }) => void) }));
vi.mock('@univerjs/presets', async original => ({ ...await original<typeof import('@univerjs/presets')>(),
  Univer: class { constructor() { runtime.created(this); } registerPlugin = runtime.register; dispose = () => { runtime.events.push(`univer:${runtime.created.mock.calls.findIndex(([instance]) => instance === this) + 1}`); runtime.dispose(this); }; __getInjector = () => ({ get: (token: unknown) => token === ICommandService ? { registerCommand: runtime.navigationCommand, beforeCommandExecuted: runtime.visibilityBefore } : token === 'IShortcutService' ? { registerShortcut: runtime.navigationShortcut } : { setContextValue: runtime.context, onStage: () => runtime.rendered } }); },
  FUniver: { newAPI: () => ({ createWorkbook: runtime.createWorkbook, getActiveWorkbook: () => runtime.createWorkbook.mock.results.at(-1)?.value, Event: { CommandExecuted: 'CommandExecuted', ActiveSheetChanged: 'ActiveSheetChanged' },
    addEvent: (event: string, callback: NonNullable<typeof runtime.listener>) => { if (event === 'CommandExecuted') { runtime.listener = callback; return { dispose: runtime.off }; } return { dispose() {} }; }, setTheme: runtime.theme, toggleDarkMode: runtime.dark }) },
}));
vi.mock('@univerjs/preset-sheets-core', () => ({ ...Object.fromEntries(['UniverRenderEnginePlugin', 'UniverFormulaEnginePlugin', 'UniverUIPlugin', 'UniverDocsPlugin', 'UniverDocsUIPlugin', 'UniverSheetsPlugin', 'UniverSheetsUIPlugin', 'UniverSheetsFormulaPlugin', 'UniverSheetsFormulaUIPlugin', 'UniverSheetsNumfmtPlugin', 'UniverSheetsNumfmtUIPlugin'].map(name => [name, name])), IShortcutService: 'IShortcutService', KeyCode: { HOME: 36 }, MetaKeys: { CTRL_COMMAND: 2048 }, whenSheetEditorFocused: (context: { focused: boolean }) => context.focused, SetSelectionsOperation: { id: 'sheet.operation.set-selections' }, IRenderManagerService: 'IRenderManagerService', DISABLE_AUTO_FOCUS_KEY: 'disableAutoFocus', CalculationMode: { NO_CALCULATION: 2 } }));
vi.mock('../../../src/components/embedded/workbook/grid-calculation', () => ({ workbookLiveCalculationEligible: () => runtime.live, attachWorkbookCalculation: (...args: unknown[]) => { runtime.calculation = args[7] as NonNullable<typeof runtime.calculation>; return { dispose() {} }; } }));
vi.mock('../../../src/components/embedded/workbook/calculation-worker-owner', () => ({ ownWorkbookCalculationWorker: (fail: () => void) => { runtime.fail = fail; return { loaded: Promise.resolve(true), ready: true, worker: {}, dispose: runtime.calculationDisposed }; } }));
vi.mock('../../../src/components/embedded/workbook/array-projection-owner', () => ({ ownArrayProjectionWorker: () => {
  const id = runtime.workers.length + 1, owned = { loaded: Promise.resolve(true), ready: true, dispose: vi.fn(() => runtime.events.push(`worker:${id}`)) }; runtime.workers.push(owned); return owned;
} }));
vi.mock('../../../src/components/embedded/workbook/array-input-normalization', () => ({ ownArrayInputNormalization: () => {
  const id = runtime.inputs.length + 1, owned = { dispose: vi.fn(() => runtime.events.push(`input:${id}`)) }; runtime.inputs.push(owned); return owned;
} }));
vi.mock('../../../src/components/embedded/workbook/grid-array-calculation', () => ({ attachWorkbookArrayCalculation: (...args: unknown[]) => {
  const input = args[10] as { dispose(): void }; return { dispose() { input.dispose(); } };
} }));
// This fixture supplies a synthetic kernel, as for CSV/array input above.
// Native editor interception is exercised against the real SDK separately.
vi.mock('../../../src/components/embedded/workbook/rich-cell-input', () => ({ attachWorkbookRichInput: () => {
  const id = runtime.richInputs.length + 1, owned = { dispose: vi.fn(() => runtime.events.push(`rich:${id}`)) };
  runtime.richInputs.push(owned); return owned;
} }));
vi.mock('../../../src/components/embedded/workbook/csv-literal-input', () => ({ attachCsvLiteralInput: (_univer: unknown, _api: unknown, _kernel: unknown, _element: unknown, _model: unknown, report: (message: string) => void) => { runtime.input = report; return { dispose() { runtime.input = null; } }; } }));
// The array display adapter imports the real sheets/formula modules. Preserve
// their RPC dependency exports while replacing only the owned plugin token.
vi.mock('@univerjs/rpc', async original => ({ ...await original<typeof import('@univerjs/rpc')>(), UniverRPCMainThreadPlugin: 'UniverRPCMainThreadPlugin' }));
const model: WorkbookDocument = { version: 1, date1904: false, activeSheetId: 'inputs', styles: [{}], features: { charts: 0, drawings: 0, externalLinks: 0, macros: false, signed: false },
  sheets: [{ id: 'inputs', name: 'Inputs', visibility: 'visible', rowCount: 100, columnCount: 26, cells: [], merges: [], rowDimensions: [], columnDimensions: [], frozenRows: 0, frozenColumns: 0 }] };
beforeEach(() => {
  runtime.visibilityBefore.mockReturnValue({ dispose: runtime.visibilityBeforeOff });
  runtime.navigationCommand.mockReturnValue({ dispose: runtime.navigationCommandOff });
  runtime.navigationShortcut.mockReturnValue({ dispose: runtime.navigationShortcutOff });
  runtime.events = []; runtime.workers = []; runtime.inputs = []; runtime.richInputs = [];
  runtime.live = false; runtime.fail = null; runtime.rendered = Promise.resolve();
  runtime.createWorkbook.mockReturnValue({ getId: () => 'grid', onSelectionChange: () => ({ dispose: runtime.selectionOff }), getWorkbookPermission: () => ({ canEdit: () => true }), setActiveSheet: runtime.activeSheet, setEditable: runtime.editable, save: runtime.saved, getActiveSheet: () => ({ getSheetId: () => 'inputs', getMaxRows: () => 100, getMaxColumns: () => 26, getSelection: () => ({ getActiveRange: () => ({ getRange: () => ({ startRow: 5, endRow: 5, startColumn: 2, endColumn: 2 }), getCellDatas: () => [[{}]], getCellStyleData: () => ({}) }) }), getRange: runtime.getRange, setActiveRange: runtime.select, setActiveSelection: runtime.firstCell, scrollToCell: runtime.scrollToCell }) });
  runtime.getRange.mockReturnValue({ boundWorksheet: 'inputs' });
  runtime.saved.mockReturnValue({ id: 'current-grid-state' });
});
afterEach(() => { cleanup(); vi.resetAllMocks(); runtime.listener = null; delete document.documentElement.dataset.theme; });
it('preserves the running grid through callback and host-theme changes and closes its resources', async () => {
  const first = vi.fn(), latest = vi.fn(), view = render(<WorkbookGrid id="grid" title="Revenue" model={model} onSnapshot={first} />);
  await waitFor(() => expect(runtime.listener).not.toBeNull());
  expect(runtime.activeSheet).toHaveBeenCalledWith('inputs');
  view.rerender(<WorkbookGrid id="grid" title="Updated title" model={model} onSnapshot={latest} />);
  act(() => runtime.listener?.({ id: 'sheet.mutation.set-range-values', type: CommandType.MUTATION }));
  expect(latest).toHaveBeenCalledWith({ id: 'current-grid-state' }); expect(first).not.toHaveBeenCalled();
  await act(async () => { document.documentElement.dataset.theme = 'dark'; });
  await waitFor(() => expect(runtime.dark).toHaveBeenCalledWith(true));
  expect(runtime.created).toHaveBeenCalledTimes(1);
  view.unmount(); expect(runtime.off).toHaveBeenCalledTimes(1); expect(runtime.selectionOff).toHaveBeenCalledTimes(1); expect(runtime.dispose).toHaveBeenCalledTimes(1);
});
it('does not initialize a late browser-only module after the surface closes', async () => {
  const view = render(<WorkbookGrid id="grid" title="Revenue" model={model} />); view.unmount();
  await act(async () => { await Promise.resolve(); }); expect(runtime.created).not.toHaveBeenCalled();
});
it('cleans up failed setup once and can reopen after the source changes', async () => {
  runtime.register.mockImplementationOnce(() => { throw new Error('Plugin setup failed'); });
  const view = render(<WorkbookGrid id="grid" title="Revenue" model={model} />);
  await screen.findByRole('alert'); expect(runtime.dispose).toHaveBeenCalledTimes(1);
  view.rerender(<WorkbookGrid id="grid" title="Revenue" model={{ ...model }} />);
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect(runtime.created).toHaveBeenCalledTimes(2); expect(runtime.editable).toHaveBeenCalledWith(false);
  view.unmount(); expect(runtime.dispose).toHaveBeenCalledTimes(2);
});

it('restores the active range and saved viewport on an acknowledged model replacement', async () => {
  const ready = vi.fn(); runtime.saved.mockReturnValue({ id: 'grid', sheets: { inputs: { scrollTop: 500, scrollLeft: 70, zoomRatio: 1.2 } } });
  const view = render(<WorkbookGrid id="grid" title="Revenue" model={model} onReady={ready} />);
  await waitFor(() => expect(runtime.listener).not.toBeNull()); expect(ready).toHaveBeenCalledTimes(1);
  view.rerender(<WorkbookGrid id="grid" title="Revenue" model={{ ...model }} onReady={ready} />);
  await waitFor(() => expect(ready).toHaveBeenCalledTimes(2));
  expect(runtime.createWorkbook.mock.calls[1]![0].sheets.inputs).toMatchObject({ scrollTop: 500, scrollLeft: 70, zoomRatio: 1.2 });
  expect(runtime.getRange).toHaveBeenCalledWith(5, 2, 1, 1); expect(runtime.select).toHaveBeenCalledTimes(1);
  expect(runtime.select).toHaveBeenCalledWith(runtime.getRange.mock.results[0]!.value);
});

it('permits typing after deliberate focus while keeping startup and outside focus protected', async () => {
  render(<WorkbookGrid id="grid" title="Revenue" model={model} onSnapshot={() => {}} />);
  await waitFor(() => expect(runtime.listener).not.toBeNull());
  expect(screen.queryByRole('alert')).toBeNull();
  expect(runtime.context).not.toHaveBeenCalled();
  fireEvent.pointerDown(screen.getByRole('region', { name: 'Workbook grid' }));
  expect(runtime.context).toHaveBeenLastCalledWith('disableAutoFocus', false);
  fireEvent(window, new Event('blur')); expect(runtime.context).toHaveBeenLastCalledWith('disableAutoFocus', true);
});

it('carries the exact dirty snapshot through terminal worker fallback and waits for writer readiness', async () => {
  runtime.live = true;
  let allow!: () => void;
  const drained = new Promise<void>(resolve => { allow = resolve; });
  const ready = vi.fn().mockResolvedValueOnce(undefined).mockReturnValueOnce(drained), snapshot = vi.fn();
  const source = { id: 'grid', sheets: { inputs: { cellData: { 0: { 0: { v: 2 } } } } } };
  runtime.saved.mockReturnValue(source);
  const view = render(<WorkbookGrid id="grid" title="Revenue" model={model} onSnapshot={snapshot} onReady={ready} />);
  await waitFor(() => expect(runtime.editable).toHaveBeenLastCalledWith(true));
  const host = screen.getByRole('region', { name: 'Workbook grid' });
  const dirty = { ...source, sheets: { inputs: { cellData: { 0: { 0: { v: 42 } } } } } };
  runtime.saved.mockReturnValue(dirty);
  act(() => runtime.fail?.());
  await waitFor(() => expect(ready).toHaveBeenCalledTimes(2));
  expect(screen.getByRole('region', { name: 'Workbook grid' })).toBe(host);
  expect(host.isConnected).toBe(true);
  expect(snapshot).toHaveBeenCalledWith(dirty);
  expect(snapshot.mock.invocationCallOrder[0]).toBeLessThan(runtime.calculationDisposed.mock.invocationCallOrder[0]!);
  expect(runtime.createWorkbook.mock.calls[1]![0]).toEqual(dirty);
  expect(runtime.editable).toHaveBeenLastCalledWith(false);
  await act(async () => { allow(); await drained; });
  await waitFor(() => expect(runtime.editable).toHaveBeenLastCalledWith(true));
  expect(host.children).toHaveLength(1);
  expect(runtime.calculationDisposed).toHaveBeenCalledTimes(1);
  view.unmount(); expect(runtime.dispose).toHaveBeenCalledTimes(2);
});

it('publishes scoped calculation information for existing host chrome without a canvas overlay', async () => {
  const post = vi.spyOn(window.parent, 'postMessage');
  const scope = { projectId: '18a8301a-b6e1-4001-8000-c967b1eab222', controllerId: '18a8301a-b6e1-4001-8000-c967b1eab223', blocked: false };
  const view = render(<WorkbookGrid id="grid" title="Revenue" model={model} formatScope={scope} />);
  await waitFor(() => expect(runtime.calculation).not.toBeNull());
  const state = { phase: 'stored', stored: 2, unavailable: 0, paused: true };
  act(() => runtime.calculation?.(state));
  expect(post).toHaveBeenCalledWith({ type: 'studio:workbook-calculation-state', projectId: scope.projectId, controllerId: scope.controllerId, ...state }, window.location.origin);
  expect(screen.queryByText('Stored results')).toBeNull();
  post.mockClear();
  act(() => window.dispatchEvent(new MessageEvent('message', { source: window.parent, origin: window.location.origin, data: { type: 'studio:artifact-request', projectId: scope.projectId } })));
  expect(post.mock.calls.some(([data]) => data.type === 'studio:workbook-calculation-state')).toBe(true);
  post.mockClear();
  act(() => window.dispatchEvent(new MessageEvent('message', { source: window.parent, origin: 'http://elsewhere', data: { type: 'studio:artifact-request', projectId: scope.projectId } })));
  expect(post).not.toHaveBeenCalled();
  const late = runtime.calculation; view.unmount(); post.mockClear();
  act(() => late?.(state)); expect(post).not.toHaveBeenCalled(); post.mockRestore();
});

it('publishes bounded CSV input refusals to the exact host controller without a canvas banner', async () => {
  const projectId = '18a8301a-b6e1-4001-8000-c967b1eab222', controllerId = '18a8301a-b6e1-4001-8000-c967b1eab223';
  const post = vi.spyOn(window, 'postMessage');
  const view = render(<WorkbookGrid id="csv-grid" title="CSV" model={{ ...model, sourceFormat: 'csv' }} onSnapshot={vi.fn()} formatScope={{ projectId, controllerId, blocked: false }} />);
  await waitFor(() => expect(runtime.input).not.toBeNull());
  act(() => runtime.input?.('x'.repeat(1200)));
  expect(post).toHaveBeenLastCalledWith({ type: 'studio:workbook-input-state', projectId, controllerId, error: 'x'.repeat(1000) }, window.location.origin);
  expect(screen.queryByRole('alert')).toBeNull();
  post.mockClear();
  act(() => window.dispatchEvent(new MessageEvent('message', { source: window, origin: 'https://untrusted.invalid', data: { type: 'studio:artifact-request', projectId } })));
  act(() => window.dispatchEvent(new MessageEvent('message', { source: window, origin: window.location.origin, data: { type: 'studio:artifact-request', projectId: controllerId } })));
  act(() => window.dispatchEvent(new MessageEvent('message', { source: null, origin: window.location.origin, data: { type: 'studio:artifact-request', projectId } })));
  expect(post).not.toHaveBeenCalled();
  act(() => window.dispatchEvent(new MessageEvent('message', { source: window, origin: window.location.origin, data: { type: 'studio:artifact-request', projectId } })));
  expect(post).toHaveBeenLastCalledWith({ type: 'studio:workbook-input-state', projectId, controllerId, error: 'x'.repeat(1000) }, window.location.origin);
  view.unmount(); expect(post).toHaveBeenLastCalledWith({ type: 'studio:workbook-input-state', projectId, controllerId, error: null }, window.location.origin);
});

it('ignores a retired CSV input callback after controller replacement and unmount', async () => {
  const projectId = '18a8301a-b6e1-4001-8000-c967b1eab222', controllerId = '18a8301a-b6e1-4001-8000-c967b1eab223', replacement = '18a8301a-b6e1-4001-8000-c967b1eab224';
  const post = vi.spyOn(window, 'postMessage'), csv = { ...model, sourceFormat: 'csv' as const };
  const view = render(<WorkbookGrid id="old-csv" title="CSV" model={csv} onSnapshot={vi.fn()} formatScope={{ projectId, controllerId, blocked: false }} />);
  await waitFor(() => expect(runtime.input).not.toBeNull()); const retired = runtime.input!;
  view.rerender(<WorkbookGrid id="new-csv" title="CSV" model={{ ...csv }} onSnapshot={vi.fn()} formatScope={{ projectId, controllerId: replacement, blocked: false }} />);
  await waitFor(() => { expect(runtime.input).not.toBeNull(); expect(runtime.input).not.toBe(retired); });
  post.mockClear(); act(() => retired('Retired refusal')); expect(post).not.toHaveBeenCalled();
  const current = runtime.input!; act(() => current('Current refusal'));
  expect(post).toHaveBeenLastCalledWith({ type: 'studio:workbook-input-state', projectId, controllerId: replacement, error: 'Current refusal' }, window.location.origin);
  view.unmount(); post.mockClear(); act(() => current('Late refusal')); expect(post).not.toHaveBeenCalled();
});

it('carries CSV view sizing across acknowledged source replacement without copying stale cells or styles', async () => {
  const ready = vi.fn(), csv = { ...model, sourceFormat: 'csv' as const };
  runtime.saved.mockReturnValue({ id: 'grid', sheets: { inputs: { columnData: { 1: { w: 148, s: 'old' } }, rowData: { 2: { h: 42 } }, cellData: { 0: { 0: { v: 'stale' } } } } } });
  const view = render(<WorkbookGrid id="project:file.csv" title="CSV" model={csv} onReady={ready} />);
  await waitFor(() => expect(ready).toHaveBeenCalledTimes(1));
  const next = structuredClone(csv); next.sheets[0]!.cells = [{ row: 0, column: 0, kind: 'string', value: 'new-source' }];
  view.rerender(<WorkbookGrid id="project:file.csv" title="CSV" model={next} onReady={ready} />);
  await waitFor(() => expect(ready).toHaveBeenCalledTimes(2));
  const sheet = runtime.createWorkbook.mock.calls[1]![0].sheets.inputs;
  expect(sheet.columnData).toEqual({ 1: { w: 148 } }); expect(sheet.rowData).toEqual({ 2: { h: 42 } });
  expect(sheet.cellData[0][0].v).toBe('new-source');
  view.rerender(<WorkbookGrid id="another-project:file.csv" title="CSV" model={next} onReady={ready} />);
  await waitFor(() => expect(ready).toHaveBeenCalledTimes(3));
  expect(runtime.createWorkbook.mock.calls[2]![0].sheets.inputs.columnData).toEqual({});
});

it('does not retain CSV sizing after its scoped surface is unmounted or the format changes', async () => {
  const ready = vi.fn(), csv = { ...model, sourceFormat: 'csv' as const };
  runtime.saved.mockReturnValue({ id: 'grid', sheets: { inputs: { columnData: { 1: { w: 148 } } } } });
  const first = render(<WorkbookGrid id="project:file" title="CSV" model={csv} onReady={ready} />);
  await waitFor(() => expect(ready).toHaveBeenCalledTimes(1));
  first.rerender(<WorkbookGrid id="project:file" title="XLSX" model={model} onReady={ready} />);
  await waitFor(() => expect(ready).toHaveBeenCalledTimes(2));
  expect(runtime.createWorkbook.mock.calls[1]![0].sheets.inputs.columnData).toEqual({});
  first.unmount();
  render(<WorkbookGrid id="project:file" title="CSV" model={csv} onReady={ready} />);
  await waitFor(() => expect(ready).toHaveBeenCalledTimes(3));
  expect(runtime.createWorkbook.mock.calls[2]![0].sheets.inputs.columnData).toEqual({});
});

it('disables text-number warnings only for literal CSV while retaining XLSX defaults and host input errors', async () => {
  const ready = vi.fn();
  const view = render(<WorkbookGrid id="csv" title="CSV" model={{ ...model, sourceFormat: 'csv' }} onReady={ready} />);
  await waitFor(() => expect(ready).toHaveBeenCalledTimes(1));
  expect(runtime.register).toHaveBeenCalledWith('UniverSheetsNumfmtPlugin', { disableTextFormatAlert: true, disableTextFormatMark: true });
  const input = runtime.input; expect(input).not.toBeNull();
  view.rerender(<WorkbookGrid id="xlsx" title="XLSX" model={model} onReady={ready} />);
  await waitFor(() => expect(ready).toHaveBeenCalledTimes(2));
  expect(runtime.register).toHaveBeenLastCalledWith('UniverSheetsNumfmtUIPlugin');
  expect(runtime.register.mock.calls.filter(call => call[0] === 'UniverSheetsNumfmtPlugin').at(-1)).toEqual(['UniverSheetsNumfmtPlugin', undefined]);
});

it('retains CSV sizing through the real writer acknowledgement and refreshed source Grid handoff', async () => {
  const csv = { ...model, sourceFormat: 'csv' as const }, ready = vi.fn();
  let writer!: WorkbookWriter;
  let saved = gridWorkbook(csv, 'project:file.csv', 'CSV').data as IWorkbookData;
  runtime.saved.mockImplementation(() => structuredClone(saved));
  const template = runtime.createWorkbook.getMockImplementation();
  runtime.createWorkbook.mockImplementation((data: IWorkbookData) => { saved = structuredClone(data); return template!(); });
  const journal = { save: vi.fn(async () => {}) };
  function Harness() {
    const [source, accept] = useState<{ model: WorkbookDocument; sourceSha256: string }>({ model: csv, sourceSha256: 'a'.repeat(64) });
    return <WorkbookGrid id="project:file.csv" title="CSV" model={source.model} onSnapshot={snapshot => writer.update(snapshot)} onReady={async snapshot => {
      await writer?.close();
      writer = new WorkbookWriter(source, snapshot, async intent => {
        expect(intent.plan).not.toHaveProperty('dimensions');
        const next = structuredClone(source); next.sourceSha256 = 'b'.repeat(64);
        next.model.sheets[0]!.cells = intent.plan.edits.map(edit => edit.cell);
        return legacyWorkbookWrite(next);
      }, () => {}, accept, journal); ready();
    }} />;
  }
  const view = render(<Harness />); await waitFor(() => expect(ready).toHaveBeenCalledTimes(1));
  saved.sheets.inputs!.columnData = { 1: { w: 148 } }; saved.sheets.inputs!.rowData = { 2: { h: 42 } };
  saved.sheets.inputs!.cellData = { 0: { 0: { v: '00017', t: 4 } } };
  act(() => runtime.listener?.({ id: 'sheet.mutation.set-range-values', type: CommandType.MUTATION }));
  await act(async () => writer.flush());
  await waitFor(() => expect(ready).toHaveBeenCalledTimes(2));
  expect(saved.sheets.inputs!.columnData![1]!.w).toBe(148); expect(saved.sheets.inputs!.rowData![2]!.h).toBe(42);
  expect(saved.sheets.inputs!.cellData![0]![0]!.v).toBe('00017');
  expect(writer.state().dirty).toBe(false); view.unmount(); await writer.close();
});

it('retains an inert rendered canvas until the replacement renderer is ready, then releases the old kernel', async () => {
  runtime.saved.mockReturnValue(gridWorkbook(model, 'grid', 'Revenue').data);
  const editing = { onSnapshot: vi.fn(), onReady: vi.fn() };
  const view = render(<WorkbookGrid id="grid" title="Revenue" model={model} sourceSha256={'a'.repeat(64)} {...editing} />);
  const host = screen.getByRole('region', { name: 'Workbook grid' });
  await waitFor(() => expect(runtime.listener).not.toBeNull());
  await waitFor(() => expect(host).not.toHaveAttribute('aria-busy'));
  const previous = host.firstElementChild as HTMLElement;
  const previousKernel = runtime.created.mock.calls[0]![0];
  expect(previous).not.toBeNull();
  let rendered!: () => void;
  runtime.rendered = new Promise<void>(resolve => { rendered = resolve; });
  view.rerender(<WorkbookGrid id="grid" title="Revenue" model={{ ...model }} sourceSha256={'b'.repeat(64)} {...editing} />);
  await waitFor(() => expect(runtime.created).toHaveBeenCalledTimes(2));
  expect(screen.getByRole('region', { name: 'Workbook grid' })).toBe(host);
  expect(host.isConnected).toBe(true);
  expect(previous.isConnected).toBe(true); expect(previous.inert).toBe(true);
  expect(previous).toHaveAttribute('aria-hidden', 'true');
  expect(host.children).toHaveLength(2);
  expect(runtime.dispose).not.toHaveBeenCalledWith(previousKernel);
  expect(host.lastElementChild).toHaveStyle({ visibility: 'hidden' });
  expect(Boolean((host.lastElementChild as HTMLElement).inert)).toBe(false);
  fireEvent.pointerDown(host);
  expect(runtime.context).toHaveBeenLastCalledWith('disableAutoFocus', true);
  expect(runtime.editable).toHaveBeenLastCalledWith(false);
  await act(async () => { rendered(); });
  await waitFor(() => expect(host).not.toHaveAttribute('aria-busy'));
  expect(previous.isConnected).toBe(false); expect(host.children).toHaveLength(1);
  fireEvent.pointerDown(host);
  expect(runtime.context).toHaveBeenLastCalledWith('disableAutoFocus', false);
  expect(runtime.editable).toHaveBeenLastCalledWith(true);
  expect(runtime.dispose).toHaveBeenCalledWith(previousKernel);
  expect((host.firstElementChild as HTMLElement).inert).toBe(false);
  const replacementKernel = runtime.created.mock.calls[1]![0];
  expect(runtime.dispose).not.toHaveBeenCalledWith(replacementKernel);
  view.unmount(); expect(runtime.dispose).toHaveBeenCalledWith(replacementKernel);
  expect(runtime.dispose.mock.calls.filter(([kernel]) => kernel === previousKernel)).toHaveLength(1);
  expect(runtime.dispose.mock.calls.filter(([kernel]) => kernel === replacementKernel)).toHaveLength(1);
});

it('withdraws a retained canvas immediately when its artifact identity changes', async () => {
  runtime.saved.mockReturnValue(gridWorkbook(model, 'first', 'First').data);
  const view = render(<WorkbookGrid id="first" title="First" model={model} />);
  const host = screen.getByRole('region', { name: 'Workbook grid' });
  await waitFor(() => expect(runtime.listener).not.toBeNull());
  await waitFor(() => expect(host).not.toHaveAttribute('aria-busy'));
  const previous = host.firstElementChild!;
  runtime.rendered = new Promise<void>(() => {});
  view.rerender(<WorkbookGrid id="second" title="Second" model={{ ...model }} />);
  expect(previous.isConnected).toBe(false);
  await waitFor(() => expect(runtime.created).toHaveBeenCalledTimes(2));
  expect(previous.isConnected).toBe(false); expect(runtime.dispose).toHaveBeenCalledTimes(1);
  view.unmount(); expect(runtime.dispose).toHaveBeenCalledTimes(2);
});


const arrayModel: WorkbookDocument = { ...model, calculationMetadata: 'verified', sheets: [{ ...model.sheets[0]!, arrayFormulas: [{kind:'array',calculation:'dynamic',row:2,column:3,range:{startRow:2,endRow:4,startColumn:3,endColumn:3}}], cells: [{row:2,column:3,kind:'number',value:10,formula:'=SEQUENCE(3,1,10)'},{row:3,column:3,kind:'number',value:11},{row:4,column:3,kind:'number',value:12}] }] };
it('disposes every array kernel owner exactly once through retained-view replacement and unmount', async () => {
 runtime.saved.mockImplementation(() => { runtime.events.push('save'); return gridWorkbook(arrayModel, 'array-grid', 'Arrays').data; });
 const view=render(<WorkbookGrid id="array-grid" title="Arrays" model={arrayModel} sourceSha256={'a'.repeat(64)} onSnapshot={vi.fn()} />);
 await waitFor(()=>expect(runtime.editable).toHaveBeenLastCalledWith(true));
 expect(runtime.inputs).toHaveLength(1);expect(runtime.workers).toHaveLength(1);expect(runtime.dispose).not.toHaveBeenCalled();
 runtime.events.push('replace');
 view.rerender(<WorkbookGrid id="array-grid" title="Arrays" model={structuredClone(arrayModel)} sourceSha256={'b'.repeat(64)} onSnapshot={vi.fn()} />);
 await waitFor(()=>expect(runtime.dispose).toHaveBeenCalledTimes(1));
 expect(runtime.inputs).toHaveLength(2);expect(runtime.workers).toHaveLength(2);
 expect(runtime.inputs[0]!.dispose).toHaveBeenCalledOnce();expect(runtime.workers[0]!.dispose).toHaveBeenCalledOnce();
 const replacement=runtime.events.slice(runtime.events.indexOf('replace')+1);
 expect(replacement.indexOf('save')).toBeLessThan(replacement.indexOf('input:1'));
 expect(runtime.richInputs).toHaveLength(2);
 expect(replacement.indexOf('save')).toBeLessThan(replacement.indexOf('rich:1'));
 expect(replacement.indexOf('rich:1')).toBeLessThan(replacement.indexOf('univer:1'));
 expect(replacement.indexOf('input:1')).toBeLessThan(replacement.indexOf('univer:1'));
 view.unmount();
 for(const owned of [...runtime.inputs,...runtime.workers,...runtime.richInputs]) expect(owned.dispose).toHaveBeenCalledOnce();
 expect(runtime.dispose).toHaveBeenCalledTimes(2);
});

it('releases array input, worker and Univer when plugin setup throws before a canvas exists', async () => {
 runtime.register.mockImplementationOnce(()=>{throw new Error('Owned plugin setup failed');});
 const view=render(<WorkbookGrid id="failed-array" title="Arrays" model={arrayModel} sourceSha256={'a'.repeat(64)} onSnapshot={vi.fn()} />);
 expect(await screen.findByRole('alert')).toHaveTextContent('The workbook grid could not be opened.');
 expect(runtime.inputs).toHaveLength(1);expect(runtime.workers).toHaveLength(1);
 expect(runtime.inputs[0]!.dispose).toHaveBeenCalledOnce();expect(runtime.workers[0]!.dispose).toHaveBeenCalledOnce();expect(runtime.dispose).toHaveBeenCalledOnce();
 expect(runtime.events.indexOf('input:1')).toBeLessThan(runtime.events.indexOf('univer:1'));
 expect(runtime.events.indexOf('worker:1')).toBeLessThan(runtime.events.indexOf('univer:1'));
 view.unmount();expect(runtime.dispose).toHaveBeenCalledOnce();expect(runtime.inputs[0]!.dispose).toHaveBeenCalledOnce();
});


it('registers first-cell navigation with readiness and editor-focus guards and releases both registrations', async () => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const view = render(<WorkbookGrid id="navigation" title="Navigation" model={model} onReady={() => pending} onSnapshot={() => {}} />);
  await waitFor(() => expect(runtime.navigationShortcut).toHaveBeenCalledTimes(1));
  const command = runtime.navigationCommand.mock.calls[0]![0] as { id: string; handler(): boolean };
  const shortcut = runtime.navigationShortcut.mock.calls[0]![0] as { id: string; preconditions(context: { focused: boolean }): boolean };
  expect(shortcut.id).toBe(command.id);
  expect(command.handler()).toBe(false);
  expect(shortcut.preconditions({ focused: true })).toBe(false);
  expect(runtime.firstCell).not.toHaveBeenCalled();
  await act(async () => { release(); });
  await waitFor(() => expect(runtime.editable).toHaveBeenLastCalledWith(true));
  expect(shortcut.preconditions({ focused: false })).toBe(false);
  expect(shortcut.preconditions({ focused: true })).toBe(true);
  expect(command.handler()).toBe(true);
  expect(runtime.getRange).toHaveBeenLastCalledWith(0, 0);
  expect(runtime.firstCell).toHaveBeenCalledWith(runtime.getRange.mock.results.at(-1)!.value);
  expect(runtime.scrollToCell).toHaveBeenCalledWith(0, 0);
  view.unmount();
  expect(command.handler()).toBe(false);
  expect(runtime.navigationShortcutOff).toHaveBeenCalledTimes(1);
  expect(runtime.navigationCommandOff).toHaveBeenCalledTimes(1);
});

it('owns structural mutation admission through startup, source-ready input, saving and retirement', async () => {
  runtime.live = true;
  let ready!: () => void; const startup = new Promise<void>(resolve => { ready = resolve; });
  const ordinary = runtime.createWorkbook.getMockImplementation()!;
  runtime.createWorkbook.mockImplementation(input => { runtime.saved.mockReturnValue(structuredClone(input)); return ordinary(input); });
  const scope = { projectId: '11111111-1111-4111-8111-111111111111', controllerId: '22222222-2222-4222-8222-222222222222', blocked: false, saving: false };
  const qualified: WorkbookDocument = { ...model, calculationMetadata: 'verified', worksheetStructureEditable: true, sheets: model.sheets.map(sheet => ({ ...sheet, arrayFormulas: [] })) };
  const source = () => ({ model: qualified, sourceSha256: 'a'.repeat(64), acknowledged: runtime.saved() });
  const view = render(<WorkbookGrid id="grid" title="Structure" model={qualified} onSnapshot={vi.fn()} sourceSha256={'a'.repeat(64)} formatScope={scope} structureBlocked={false} structureSource={source} onReady={() => startup} />);
  await waitFor(() => expect(runtime.visibilityBefore).toHaveBeenCalledTimes(2));
  const admit = runtime.visibilityBefore.mock.calls[1]![0];
  const command = () => ({ id: 'sheet.mutation.insert-row', params: { unitId: 'grid', subUnitId: 'inputs', range: { startRow: 1, endRow: 1, startColumn: 0, endColumn: 25 } } });
  expect(() => admit(command())).toThrow('not ready');
  await act(async () => ready()); await waitFor(() => expect(runtime.editable).toHaveBeenLastCalledWith(true));
  expect(() => admit(command())).not.toThrow();
  expect(runtime.workers).toHaveLength(0);
  expect(runtime.register.mock.calls.some(([plugin]) => plugin === 'UniverSheetsFormulaPlugin')).toBe(true);
  expect(runtime.fail).not.toBeNull();
  view.rerender(<WorkbookGrid id="grid" title="Structure" model={qualified} onSnapshot={vi.fn()} sourceSha256={'a'.repeat(64)} formatScope={{ ...scope, saving: true }} structureBlocked={false} structureSource={source} onReady={() => startup} />);
  expect(() => admit(command())).toThrow('not ready');
  view.unmount(); expect(() => admit(command())).toThrow('not ready'); expect(runtime.visibilityBeforeOff).toHaveBeenCalledTimes(2);
});
