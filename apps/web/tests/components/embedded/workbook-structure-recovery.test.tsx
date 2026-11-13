// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { IUniverInstanceService, LocaleType, Univer, type IWorkbookData } from '@univerjs/core';
import { FUniver } from '@univerjs/core/facade';
import { UniverSheetsPlugin } from '@univerjs/sheets';
import '@univerjs/sheets/facade';
import English from '@univerjs/preset-sheets-core/locales/en-US';
import type { WorkbookDocument } from '@open-design/contracts/runtime/workbook';
import { gridWorkbook } from '../../../src/components/embedded/workbook/grid-model';
import { ownWorkbookAxisIdentity, seedWorkbookStructureIdentity } from '../../../src/components/embedded/workbook/grid-structure-identity';
import { readWorkbookDraft, saveWorkbookDraft } from '../../../src/components/embedded/workbook/draft-store';
import { useWorkbookEditor } from '../../../src/components/embedded/workbook/use-workbook-editor';
import type { WorkbookSaveAttempt } from '../../../src/components/embedded/workbook/save-transport';
const host = vi.hoisted(() => ({ save: vi.fn(), load: vi.fn() }));
vi.mock('../../../src/components/embedded/workbook/save-transport', async original => ({ ...await original<object>(), saveWorkbook: host.save }));
vi.mock('../../../src/components/embedded/workbook/preview-transport', () => ({ loadWorkbookPreview: host.load }));
const projectId = '18a8301a-b6e1-4001-8000-c967b1eab222', fileName = 'Forecast.xlsx';
const scope = { viewerId: 'person-one', projectId, fileName, draftId: '18a8301a-b6e1-4001-8000-c967b1eab224' };
const initialSha = 'a'.repeat(64), savedSha = 'b'.repeat(64), laterSha = 'c'.repeat(64);
const closers: (() => void)[] = [];
beforeEach(() => vi.stubGlobal('indexedDB', new IDBFactory()));
afterEach(() => { cleanup(); closers.splice(0).reverse().forEach(close => close()); vi.restoreAllMocks(); vi.resetAllMocks(); vi.unstubAllGlobals(); });
function model(row = 1, column = 1, value = 12): WorkbookDocument {
  return { version: 1, worksheetStructureEditable: true, date1904: false, activeSheetId: 's', styles: [{}], features: { charts: 0, drawings: 0, externalLinks: 0, macros: false, signed: false },
    sheets: [{ id: 's', name: 'Data', visibility: 'visible', rowCount: 100, columnCount: 26, cells: [{ row, column, kind: 'number', value }], merges: [], rowDimensions: [], columnDimensions: [], frozenRows: 0, frozenColumns: 0 }] };
}
function kernel(source: { model: WorkbookDocument; sourceSha256: string }) {
  const seed = seedWorkbookStructureIdentity(gridWorkbook(source.model, `${projectId}:${fileName}`, 'Forecast').data as IWorkbookData, source.sourceSha256);
  const univer = new Univer({ locale: LocaleType.EN_US, locales: { [LocaleType.EN_US]: English } }); closers.push(() => univer.dispose());
  let book: ReturnType<FUniver['createWorkbook']> | undefined;
  const identity = ownWorkbookAxisIdentity(univer, () => book?.save(), () => true); closers.push(() => identity.dispose());
  univer.registerPlugin(UniverSheetsPlugin); const api = FUniver.newAPI(univer); book = api.createWorkbook(seed); book.setEditable(true);
  univer.__getInjector().get(IUniverInstanceService).focusUnit(book.getId());
  return { book, sheet: book.getActiveSheet(), initial: book.save() };
}
function save(controllerId: string) {
  window.dispatchEvent(new MessageEvent('message', { source: window, origin: window.location.origin, data: { type: 'studio:workbook-control', projectId, controllerId, action: 'save' } }));
}
for (const admitted of [false, true]) it(`round-trips structural birth identities and resumes the same ${admitted ? 'admitted save' : 'uncertain preparation'} before a later dirty edit`, async () => {
  const source = { model: model(), sourceSha256: initialSha }, grid = kernel(source);
  const journal = { save: (checkpoint: Parameters<typeof saveWorkbookDraft>[1]) => saveWorkbookDraft(scope, checkpoint) };
  const renderId = '18a8301a-b6e1-4001-8000-c967b1eab225';
  host.save.mockImplementation(async (attempt: WorkbookSaveAttempt, _signal: AbortSignal, checkpoint: () => Promise<void>) => {
    if (admitted) { attempt.renderId = renderId; await checkpoint(); }
    throw Error('Owned response lost');
  });
  const first = renderHook(() => useWorkbookEditor(projectId, fileName, source, vi.fn(), undefined, journal));
  await act(async () => { await first.result.current.ready(grid.initial); });
  grid.sheet.insertRowsBefore(1, 1); grid.sheet.insertColumnsBefore(1, 1);
  act(() => first.result.current.snapshot(grid.book.save()));
  await act(async () => save(first.result.current.controllerId));
  await waitFor(() => expect(first.result.current.state.error).toContain('Owned response lost'));
  const frozen = structuredClone(first.result.current.checkpoint()!.pending!);
  expect(frozen.intent.plan.structure?.[0]).toMatchObject({ sourceRows: 100, sourceColumns: 26, rows: [0, null, ...Array.from({ length: 99 }, (_, i) => i + 1)], columns: [0, null, ...Array.from({ length: 25 }, (_, i) => i + 1)] });
  expect(frozen.intent.renderId).toBe(admitted ? renderId : undefined);
  const bornRow = grid.book.save().sheets.s!.rowData![1]!.custom, bornColumn = grid.book.save().sheets.s!.columnData![1]!.custom;
  expect(bornRow?.evebotSourceAxis).toMatchObject({ id: expect.stringMatching(/^new:/) });
  grid.sheet.getRange(2, 2).setValue(36);
  act(() => first.result.current.snapshot(grid.book.save()));
  await waitFor(async () => expect((await readWorkbookDraft(scope))?.desired.sheets.s!.cellData![2]![2]!.v).toBe(36));
  await act(async () => { await first.result.current.close(); }); first.unmount();
  const restored = await readWorkbookDraft(scope); expect(restored).not.toBeNull();
  expect(restored!.pending).toEqual(frozen);
  expect(restored!.desired.sheets.s!.rowData![1]!.custom).toEqual(bornRow);
  expect(restored!.desired.sheets.s!.columnData![1]!.custom).toEqual(bornColumn);
  const applied = { model: model(2, 2), sourceSha256: savedSha }, later = { model: model(2, 2, 36), sourceSha256: laterSha };
  const attempts: WorkbookSaveAttempt[] = [];
  host.save.mockImplementation(async (attempt: WorkbookSaveAttempt) => { attempts.push(structuredClone(attempt)); return { targetSha256: attempts.length === 1 ? savedSha : laterSha }; });
  host.load.mockResolvedValueOnce(applied).mockResolvedValueOnce(later);
  const acknowledged = vi.fn(), fresh = kernel(applied);
  const restoredJournal = { ...journal, restored: restored! };
  const resumed = renderHook(() => useWorkbookEditor(projectId, fileName, applied, acknowledged, undefined, restoredJournal));
  await act(async () => { await resumed.result.current.ready(fresh.initial); });
  await act(async () => save(resumed.result.current.controllerId));
  await waitFor(() => expect(resumed.result.current.state).toMatchObject({ dirty: false, saving: false, error: null }));
  expect(attempts).toHaveLength(2);
  expect(attempts[0]).toMatchObject({ operationId: frozen.intent.id, preparationId: frozen.intent.preparationId, renderId: frozen.intent.renderId, plan: frozen.intent.plan });
  expect(attempts[1]!.operationId).not.toBe(frozen.intent.id);
  expect(attempts[1]!.plan.sourceSha256).toBe(savedSha);
  expect(attempts[1]!.plan.structure).toBeUndefined(); // Never apply the insertion a second time.
  expect(attempts[1]!.plan.edits).toEqual([{ sheetId: 's', cell: { row: 2, column: 2, kind: 'number', value: 36 } }]);
  expect(await readWorkbookDraft(scope)).toBeNull();
  expect(acknowledged).toHaveBeenLastCalledWith(later);
});

it('starts a second structural operation from the fresh post-ACK kernel, not retired axis identities', async () => {
  let source = { model: model(), sourceSha256: initialSha };
  const firstGrid = kernel(source), acknowledged = vi.fn(), journal = { save: vi.fn(async () => {}) };
  const view = renderHook(() => useWorkbookEditor(projectId, fileName, source, acknowledged, undefined, journal));
  const applied = { model: model(2, 1), sourceSha256: savedSha };
  host.save.mockResolvedValue({ targetSha256: savedSha }); host.load.mockResolvedValue(applied);
  await act(async () => { await view.result.current.ready(firstGrid.initial); });
  firstGrid.sheet.insertRowsBefore(1, 1); act(() => view.result.current.snapshot(firstGrid.book.save()));
  await act(async () => save(view.result.current.controllerId));
  await waitFor(() => expect(view.result.current.state.dirty).toBe(false));
  expect(acknowledged).toHaveBeenLastCalledWith(applied);
  source = applied; view.rerender(); const secondGrid = kernel(source);
  await act(async () => { await view.result.current.ready(secondGrid.initial); });
  expect(view.result.current.checkpoint()!.acknowledged.custom).toEqual(secondGrid.initial.custom);
  secondGrid.sheet.insertColumnsBefore(1, 1); act(() => view.result.current.snapshot(secondGrid.book.save()));
  host.save.mockClear(); const next = { model: model(2, 2), sourceSha256: laterSha };
  host.save.mockResolvedValue({ targetSha256: laterSha }); host.load.mockResolvedValue(next);
  await act(async () => save(view.result.current.controllerId));
  await waitFor(() => expect(view.result.current.state.dirty).toBe(false));
  const attempt = host.save.mock.calls[0]![0] as WorkbookSaveAttempt;
  expect(attempt.plan.sourceSha256).toBe(savedSha);
  expect(attempt.plan.structure).toHaveLength(1);
  expect(attempt.plan.structure![0]!.sourceRows).toBe(100); // A fresh reader window, not the old 101-row SDK window.
  expect(attempt.plan.structure![0]!.rows).toEqual(Array.from({ length: 100 }, (_, i) => i));
  expect(attempt.plan.structure![0]!.columns).toEqual([0, null, ...Array.from({ length: 25 }, (_, i) => i + 1)]);
  expect(attempt.plan.edits).toEqual([]);
});
