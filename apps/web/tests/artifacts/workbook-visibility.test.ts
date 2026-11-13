import { legacyWorkbookWrite } from '../fixtures/workbook-write-result';
import { afterEach, expect, it, vi } from 'vitest';
import { ICommandService, IUniverInstanceService, LocaleType, Univer } from '@univerjs/core';
import { FUniver } from '@univerjs/core/facade';
import { UniverSheetsPlugin, SetWorksheetHideCommand, SetWorksheetHideMutation, SetWorksheetShowCommand } from '@univerjs/sheets';
import '@univerjs/sheets/facade';
import English from '@univerjs/preset-sheets-core/locales/en-US';
import type { WorkbookDocument } from '@open-design/contracts/runtime/workbook';
import { workbookEditPlanSchema } from '@open-design/contracts/runtime/workbook';
import type { IWorkbookData } from '@univerjs/presets';
import { gridWorkbook } from '../../src/components/embedded/workbook/grid-model';
import { workbookGridEdits } from '../../src/components/embedded/workbook/grid-edits';
import { ownWorkbookVisibility, workbookVisibilityBridge } from '../../src/components/embedded/workbook/grid-visibility';
import { assertWorkbookCalculationMutation } from '../../src/components/embedded/workbook/formula-worker-budget';
import { WorkbookWriter, type WorkbookCheckpoint, type WorkbookWriteIntent } from '../../src/components/embedded/workbook/workbook-writer';

const sha = 'a'.repeat(64), closers: (() => void)[] = [];
afterEach(() => { closers.splice(0).reverse().forEach(close => close()); vi.unstubAllGlobals(); });
function source(): WorkbookDocument {
  return { version: 1, worksheetVisibilityEditable: true, date1904: false, activeSheetId: 'a', styles: [{}], features: { charts: 0, drawings: 0, externalLinks: 0, macros: false, signed: false },
    sheets: ['a', 'b', 'c', 'secret'].map((id, index) => ({ id, name: id, visibility: index === 3 ? 'veryHidden' : index === 2 ? 'hidden' : 'visible', rowCount: 100, columnCount: 26, cells: [], merges: [], rowDimensions: [], columnDimensions: [], frozenRows: 0, frozenColumns: 0 })) };
}
function data(model = source()) { return gridWorkbook(model, 'visibility', 'Visibility').data as IWorkbookData; }
it('derives only bounded visibility deltas, refuses unqualified/veryHidden/last-visible changes and keeps other structure blocked', () => {
  const model = source(), initial = data(model), changed = structuredClone(initial); changed.sheets.b!.hidden = 1;
  expect(workbookGridEdits(model, sha, initial, changed)).toEqual({ sourceSha256: sha, edits: [], visibility: [{ sheetId: 'b', visibility: 'hidden' }] });
  expect(() => workbookGridEdits({ ...model, worksheetVisibilityEditable: undefined }, sha, initial, changed)).toThrow('visibility');
  changed.sheets.a!.hidden = 1; expect(() => workbookGridEdits(model, sha, initial, changed)).toThrow('at least one');
  changed.sheets.a!.hidden = 0; changed.sheets.secret!.hidden = 0; expect(() => workbookGridEdits(model, sha, initial, changed)).toThrow('visibility');
  changed.sheets.secret!.hidden = 2; changed.sheets.b!.name = 'Renamed'; expect(() => workbookGridEdits(model, sha, initial, changed)).toThrow('structure');
  expect(workbookEditPlanSchema.safeParse({ sourceSha256: sha, edits: [], visibility: [{ sheetId: 'b', visibility: 'hidden' }, { sheetId: 'b', visibility: 'visible' }] }).success).toBe(false);
});
it('admits exact geometry-preserving visibility mutations to calculation while refusing arbitrary hidden states and cross-workbook writes', () => {
  const book = data(), params = { unitId: book.id, subUnitId: 'b', hidden: 1 };
  expect(() => assertWorkbookCalculationMutation({ id: SetWorksheetHideMutation.id, params }, [book], 'range')).not.toThrow();
  for (const invalid of [{ ...params, hidden: 2 }, { ...params, subUnitId: 'secret', hidden: 0 }, { ...params, unitId: 'other' }, { ...params, subUnitId: 'missing' }]) expect(() => assertWorkbookCalculationMutation({ id: SetWorksheetHideMutation.id, params: invalid }, [book], 'range')).toThrow();
  book.sheets.b!.hidden = 1;
  expect(() => assertWorkbookCalculationMutation({ id: SetWorksheetHideMutation.id, params: { ...params, subUnitId: 'a' } }, [book], 'range')).toThrow('at least one');
});
it('uses real SDK visibility commands with undo/redo and refuses writes before ready, after readiness is withdrawn, or into veryHidden sheets', async () => {
  const model = source(), univer = new Univer({ locale: LocaleType.EN_US, locales: { [LocaleType.EN_US]: English } }); closers.push(() => univer.dispose());
  let book: ReturnType<FUniver['createWorkbook']> | undefined, ready = false;
  const owner = ownWorkbookVisibility(univer, () => model, () => book?.save(), () => ready); closers.push(() => owner.dispose());
  univer.registerPlugin(UniverSheetsPlugin); const api = FUniver.newAPI(univer); book = api.createWorkbook(data(model)); book.setEditable(true);
  univer.__getInjector().get(IUniverInstanceService).focusUnit(book.getId());
  const commands = univer.__getInjector().get(ICommandService), params = { unitId: book.getId(), subUnitId: 'b' };
  expect(() => commands.syncExecuteCommand(SetWorksheetHideMutation.id, { ...params, hidden: 1 })).toThrow('not ready');
  ready = true;
  expect(() => commands.syncExecuteCommand(SetWorksheetHideMutation.id, { ...params, hidden: 1 }, { fromFormula: true })).toThrow('Calculation cannot');
  expect(commands.syncExecuteCommand(SetWorksheetHideCommand.id, params)).toBe(true);
  expect(book.save().sheets.b!.hidden).toBe(1);
  await api.undo(); expect(book.save().sheets.b!.hidden).toBe(0);
  await api.redo(); expect(book.save().sheets.b!.hidden).toBe(1);
  expect(commands.syncExecuteCommand(SetWorksheetShowCommand.id, params)).toBe(true);
  expect(book.save().sheets.b!.hidden).toBe(0);
  expect(() => commands.syncExecuteCommand(SetWorksheetHideMutation.id, { ...params, subUnitId: 'secret', hidden: 0 })).toThrow('cannot be changed');
  ready = false;
  expect(() => commands.syncExecuteCommand(SetWorksheetHideMutation.id, { ...params, hidden: 1 })).toThrow('not ready');
});
it('checks parent origin, controller, source, read-only and blocked state and omits veryHidden from header state', () => {
  const model = source(), univer = new Univer({ locale: LocaleType.EN_US, locales: { [LocaleType.EN_US]: English } }); closers.push(() => univer.dispose()); univer.registerPlugin(UniverSheetsPlugin);
  const api = FUniver.newAPI(univer), book = api.createWorkbook(data(model)); book.setEditable(true);
  const owner = ownWorkbookVisibility(univer, () => model, () => book.save(), () => !scope.blocked); closers.push(() => owner.dispose());
  const postMessage = vi.fn(), parent = { postMessage }, handlers = new Set<(event: MessageEvent) => void>();
  vi.stubGlobal('window', { parent, location: { origin: 'http://fixture.invalid' }, addEventListener: (_: string, fn: (event: MessageEvent) => void) => handlers.add(fn), removeEventListener: (_: string, fn: (event: MessageEvent) => void) => handlers.delete(fn) });
  const scope = { projectId: '11111111-1111-4111-8111-111111111111', controllerId: '22222222-2222-4222-8222-222222222222', sourceSha256: sha, blocked: false };
  const bridge = workbookVisibilityBridge(univer, api, () => model, () => scope); closers.push(bridge.dispose);
  // The strict wire shape has no host-internal blocked property.
  const send = (fields: Record<string, unknown> = {}, envelope: Record<string, unknown> = {}) => {
    const payload = { type: 'studio:workbook-visibility', projectId: scope.projectId, controllerId: scope.controllerId, sourceSha256: scope.sourceSha256, sheetId: 'b', visibility: 'hidden', ...fields };
    handlers.forEach(fn => fn({ source: parent, origin: 'http://fixture.invalid', data: payload, ...envelope } as unknown as MessageEvent));
  };
  expect(postMessage.mock.lastCall?.[0]).toMatchObject({ editable: true, activeSheetId: 'a', sheets: [expect.objectContaining({ id: 'a', canHide: true }), expect.objectContaining({ id: 'b', canHide: true }), expect.objectContaining({ id: 'c', visibility: 'hidden', canHide: false })] });
  for (const fields of [{ controllerId: crypto.randomUUID() }, { projectId: crypto.randomUUID() }, { sourceSha256: 'b'.repeat(64) }]) send(fields);
  send({}, { source: {}, origin: 'http://fixture.invalid' }); send({}, { origin: 'http://other.invalid' });
  expect(book.save().sheets.b!.hidden).toBe(0);
  scope.blocked = true; send(); bridge.publish(); expect(postMessage.mock.lastCall?.[0].editable).toBe(false);
  scope.blocked = false; send(); expect(book.save().sheets.b!.hidden).toBe(1);
  send({ sheetId: 'a' }); expect(book.save().sheets.a!.hidden).toBe(0); expect(postMessage.mock.lastCall?.[0].error).toContain('at least one');
  send({ sheetId: 'secret', visibility: 'visible' }); expect(book.save().sheets.secret!.hidden).toBe(2);
  book.setEditable(false); send({ sheetId: 'b', visibility: 'visible' }); expect(book.save().sheets.b!.hidden).toBe(1);
  bridge.dispose(); expect(handlers.size).toBe(0);
});
it('journals visibility-only writes before admission and retries the identical intent after uncertain transport', async () => {
  const model = source(), initial = data(model), desired = structuredClone(initial); desired.sheets.b!.hidden = 1;
  const saved: (WorkbookCheckpoint | null)[] = [], intents: WorkbookWriteIntent[] = [];
  const write = vi.fn(async (intent: WorkbookWriteIntent) => { intents.push(intent); expect(saved.at(-1)?.pending?.intent.id).toBe(intent.id); if (intents.length === 1) throw new Error('Response lost'); return legacyWorkbookWrite({ sourceSha256: 'b'.repeat(64), model: { ...model, sheets: model.sheets.map(sheet => sheet.id === 'b' ? { ...sheet, visibility: 'hidden' as const } : sheet) } }); });
  const writer = new WorkbookWriter({ sourceSha256: sha, model }, initial, write, () => {}, undefined, { save: async checkpoint => { saved.push(structuredClone(checkpoint)); } });
  writer.update(desired); expect(writer.state().dirty).toBe(true); await writer.flush();
  const checkpoint = writer.checkpoint(); await writer.close();
  const recovered = new WorkbookWriter({ sourceSha256: sha, model }, initial, write, () => {}, undefined, { save: async value => { saved.push(structuredClone(value)); }, restored: checkpoint });
  await recovered.flush();
  expect(intents[0]!.id).toBe(intents[1]!.id); expect(intents[1]!.plan.visibility).toEqual([{ sheetId: 'b', visibility: 'hidden' }]);
  expect(recovered.state()).toMatchObject({ dirty: false, error: null }); expect(saved.at(-1)).toBeNull(); await recovered.close();
});
it('keeps a visibility bridge inert without a current scope', () => {
  const model = source(), postMessage = vi.fn(), handlers = new Set<(event: MessageEvent) => void>(), parent = { postMessage };
  vi.stubGlobal('window', { parent, location: { origin: 'http://fixture.invalid' }, addEventListener: (_: string, fn: (event: MessageEvent) => void) => handlers.add(fn), removeEventListener: (_: string, fn: (event: MessageEvent) => void) => handlers.delete(fn) });
  const bridge = workbookVisibilityBridge({} as Univer, {} as FUniver, () => model, () => undefined);
  bridge.publish();
  handlers.forEach(fn => fn({ source: parent, origin: 'http://fixture.invalid', data: { type: 'studio:artifact-request' } } as unknown as MessageEvent));
  expect(postMessage).not.toHaveBeenCalled(); bridge.dispose(); expect(handlers.size).toBe(0);
});


it('withdraws mutation authority when the rebased source getter removes visibility capability', () => {
  let model = source(); const univer = new Univer({ locale: LocaleType.EN_US, locales: { [LocaleType.EN_US]: English } }); closers.push(() => univer.dispose());
  let book: ReturnType<FUniver['createWorkbook']> | undefined;
  const owner = ownWorkbookVisibility(univer, () => model, () => book?.save(), () => true); closers.push(() => owner.dispose());
  univer.registerPlugin(UniverSheetsPlugin); const api = FUniver.newAPI(univer); book = api.createWorkbook(data(model));
  const commands = univer.__getInjector().get(ICommandService), params = { unitId: book.getId(), subUnitId: 'b', hidden: 1 };
  model = { ...model, worksheetVisibilityEditable: false };
  expect(() => commands.syncExecuteCommand(SetWorksheetHideMutation.id, params)).toThrow(); expect(book.save().sheets.b!.hidden).toBe(0);
});
