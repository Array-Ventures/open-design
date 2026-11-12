// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CommandType } from '@univerjs/presets';
import type { WorkbookDocument } from '@open-design/contracts/runtime/workbook';
import { WorkbookGrid } from '../../../src/components/embedded/workbook/WorkbookGrid';

const runtime = vi.hoisted(() => ({ context: vi.fn(), created: vi.fn(), register: vi.fn(), dispose: vi.fn(), off: vi.fn(), theme: vi.fn(), dark: vi.fn(),
  getRange: vi.fn(), select: vi.fn(), createWorkbook: vi.fn(), editable: vi.fn(), activeSheet: vi.fn(), saved: vi.fn(), listener: null as null | ((event: { type: number; id: string }) => void) }));
vi.mock('@univerjs/presets', async original => ({ ...await original<typeof import('@univerjs/presets')>(),
  Univer: class { constructor() { runtime.created(); } registerPlugin = runtime.register; dispose = runtime.dispose; __getInjector = () => ({ get: () => ({ setContextValue: runtime.context }) }); },
  FUniver: { newAPI: () => ({ createWorkbook: runtime.createWorkbook, Event: { CommandExecuted: 'CommandExecuted' },
    addEvent: (_event: string, callback: NonNullable<typeof runtime.listener>) => { runtime.listener = callback; return { dispose: runtime.off }; }, setTheme: runtime.theme, toggleDarkMode: runtime.dark }) },
}));
vi.mock('@univerjs/preset-sheets-core', () => ({ ...Object.fromEntries(['UniverRenderEnginePlugin', 'UniverFormulaEnginePlugin', 'UniverUIPlugin', 'UniverDocsPlugin', 'UniverDocsUIPlugin', 'UniverSheetsPlugin', 'UniverSheetsUIPlugin', 'UniverSheetsFormulaPlugin', 'UniverSheetsFormulaUIPlugin', 'UniverSheetsNumfmtPlugin', 'UniverSheetsNumfmtUIPlugin'].map(name => [name, name])), DISABLE_AUTO_FOCUS_KEY: 'disableAutoFocus', CalculationMode: { NO_CALCULATION: 2 } }));
const model: WorkbookDocument = { version: 1, date1904: false, activeSheetId: 'inputs', styles: [{}], features: { charts: 0, drawings: 0, externalLinks: 0, macros: false, signed: false },
  sheets: [{ id: 'inputs', name: 'Inputs', visibility: 'visible', rowCount: 100, columnCount: 26, cells: [], merges: [], rowDimensions: [], columnDimensions: [], frozenRows: 0, frozenColumns: 0 }] };
beforeEach(() => {
  runtime.createWorkbook.mockReturnValue({ setActiveSheet: runtime.activeSheet, setEditable: runtime.editable, save: runtime.saved, getActiveSheet: () => ({ getSheetId: () => 'inputs', getMaxRows: () => 100, getMaxColumns: () => 26, getSelection: () => ({ getActiveRange: () => ({ getRange: () => ({ startRow: 5, endRow: 5, startColumn: 2, endColumn: 2 }) }) }), getRange: runtime.getRange, setActiveRange: runtime.select }) });
  runtime.saved.mockReturnValue({ id: 'current-grid-state' });
});
afterEach(() => { cleanup(); vi.resetAllMocks(); runtime.listener = null; delete document.documentElement.dataset.theme; });
it('preserves the running grid through callback and host-theme changes and closes its resources', async () => {
  const first = vi.fn(), latest = vi.fn(), view = render(<WorkbookGrid id="grid" title="Revenue" model={model} onSnapshot={first} />);
  await waitFor(() => expect(runtime.activeSheet).toHaveBeenCalledWith('inputs'));
  view.rerender(<WorkbookGrid id="grid" title="Updated title" model={model} onSnapshot={latest} />);
  act(() => runtime.listener?.({ id: 'sheet.mutation.set-range-values', type: CommandType.MUTATION }));
  expect(latest).toHaveBeenCalledWith({ id: 'current-grid-state' }); expect(first).not.toHaveBeenCalled();
  await act(async () => { document.documentElement.dataset.theme = 'dark'; });
  await waitFor(() => expect(runtime.dark).toHaveBeenCalledWith(true));
  expect(runtime.created).toHaveBeenCalledTimes(1);
  view.unmount(); expect(runtime.off).toHaveBeenCalledTimes(1); expect(runtime.dispose).toHaveBeenCalledTimes(1);
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
  await waitFor(() => expect(ready).toHaveBeenCalledTimes(1));
  view.rerender(<WorkbookGrid id="grid" title="Revenue" model={{ ...model }} onReady={ready} />);
  await waitFor(() => expect(ready).toHaveBeenCalledTimes(2));
  expect(runtime.createWorkbook.mock.calls[1]![0].sheets.inputs).toMatchObject({ scrollTop: 500, scrollLeft: 70, zoomRatio: 1.2 });
  expect(runtime.getRange).toHaveBeenCalledWith({ startRow: 5, endRow: 5, startColumn: 2, endColumn: 2 }); expect(runtime.select).toHaveBeenCalledTimes(1);
});

it('permits typing after deliberate focus while keeping startup and outside focus protected', async () => {
  render(<WorkbookGrid id="grid" title="Revenue" model={model} onSnapshot={() => {}} />);
  await waitFor(() => expect(runtime.activeSheet).toHaveBeenCalled());
  expect(runtime.context).not.toHaveBeenCalled();
  fireEvent.pointerDown(screen.getByRole('region', { name: 'Workbook grid' }));
  expect(runtime.context).toHaveBeenLastCalledWith('disableAutoFocus', false);
  fireEvent(window, new Event('blur')); expect(runtime.context).toHaveBeenLastCalledWith('disableAutoFocus', true);
});
