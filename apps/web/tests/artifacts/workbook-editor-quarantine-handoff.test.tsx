// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Univer, LocaleType, ICommandService, IUniverInstanceService, UniverInstanceType, type Workbook, type IWorkbookData } from '@univerjs/core';
import { UniverSheetsPlugin, RemoveSheetCommand } from '@univerjs/sheets';
import { FUniver } from '@univerjs/core/facade';
import '@univerjs/sheets/facade';
import English from '@univerjs/sheets/locale/en-US';
import type { WorkbookDocument } from '@open-design/contracts/runtime/workbook';
import { gridWorkbook } from '../../src/components/embedded/workbook/grid-model';
import { seedWorkbookStructureIdentity } from '../../src/components/embedded/workbook/grid-structure-identity';
import { WorkbookWriter } from '../../src/components/embedded/workbook/workbook-writer';
import { serializeWorkbookDraft } from '../../src/components/embedded/workbook/draft-store';
import { decodeWorkbookDraft } from '../../src/components/embedded/workbook/workbook-checkpoint';
import { captureWorkbookSourceDeletion, stampWorkbookSourceDeletion } from '../../src/components/embedded/workbook/sheet-delete-context';
import { useWorkbookEditor } from '../../src/components/embedded/workbook/use-workbook-editor';
import { saveWorkbook } from '../../src/components/embedded/workbook/save-transport';
vi.mock('../../src/components/embedded/workbook/save-transport', async original => ({ ...await original<object>(), saveWorkbook: vi.fn(async () => { throw Error('Unexpected remote write'); }) }));
const scope = { viewerId: 'handoff-person', projectId: 'b8da6679-1b82-4319-9148-2d378bed6b9d', fileName: 'Book.xlsx', draftId: '20707804-dc6b-4780-8396-be4b2963e242' };
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); });

async function quarantined() {
  const model: WorkbookDocument = { version: 1, date1904: false, activeSheetId: '1', styles: [{}], worksheetStructureEditable: true, worksheetMembershipEditable: true, calculationMetadata: 'verified', features: { charts: 0, drawings: 0, externalLinks: 0, macros: false, signed: false }, sheets: ['1','2'].map(id => ({ id, name: `Sheet ${id}`, visibility: 'visible', rowCount: 100, columnCount: 26, cells: [{ row: 0, column: 0, kind: 'number', value: 12 }], merges: [], rowDimensions: [], columnDimensions: [], frozenRows: 0, frozenColumns: 0, arrayFormulas: [] })) };
  const source = { sourceSha256: 'a'.repeat(64), model }, seed = seedWorkbookStructureIdentity(gridWorkbook(model, `${scope.projectId}:${scope.fileName}`, 'Workbook').data as IWorkbookData, source.sourceSha256);
  const univer = new Univer({ locale: LocaleType.EN_US, locales: { [LocaleType.EN_US]: English } }); univer.registerPlugin(UniverSheetsPlugin);
  const api = FUniver.newAPI(univer), book = api.createWorkbook(seed), instances = univer.__getInjector().get(IUniverInstanceService); instances.focusUnit(book.getId());
  const unit = instances.getUnit<Workbook>(book.getId(), UniverInstanceType.UNIVER_SHEET)!, initial = book.save();
  const journal = { scope, isCurrent: () => true, validate: (state: ReturnType<WorkbookWriter['checkpoint']>) => { serializeWorkbookDraft(scope, state); }, save: async () => {} };
  const writer = new WorkbookWriter(source, initial, async () => { throw Error('No remote write'); }, () => {}, undefined, journal);
  try {
    const context = captureWorkbookSourceDeletion(scope, writer.checkpoint(), '2'), prospective = structuredClone(initial); delete prospective.sheets['2']; prospective.sheetOrder = ['1'];
    await expect(writer.protectSheetDeletion(context, prospective, () => {
      stampWorkbookSourceDeletion(unit.getSheetBySheetId('2')!, context.descriptor);
      univer.__getInjector().get(ICommandService).syncExecuteCommand(RemoveSheetCommand.id, { unitId: book.getId(), subUnitId: '2' });
      book.getSheetBySheetId('1')!.getRange('A1').setValue(99); return book.save();
    })).rejects.toThrow('recovery');
    expect(book.getSheetBySheetId('2')).toBeNull();
    const checkpoint = decodeWorkbookDraft(JSON.parse(serializeWorkbookDraft(scope, writer.checkpoint())), scope);
    return { source, initial, checkpoint, journal: { ...journal, restored: checkpoint } };
  } finally { await writer.close(); univer.dispose(); }
}

it.each(['ready-reset', 'cancel-discard'] as const)('retains the actual SDK quarantine through %s handoff instead of treating its pre-command snapshot as clean', async action => {
  const f = await quarantined(), messages: Record<string, unknown>[] = [];
  vi.spyOn(window, 'postMessage').mockImplementation(value => { messages.push(value as Record<string, unknown>); });
  const hook = renderHook(() => useWorkbookEditor(scope.projectId, scope.fileName, f.source, vi.fn(), undefined, f.journal));
  await act(async () => { await hook.result.current.ready(f.initial); });
  expect(hook.result.current.checkpoint()?.sheetActionConflict).toBe(true);
  if (action === 'ready-reset') await act(async () => { await hook.result.current.ready(f.initial); });
  else {
    const controllerId = hook.result.current.controllerId, requestId = crypto.randomUUID();
    const request = (type: string) => window.dispatchEvent(new MessageEvent('message', { source: window, origin: window.location.origin, data: { type, projectId: scope.projectId, controllerId, requestId } }));
    act(() => { request('studio:prepare-workbook-discard'); });
    await waitFor(() => expect(messages.some(value => value.type === 'studio:workbook-discard-ready' && value.requestId === requestId)).toBe(true));
    act(() => { request('studio:cancel-workbook-discard'); });
    await waitFor(() => expect(messages.some(value => value.type === 'studio:workbook-discarded' && value.uncommitted === true)).toBe(true));
  }
  expect(hook.result.current.checkpoint()?.sheetActionConflict).toBe(true);
  expect(hook.result.current.state).toMatchObject({ dirty: true, error: expect.stringContaining('recovery') });
  const changed = structuredClone(f.initial); changed.sheets['1']!.cellData![0]![0]!.v = 20;
  await act(async () => {
    hook.result.current.snapshot(changed);
    window.dispatchEvent(new MessageEvent('message', { source: window, origin: window.location.origin, data: { type: 'studio:workbook-control', projectId: scope.projectId, controllerId: hook.result.current.controllerId, action: 'save' } }));
  });
  expect(saveWorkbook).not.toHaveBeenCalled(); expect(hook.result.current.checkpoint()?.desired).toEqual(f.checkpoint.desired);
  expect(hook.result.current.checkpoint()?.sheetDeletions).toEqual(f.checkpoint.sheetDeletions);
});
