// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CommandType } from '@univerjs/presets';
import type { WorkbookDocument } from '@open-design/contracts/runtime/workbook';
import { WorkbookGrid } from '../../../src/components/embedded/workbook/WorkbookGrid';

const runtime = vi.hoisted(() => ({ context: vi.fn(), created: vi.fn(), register: vi.fn(), dispose: vi.fn(), off: vi.fn(), selectionOff: vi.fn(), theme: vi.fn(), dark: vi.fn(),
  calculation: null as null | ((state: { phase: string; stored: number; unavailable: number; paused: boolean }) => void),
  input: null as null | ((message: string) => void), live: false, fail: null as null | (() => void), calculationDisposed: vi.fn(),
  getRange: vi.fn(), select: vi.fn(), createWorkbook: vi.fn(), editable: vi.fn(), activeSheet: vi.fn(), saved: vi.fn(), listener: null as null | ((event: { type: number; id: string }) => void) }));
vi.mock('@univerjs/presets', async original => ({ ...await original<typeof import('@univerjs/presets')>(),
  Univer: class { constructor() { runtime.created(); } registerPlugin = runtime.register; dispose = runtime.dispose; __getInjector = () => ({ get: () => ({ setContextValue: runtime.context }) }); },
  FUniver: { newAPI: () => ({ createWorkbook: runtime.createWorkbook, getActiveWorkbook: () => runtime.createWorkbook.mock.results.at(-1)?.value, Event: { CommandExecuted: 'CommandExecuted' },
    addEvent: (_event: string, callback: NonNullable<typeof runtime.listener>) => { runtime.listener = callback; return { dispose: runtime.off }; }, setTheme: runtime.theme, toggleDarkMode: runtime.dark }) },
}));
vi.mock('@univerjs/preset-sheets-core', () => ({ ...Object.fromEntries(['UniverRenderEnginePlugin', 'UniverFormulaEnginePlugin', 'UniverUIPlugin', 'UniverDocsPlugin', 'UniverDocsUIPlugin', 'UniverSheetsPlugin', 'UniverSheetsUIPlugin', 'UniverSheetsFormulaPlugin', 'UniverSheetsFormulaUIPlugin', 'UniverSheetsNumfmtPlugin', 'UniverSheetsNumfmtUIPlugin'].map(name => [name, name])), DISABLE_AUTO_FOCUS_KEY: 'disableAutoFocus', CalculationMode: { NO_CALCULATION: 2 } }));
vi.mock('../../../src/components/embedded/workbook/grid-calculation', () => ({ workbookLiveCalculationEligible: () => runtime.live, attachWorkbookCalculation: (...args: unknown[]) => { runtime.calculation = args[7] as NonNullable<typeof runtime.calculation>; return { dispose() {} }; } }));
vi.mock('../../../src/components/embedded/workbook/calculation-worker-owner', () => ({ ownWorkbookCalculationWorker: (fail: () => void) => { runtime.fail = fail; return { loaded: Promise.resolve(true), ready: true, worker: {}, dispose: runtime.calculationDisposed }; } }));
vi.mock('../../../src/components/embedded/workbook/csv-literal-input', () => ({ attachCsvLiteralInput: (_univer: unknown, _api: unknown, _kernel: unknown, _element: unknown, _model: unknown, report: (message: string) => void) => { runtime.input = report; return { dispose() { runtime.input = null; } }; } }));
vi.mock('@univerjs/rpc', () => ({ UniverRPCMainThreadPlugin: 'UniverRPCMainThreadPlugin' }));
const model: WorkbookDocument = { version: 1, date1904: false, activeSheetId: 'inputs', styles: [{}], features: { charts: 0, drawings: 0, externalLinks: 0, macros: false, signed: false },
  sheets: [{ id: 'inputs', name: 'Inputs', visibility: 'visible', rowCount: 100, columnCount: 26, cells: [], merges: [], rowDimensions: [], columnDimensions: [], frozenRows: 0, frozenColumns: 0 }] };
beforeEach(() => {
  runtime.live = false; runtime.fail = null;
  runtime.createWorkbook.mockReturnValue({ onSelectionChange: () => ({ dispose: runtime.selectionOff }), getWorkbookPermission: () => ({ canEdit: () => true }), setActiveSheet: runtime.activeSheet, setEditable: runtime.editable, save: runtime.saved, getActiveSheet: () => ({ getSheetId: () => 'inputs', getMaxRows: () => 100, getMaxColumns: () => 26, getSelection: () => ({ getActiveRange: () => ({ getRange: () => ({ startRow: 5, endRow: 5, startColumn: 2, endColumn: 2 }) }) }), getRange: runtime.getRange, setActiveRange: runtime.select }) });
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
  const dirty = { ...source, sheets: { inputs: { cellData: { 0: { 0: { v: 42 } } } } } };
  runtime.saved.mockReturnValue(dirty);
  act(() => runtime.fail?.());
  await waitFor(() => expect(ready).toHaveBeenCalledTimes(2));
  expect(snapshot).toHaveBeenCalledWith(dirty);
  expect(snapshot.mock.invocationCallOrder[0]).toBeLessThan(runtime.calculationDisposed.mock.invocationCallOrder[0]!);
  expect(runtime.createWorkbook.mock.calls[1]![0]).toEqual(dirty);
  expect(runtime.editable).toHaveBeenLastCalledWith(false);
  await act(async () => { allow(); await drained; });
  await waitFor(() => expect(runtime.editable).toHaveBeenLastCalledWith(true));
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
