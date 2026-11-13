import { afterEach, expect, it } from 'vitest';
import { Univer, LocaleType, ICommandService, IUndoRedoService, IUniverInstanceService, UniverInstanceType, type Workbook, type IWorkbookData } from '@univerjs/core';
import { UniverSheetsPlugin, RemoveSheetCommand, InsertSheetMutation } from '@univerjs/sheets';
import { FUniver } from '@univerjs/core/facade';
import '@univerjs/sheets/facade';
import English from '@univerjs/sheets/locale/en-US';
import type { WorkbookDocument } from '@open-design/contracts/runtime/workbook';
import type { WorkbookCheckpoint } from '../../src/components/embedded/workbook/workbook-writer';
import { gridWorkbook } from '../../src/components/embedded/workbook/grid-model';
import { seedWorkbookStructureIdentity } from '../../src/components/embedded/workbook/grid-structure-identity';
import { captureWorkbookSourceDeletion, stampWorkbookSourceDeletion, associateWorkbookSourceDeletion, workbookSourceDeletionBaselineIdentity, WORKBOOK_SHEET_DELETE_MARKER } from '../../src/components/embedded/workbook/sheet-delete-context';
import { checkedWorkbookSaveAcknowledgement } from '../../src/components/embedded/workbook/save-provenance';
const scope = { viewerId: 'owned-person', projectId: '11111111-1111-4111-8111-111111111111', fileName: 'book.xlsx', draftId: '22222222-2222-4222-8222-222222222222' };
const sourceSha256 = 'a'.repeat(64), targetSha256 = 'b'.repeat(64);
const closers: (() => void)[] = []; afterEach(() => closers.splice(0).reverse().forEach(close => close()));
function fixture() {
  const model: WorkbookDocument = { version: 1, date1904: false, activeSheetId: '1', worksheetStructureEditable: true, calculationMetadata: 'verified', styles: [{}, { font: { bold: true, size: 11 } }], features: { charts: 0, drawings: 0, externalLinks: 0, macros: false, signed: false },
    sheets: ['1','2','3'].map(id => ({ id, name: `Sheet ${id}`, visibility: 'visible', rowCount: 100, columnCount: 26, cells: [{ row: 0, column: 0, kind: 'number', value: 12, style: id === '2' ? 1 : 0 }], merges: [], rowDimensions: [], columnDimensions: [], frozenRows: 0, frozenColumns: 0, arrayFormulas: [] })) };
  const initial = seedWorkbookStructureIdentity(gridWorkbook(model, `${scope.projectId}:${scope.fileName}`, 'Workbook').data as IWorkbookData, sourceSha256);
  const univer = new Univer({ locale: LocaleType.EN_US, locales: { [LocaleType.EN_US]: English } }); closers.push(() => univer.dispose()); univer.registerPlugin(UniverSheetsPlugin);
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
