import { afterEach, expect, it } from 'vitest';
import { Univer, LocaleType, ICommandService, IUndoRedoService, IUniverInstanceService, UniverInstanceType, type Workbook, type IWorkbookData } from '@univerjs/core';
import { UniverSheetsPlugin, RemoveSheetCommand, InsertSheetMutation } from '@univerjs/sheets';
import { UniverFormulaEnginePlugin } from '@univerjs/engine-formula';
import { CalculationMode, UniverSheetsFormulaPlugin } from '@univerjs/sheets-formula';
import { FUniver } from '@univerjs/core/facade';
import '@univerjs/sheets/facade';
import English from '@univerjs/sheets/locale/en-US';
import type { WorkbookDocument } from '@open-design/contracts/runtime/workbook';
import { WorkbookWriter, type WorkbookCheckpoint } from '../../src/components/embedded/workbook/workbook-writer';
import { serializeWorkbookDraft } from '../../src/components/embedded/workbook/draft-store';
import { decodeWorkbookDraft } from '../../src/components/embedded/workbook/workbook-checkpoint';
import { workbookGridPlan } from '../../src/components/embedded/workbook/grid-plan';
import { gridWorkbook } from '../../src/components/embedded/workbook/grid-model';
import { seedWorkbookStructureIdentity } from '../../src/components/embedded/workbook/grid-structure-identity';
import { captureWorkbookSourceDeletion, stampWorkbookSourceDeletion, associateWorkbookSourceDeletion, workbookSourceDeletionBaselineIdentity, WORKBOOK_SHEET_DELETE_MARKER } from '../../src/components/embedded/workbook/sheet-delete-context';
import { checkedWorkbookSaveAcknowledgement } from '../../src/components/embedded/workbook/save-provenance';
const scope = { viewerId: 'owned-person', projectId: '11111111-1111-4111-8111-111111111111', fileName: 'book.xlsx', draftId: '22222222-2222-4222-8222-222222222222' };
const sourceSha256 = 'a'.repeat(64), targetSha256 = 'b'.repeat(64);
const closers: (() => void)[] = []; afterEach(() => closers.splice(0).reverse().forEach(close => close()));
function fixture(withFormulas = false) {
  const model: WorkbookDocument = { version: 1, date1904: false, activeSheetId: '1', worksheetStructureEditable: true, calculationMetadata: 'verified', styles: [{}, { font: { bold: true, size: 11 } }], features: { charts: 0, drawings: 0, externalLinks: 0, macros: false, signed: false },
    sheets: ['1','2','3'].map(id => ({ id, name: `Sheet ${id}`, visibility: 'visible', rowCount: 100, columnCount: 26, cells: [{ row: 0, column: 0, kind: 'number', value: 12, style: id === '2' ? 1 : 0 }], merges: [], rowDimensions: [], columnDimensions: [], frozenRows: 0, frozenColumns: 0, arrayFormulas: [] })) };
  if (withFormulas) model.sheets[2]!.cells.push({ row: 1, column: 0, kind: 'number', value: 24, formula: "='Sheet 2'!A1+'Sheet 1'!A1" });
  const initial = seedWorkbookStructureIdentity(gridWorkbook(model, `${scope.projectId}:${scope.fileName}`, 'Workbook').data as IWorkbookData, sourceSha256);
  const univer = new Univer({ locale: LocaleType.EN_US, locales: { [LocaleType.EN_US]: English } }); closers.push(() => univer.dispose());
  if (withFormulas) univer.registerPlugin(UniverFormulaEnginePlugin, { notExecuteFormula: true });
  univer.registerPlugin(UniverSheetsPlugin);
  if (withFormulas) univer.registerPlugin(UniverSheetsFormulaPlugin, { notExecuteFormula: false, initialFormulaComputing: CalculationMode.NO_CALCULATION });
  const api = FUniver.newAPI(univer), book = api.createWorkbook(initial), instances = univer.__getInjector().get(IUniverInstanceService); instances.focusUnit(book.getId());
  const unit = instances.getUnit<Workbook>(book.getId(), UniverInstanceType.UNIVER_SHEET)!;
  const checkpoint: WorkbookCheckpoint = { version: 1, source: { sourceSha256, model }, acknowledged: book.save(), desired: book.save(), pending: null };
  const receipt = (overrides: Record<string, unknown> = {}) => {
    const operationId = '33333333-3333-4333-8333-333333333333', renderId = '44444444-4444-4444-8444-444444444444';
    return checkedWorkbookSaveAcknowledgement({ id: operationId, projectId: scope.projectId, fileName: scope.fileName, renderId, state: 'applied', sourceSha256, targetSha256, actualSha256: targetSha256, sourceVersionId: 'before-delete', versionId: 'after-delete', ...overrides },
      { operationId, projectId: scope.projectId, fileName: scope.fileName, renderId, preparationId: crypto.randomUUID(), plan: { sourceSha256, edits: [] } }, targetSha256);
  };
  return { api, book, unit, checkpoint, receipt, commands: univer.__getInjector().get(ICommandService), history: univer.__getInjector().get(IUndoRedoService) };
}
it('captures source and ACK before actual deletion while Undo preserves earlier unrelated and deleted-sheet edits', async () => {
  const f = fixture(), original = structuredClone(f.checkpoint);
  f.book.getSheetBySheetId('1')!.getRange('A1').setValue(20); f.book.getSheetBySheetId('2')!.getRange('A1').setValue(17); f.checkpoint.desired = f.book.save();
  const context = captureWorkbookSourceDeletion(scope, f.checkpoint, '2');
  expect(context.baseline.sheet.cells[0]).toMatchObject({ value: 12, style: 1 }); expect(context.acknowledgedSheet.cellData![0]![0]!.v).toBe(12);
  stampWorkbookSourceDeletion(f.unit.getSheetBySheetId('2')!, context.descriptor);
  f.commands.syncExecuteCommand(RemoveSheetCommand.id, { unitId: f.book.getId(), subUnitId: '2' });
  expect(f.history.getUndoRedoMutationStrings(f.book.getId(), InsertSheetMutation.id, ['sheet','custom',WORKBOOK_SHEET_DELETE_MARKER,'token']).undos).toEqual([context.descriptor.token]);
  const bound = associateWorkbookSourceDeletion(context, f.receipt());
  expect(bound.receiptAssociation).toMatchObject({ sourceVersionId: 'before-delete', sourceSha256, versionId: 'after-delete', targetSha256 });
  await f.api.undo(); expect(f.book.save().sheets['2']!.cellData![0]![0]!.v).toBe(17); expect(f.book.save().sheets['1']!.cellData![0]![0]!.v).toBe(20);
  expect(f.checkpoint.acknowledged).toEqual(original.acknowledged); expect(f.checkpoint.source).toEqual(original.source); expect(context.receiptAssociation).toBeUndefined();
});
it('replaces custom objects before capture so older real SDK undo payloads retain their immutable token', async () => {
  const f = fixture(), first = captureWorkbookSourceDeletion(scope, f.checkpoint, '2');
  const sheet = f.unit.getSheetBySheetId('2')!; sheet.setCustomMetadata({ unrelated: 'keep' });
  stampWorkbookSourceDeletion(sheet, first.descriptor); const oldCustom = sheet.getCustomMetadata();
  f.commands.syncExecuteCommand(RemoveSheetCommand.id, { unitId: f.book.getId(), subUnitId: '2' }); const oldUndo = f.history.pitchTopUndoElement()!;
  await f.api.undo(); f.checkpoint.desired = f.book.save(); const second = captureWorkbookSourceDeletion(scope, f.checkpoint, '2');
  stampWorkbookSourceDeletion(f.unit.getSheetBySheetId('2')!, second.descriptor);
  expect(second.descriptor.token).not.toBe(first.descriptor.token);
  expect(f.unit.getSheetBySheetId('2')!.getCustomMetadata()).toMatchObject({ unrelated: 'keep', [WORKBOOK_SHEET_DELETE_MARKER]: second.descriptor });
  expect(oldCustom).toMatchObject({ [WORKBOOK_SHEET_DELETE_MARKER]: first.descriptor });
  const oldInsert = oldUndo.undoMutations.find(mutation => mutation.id === InsertSheetMutation.id)!;
  expect((oldInsert.params as { sheet: { custom: Record<string, unknown> } }).sheet.custom[WORKBOOK_SHEET_DELETE_MARKER]).toEqual(first.descriptor);
});
it('refuses unsupported families, source-absent IDs, unqualified ACK geometry and cross-artifact capture before stamping', () => {
  const f = fixture();
  expect(() => captureWorkbookSourceDeletion({ ...scope, projectId: crypto.randomUUID() }, f.checkpoint, '2')).toThrow('another workbook');
  for (const mutate of [
    (c: WorkbookCheckpoint) => { c.source.model.sourceFormat = 'csv'; },
    (c: WorkbookCheckpoint) => { c.source.model.sheets[0]!.arrayFormulas = undefined; },
    (c: WorkbookCheckpoint) => { c.source.model.worksheetStructureEditable = false; },
    (c: WorkbookCheckpoint) => { c.acknowledged.sheets['2']!.cellData![0]![0]!.v = 999; },
    (c: WorkbookCheckpoint) => { delete c.acknowledged.sheets['2']!.rowData![0]!.custom; },
    (c: WorkbookCheckpoint) => { c.source.model.sheets = c.source.model.sheets.filter(sheet => sheet.id !== '2'); },
  ]) { const copy = structuredClone(f.checkpoint); mutate(copy); expect(() => captureWorkbookSourceDeletion(scope, copy, '2')).toThrow(); }
  expect(f.unit.getSheetBySheetId('2')!.getCustomMetadata()).toBeUndefined();
});
it('keeps receipt associations source/scoped and immutable without treating serialized data as new authority', () => {
  const f = fixture(), context = captureWorkbookSourceDeletion(scope, f.checkpoint, '2');
  expect(() => associateWorkbookSourceDeletion(context, { kind: 'unavailable', reason: 'legacy-receipt' })).toThrow('source-history');
  const checked = f.receipt(); if (checked.kind !== 'history') throw Error('History fixture required.');
  for (const change of [{ sourceSha256: 'c'.repeat(64) }, { projectId: crypto.randomUUID() }, { fileName: 'other.xlsx' }]) expect(() => associateWorkbookSourceDeletion(context, { kind: 'history', provenance: { ...checked.provenance, ...change } })).toThrow();
  const bound = associateWorkbookSourceDeletion(context, checked);
  expect(() => associateWorkbookSourceDeletion(bound, { kind: 'history', provenance: { ...checked.provenance, operationId: crypto.randomUUID(), sourceVersionId: 'another-before' } })).toThrow('cannot be replaced');
  const copied = JSON.parse(JSON.stringify(bound)); expect(copied.receiptAssociation.sourceVersionId).toBe('before-delete');
  copied.descriptor.sheetId = '3';
  expect(() => associateWorkbookSourceDeletion(copied, checked)).toThrow('identity');
  expect(() => stampWorkbookSourceDeletion(f.unit.getSheetBySheetId('2')!, copied.descriptor)).toThrow('target changed');
  expect(f.unit.getSheetBySheetId('2')!.getCustomMetadata()).toBeUndefined();
});

it('keeps one complete baseline and recomputes identity after JSON recovery rather than accepting a claimed hash', () => {
  const f = fixture(), context = captureWorkbookSourceDeletion(scope, f.checkpoint, '2');
  const identity = workbookSourceDeletionBaselineIdentity(context);
  expect(context.baseline.styleDefinitions).toContainEqual({ index: 1, style: { font: { bold: true, size: 11 } } });
  expect(workbookSourceDeletionBaselineIdentity(JSON.parse(JSON.stringify(context)))).toEqual(identity);
  const forged = structuredClone(context); forged.baseline.styleDefinitions[1]!.style.font!.size = 22;
  expect(workbookSourceDeletionBaselineIdentity(forged)).not.toEqual(identity);
  expect(() => workbookSourceDeletionBaselineIdentity({ ...context, baselineIdentity: identity } as typeof context)).toThrow();
  expect(context).not.toHaveProperty('sourceSheet'); expect(context).not.toHaveProperty('date1904');
});

it('protects bounded contexts through the exact existing encoder and journal while clean, then validates an actual source-present Delete plan', async () => {
  const f = fixture(), context = captureWorkbookSourceDeletion(scope, f.checkpoint, '2');
  const records: (WorkbookCheckpoint | null)[] = [], validated: WorkbookCheckpoint[] = [];
  const writer = new WorkbookWriter(f.checkpoint.source, f.checkpoint.acknowledged, async () => { throw Error('No remote write expected'); }, () => {}, undefined, {
    validate: candidate => { serializeWorkbookDraft(scope, candidate); validated.push(structuredClone(candidate)); },
    save: async candidate => { records.push(structuredClone(candidate)); },
  });
  writer.retainSheetDeletion(context); await writer.close();
  expect(validated[0]!.sheetDeletions).toEqual([context]);
  expect(records.at(-1)?.sheetDeletions).toEqual([context]);
  expect(decodeWorkbookDraft(JSON.parse(serializeWorkbookDraft(scope, writer.checkpoint())), scope).sheetDeletions).toEqual([context]);
  stampWorkbookSourceDeletion(f.unit.getSheetBySheetId('2')!, context.descriptor);
  f.commands.syncExecuteCommand(RemoveSheetCommand.id, { unitId: f.book.getId(), subUnitId: '2' });
  const deleted = f.book.save(), plan = workbookGridPlan(f.checkpoint.source.model, sourceSha256, f.checkpoint.acknowledged, deleted, [context]);
  const pending = { snapshot: deleted, intent: { id: crypto.randomUUID(), preparationId: crypto.randomUUID(), previewId: crypto.randomUUID(), plan } };
  expect(decodeWorkbookDraft(JSON.parse(serializeWorkbookDraft(scope, { ...writer.checkpoint(), pending })), scope).pending).toEqual(pending);
  const forged = { ...pending, intent: { ...pending.intent, plan: { ...plan, sheets: plan.sheets!.slice(0, 1) } } };
  expect(() => serializeWorkbookDraft(scope, { ...writer.checkpoint(), pending: forged })).toThrow();
});
it('refuses prospective context replacement, source/scope drift and validation failure without dropping protected roots', async () => {
  const f = fixture(), context = captureWorkbookSourceDeletion(scope, f.checkpoint, '2'); let refused = false;
  const writer = new WorkbookWriter(f.checkpoint.source, f.checkpoint.acknowledged, async () => { throw Error('No write'); }, () => {}, undefined, {
    validate: candidate => { serializeWorkbookDraft(scope, candidate); if (refused) throw Error('Prospective budget refusal'); }, save: async () => {},
  });
  writer.retainSheetDeletion(context); const before = writer.checkpoint();
  const second = captureWorkbookSourceDeletion(scope, f.checkpoint, '3'); refused = true;
  expect(() => writer.retainSheetDeletion(second)).toThrow('budget'); expect(writer.checkpoint()).toEqual(before);
  expect(() => writer.retainSheetDeletion({ ...context, sourceSha256: 'c'.repeat(64) })).toThrow('source changed');
  const changed = structuredClone(context); changed.baseline.sheet.cells[0]!.value = 999;
  expect(() => writer.retainSheetDeletion(changed)).toThrow('cannot be replaced');
  const crossScope = structuredClone(second); crossScope.scope.viewerId = 'another-person'; refused = false;
  expect(() => writer.retainSheetDeletion(crossScope)).toThrow('scope'); expect(writer.checkpoint()).toEqual(before);
  await writer.close();
});

it('derives source survivor membership from an actual Delete while preserving earlier unrelated authored edits', () => {
  const f = fixture(); f.book.getSheetBySheetId('1')!.getRange('A1').setValue(20); f.book.getSheetBySheetId('2')!.getRange('A1').setValue(17);
  f.checkpoint.desired = f.book.save();
  const context = captureWorkbookSourceDeletion(scope, f.checkpoint, '2');
  stampWorkbookSourceDeletion(f.unit.getSheetBySheetId('2')!, context.descriptor);
  f.commands.syncExecuteCommand(RemoveSheetCommand.id, { unitId: f.book.getId(), subUnitId: '2' });
  const plan = workbookGridPlan(f.checkpoint.source.model, sourceSha256, f.checkpoint.acknowledged, f.book.save(), [context]);
  expect(plan.sheets).toEqual([{ sheetId: '1', name: 'Sheet 1', origin: 'source' }, { sheetId: '3', name: 'Sheet 3', origin: 'source' }]);
  expect(plan.edits).toEqual([{ sheetId: '1', cell: { row: 0, column: 0, kind: 'number', value: 20, style: 0 } }]);
  expect(f.checkpoint.source.model.sheets).toHaveLength(3); expect(f.checkpoint.acknowledged.sheets['2']).toBeDefined();
});

it('preserves actual SDK cross-sheet REF rewrites and refuses unsupported global names rather than dropping them', () => {
  const f = fixture(true), context = captureWorkbookSourceDeletion(scope, f.checkpoint, '2');
  stampWorkbookSourceDeletion(f.unit.getSheetBySheetId('2')!, context.descriptor);
  f.commands.syncExecuteCommand(RemoveSheetCommand.id, { unitId: f.book.getId(), subUnitId: '2' });
  const current = f.book.save(), formula = current.sheets['3']!.cellData![1]![0]!.f;
  expect(formula).toContain('#REF!');
  const plan = workbookGridPlan(f.checkpoint.source.model, sourceSha256, f.checkpoint.acknowledged, current, [context]);
  expect(plan.edits.find(edit => edit.sheetId === '3')?.cell.formula).toBe(formula);
  const names = structuredClone(f.checkpoint.source.model); names.definedNames = [{ name: 'OwnedName', formula: "'Sheet 1'!$A$1" }];
  expect(() => workbookGridPlan(names, sourceSha256, f.checkpoint.acknowledged, current, [context])).toThrow('defined names');
});
it('keeps source, ACK, axis, survivor order and known-owner checks during membership projection', () => {
  const f = fixture(), context = captureWorkbookSourceDeletion(scope, f.checkpoint, '2');
  f.commands.syncExecuteCommand(RemoveSheetCommand.id, { unitId: f.book.getId(), subUnitId: '2' }); const current = f.book.save();
  const project = (next: typeof current, contexts = [context]) => workbookGridPlan(f.checkpoint.source.model, sourceSha256, f.checkpoint.acknowledged, next, contexts);
  const wrong = structuredClone(context); wrong.acknowledgedSheet.cellData![0]![0]!.v = 999;
  expect(() => project(current, [wrong])).toThrow('ACK context');
  const wrongOwner = structuredClone(context); wrongOwner.axisOwner.generation = crypto.randomUUID(); wrongOwner.descriptor.generation = wrongOwner.axisOwner.generation;
  expect(() => project(current, [wrongOwner])).toThrow('ACK context');
  const forged = structuredClone(context); forged.baseline.styleDefinitions[1]!.style.font!.bold = false;
  expect(() => project(current, [forged])).toThrow('ACK context');
  expect(() => project(current, [context, context])).toThrow('unique');
  const reorder = structuredClone(current); reorder.sheetOrder.reverse(); expect(() => project(reorder)).toThrow('Reordering');
  const restored = structuredClone(current); restored.sheets['4'] = { ...structuredClone(f.checkpoint.acknowledged.sheets['2']!), id: '4' }; restored.sheetOrder.push('4'); expect(() => project(restored)).toThrow('own protected owner');
  const wrongId = structuredClone(current); wrongId.sheets['1']!.id = 'wrong'; expect(() => project(wrongId)).toThrow('identity changed');
  const extraBaseline = structuredClone(f.checkpoint.acknowledged); extraBaseline.sheets['4'] = { ...structuredClone(extraBaseline.sheets['1']!), id: '4' };
  expect(() => workbookGridPlan(f.checkpoint.source.model, sourceSha256, extraBaseline, current, [context])).toThrow('identity changed');
  const badAxis = structuredClone(current); delete badAxis.sheets['1']!.rowData![0]!.custom; expect(() => project(badAxis)).toThrow();
  const badStyles = structuredClone(current); badStyles.styles['0'] = { fs: 999 }; expect(() => project(badStyles)).toThrow('formatting changed');
});

it('binds a real SDK Delete save context to its checked pre-save receipt before retiring the source, retrying storage failure without a new remote intent', async () => {
  const f = fixture(), context = captureWorkbookSourceDeletion(scope, f.checkpoint, '2');
  f.book.getSheetBySheetId('1')!.getRange('A1').setValue(20);
  stampWorkbookSourceDeletion(f.unit.getSheetBySheetId('2')!, context.descriptor);
  f.commands.syncExecuteCommand(RemoveSheetCommand.id, { unitId: f.book.getId(), subUnitId: '2' });
  const desired = f.book.save(), target = structuredClone(f.checkpoint.source); target.sourceSha256 = targetSha256;
  target.model.sheets = target.model.sheets.filter(sheet => sheet.id !== '2'); target.model.sheets[0]!.cells[0]!.value = 20;
  const records: WorkbookCheckpoint[] = [], intents: string[] = []; let fail = true;
  let result: { preview: typeof target; acknowledgement: ReturnType<typeof checkedWorkbookSaveAcknowledgement> } | undefined;
  const writer = new WorkbookWriter(f.checkpoint.source, f.checkpoint.acknowledged, async intent => {
    if (!result) {
      intents.push(intent.id); intent.renderId = crypto.randomUUID();
      const acknowledgement = checkedWorkbookSaveAcknowledgement({ id: intent.id, projectId: scope.projectId, fileName: scope.fileName, renderId: intent.renderId, state: 'applied', sourceSha256, targetSha256, actualSha256: targetSha256, sourceVersionId: 'before-delete', versionId: 'after-delete' },
        { ...intent, operationId: intent.id, projectId: scope.projectId, fileName: scope.fileName, renderId: intent.renderId }, targetSha256);
      result = { preview: target, acknowledgement };
    }
    return result;
  }, () => {}, undefined, {
    validate: candidate => { serializeWorkbookDraft(scope, candidate); },
    save: async candidate => {
      if (!candidate) throw Error('Deletion context must stay protected');
      serializeWorkbookDraft(scope, candidate);
      if (candidate.pending?.acknowledgement && fail) throw Error('Device storage failure');
      records.push(structuredClone(candidate));
    },
  });
  writer.retainSheetDeletion(context); writer.update(desired); await writer.flush();
  expect(writer.checkpoint().source.sourceSha256).toBe(sourceSha256);
  const pendingId = writer.checkpoint().pending!.intent.id;
  expect(writer.checkpoint().sheetDeletions![0]!.receiptAssociation).toMatchObject({ sourceVersionId: 'before-delete', versionId: 'after-delete' });
  fail = false; await writer.flush();
  expect(intents).toEqual([pendingId]); expect(writer.checkpoint().pending).toBeNull();
  const protectedReceipt = records.find(record => record.pending?.acknowledgement)!;
  expect(protectedReceipt.source.sourceSha256).toBe(sourceSha256);
  expect(protectedReceipt.sheetDeletions![0]!.receiptAssociation).toMatchObject({ operationId: pendingId, sourceSha256, sourceVersionId: 'before-delete', targetSha256, versionId: 'after-delete' });
  expect(records.at(-1)!.source.sourceSha256).toBe(targetSha256);
  expect(records.at(-1)!.desired.sheets['1']!.cellData![0]![0]!.v).toBe(20);
  expect(decodeWorkbookDraft(JSON.parse(serializeWorkbookDraft(scope, records.at(-1)!)), scope).sheetDeletions).toEqual(writer.checkpoint().sheetDeletions);
  await writer.close();
});

function deletionSnapshot(checkpoint: WorkbookCheckpoint, id = '2') {
  const snapshot = structuredClone(checkpoint.desired); delete snapshot.sheets[id]; snapshot.sheetOrder = snapshot.sheetOrder.filter(value => value !== id); return snapshot;
}
function protectionGate() {
  let resolve!: () => void, reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
it('awaits actual context protection before SDK removal and preserves its real Undo entry', async () => {
  const f = fixture(), context = captureWorkbookSourceDeletion(scope, f.checkpoint, '2'), gate = protectionGate(), started = protectionGate();
  const protectedRecords: WorkbookCheckpoint[] = [];
  const writer = new WorkbookWriter(f.checkpoint.source, f.checkpoint.acknowledged, async () => { throw Error('No remote write'); }, () => {}, undefined, {
    isCurrent: () => true, validate: candidate => { serializeWorkbookDraft(scope, candidate); },
    save: async candidate => { if (!candidate) return; serializeWorkbookDraft(scope, candidate); protectedRecords.push(structuredClone(candidate)); started.resolve(); await gate.promise; },
  });
  const before = f.history.getUndoRedoStatus(f.book.getId()); let calls = 0;
  const protecting = writer.protectSheetDeletion(context, deletionSnapshot(f.checkpoint), () => {
    calls++; stampWorkbookSourceDeletion(f.unit.getSheetBySheetId('2')!, context.descriptor);
    f.commands.syncExecuteCommand(RemoveSheetCommand.id, { unitId: f.book.getId(), subUnitId: '2' }); return f.book.save();
  });
  await started.promise; expect(calls).toBe(0); expect(f.book.getSheetBySheetId('2')).not.toBeNull();
  expect(f.history.getUndoRedoStatus(f.book.getId())).toEqual(before); expect(writer.checkpoint().sheetDeletions).toBeUndefined(); expect(writer.state().saving).toBe(true);
  expect(protectedRecords[0]!.sheetDeletions).toEqual([context]); expect(protectedRecords[0]!.pending).toBeNull();
  gate.resolve(); await protecting;
  expect(calls).toBe(1); expect(f.book.getSheetBySheetId('2')).toBeNull();
  expect(f.history.getUndoRedoMutationStrings(f.book.getId(), InsertSheetMutation.id, ['sheet','custom',WORKBOOK_SHEET_DELETE_MARKER,'token']).undos).toEqual([context.descriptor.token]);
  expect(writer.checkpoint().sheetDeletions).toEqual([context]); await writer.close();
});
it.each(['storage', 'lease', 'newer-edit', 'close'] as const)('refuses SDK mutation after %s during protection without losing old roots, edits or history', async reason => {
  const f = fixture(), context = captureWorkbookSourceDeletion(scope, f.checkpoint, '2'), old = captureWorkbookSourceDeletion(scope, f.checkpoint, '3'), gate = protectionGate(), started = protectionGate(); let current = true, calls = 0;
  const writer = new WorkbookWriter(f.checkpoint.source, f.checkpoint.acknowledged, async () => { throw Error('No remote write'); }, () => {}, undefined, {
    isCurrent: () => current, validate: candidate => { serializeWorkbookDraft(scope, candidate); },
    save: async candidate => { if (candidate?.sheetDeletions?.some(value => value.descriptor.token === context.descriptor.token)) { started.resolve(); await gate.promise; } },
  });
  writer.retainSheetDeletion(old); const before = f.history.getUndoRedoStatus(f.book.getId()), top = f.history.pitchTopUndoElement();
  const protecting = writer.protectSheetDeletion(context, deletionSnapshot(f.checkpoint), () => { calls++; f.commands.syncExecuteCommand(RemoveSheetCommand.id, { unitId: f.book.getId(), subUnitId: '2' }); return f.book.save(); });
  const rejected = expect(protecting).rejects.toThrow(); await started.promise;
  if (reason === 'lease') current = false;
  if (reason === 'newer-edit') { f.book.getSheetBySheetId('1')!.getRange('A1').setValue(20); writer.update(f.book.save()); }
  const afterUser = f.history.getUndoRedoStatus(f.book.getId()), userTop = f.history.pitchTopUndoElement();
  const closing = reason === 'close' ? writer.close() : null;
  if (reason === 'storage') gate.reject(Error('Device quota failed')); else gate.resolve();
  await rejected; await closing;
  expect(calls).toBe(0); expect(f.book.getSheetBySheetId('2')).not.toBeNull(); expect(writer.checkpoint().sheetDeletions).toEqual([old]);
  expect(f.history.getUndoRedoStatus(f.book.getId())).toEqual(afterUser); expect(f.history.pitchTopUndoElement()).toBe(userTop);
  if (reason === 'newer-edit') expect(writer.checkpoint().desired.sheets['1']!.cellData![0]![0]!.v).toBe(20);
  else { expect(afterUser).toEqual(before); expect(userTop).toBe(top); }
  await writer.close();
});

it('rejects a conflicting recovered source before storing or invoking the SDK action', async () => {
  const f = fixture(), context = captureWorkbookSourceDeletion(scope, f.checkpoint, '2'); let saves = 0, calls = 0;
  const writer = new WorkbookWriter({ ...f.checkpoint.source, sourceSha256: targetSha256 }, f.checkpoint.acknowledged, async () => { throw Error('No write'); }, () => {}, undefined, {
    restored: f.checkpoint, isCurrent: () => true, validate: candidate => { serializeWorkbookDraft(scope, candidate); }, save: async () => { saves++; },
  });
  await expect(writer.protectSheetDeletion(context, deletionSnapshot(f.checkpoint), () => { calls++; return f.book.save(); })).rejects.toThrow('recovered workbook source');
  expect(saves).toBe(0); expect(calls).toBe(0); expect(writer.checkpoint()).toEqual(f.checkpoint); await writer.close();
});
