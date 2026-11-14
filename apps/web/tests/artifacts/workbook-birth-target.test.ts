import { afterEach, expect, it } from 'vitest';
import { InsertSheetCommand } from '@univerjs/sheets';
import { createWorkbookBirthFixture, birthScope as scope } from '../helpers/workbook-birth-fixture';
import { captureWorkbookSavedBirthDeletion, prepareWorkbookSheetBirth, blankWorkbookSheet } from '../../src/components/embedded/workbook/sheet-birth-context';
import { workbookSheetActionDescriptorSchema } from '../../src/components/embedded/workbook/sheet-action-descriptor';
import { workbookSourceDeletionTemplate } from '../../src/components/embedded/workbook/sheet-delete-context';
import { workbookGridPlan } from '../../src/components/embedded/workbook/grid-plan';
import { checkedWorkbookSaveAcknowledgement } from '../../src/components/embedded/workbook/save-provenance';
import type { WorkbookCheckpoint } from '../../src/components/embedded/workbook/workbook-writer';
const closers: (() => void)[] = [];
afterEach(() => closers.splice(0).reverse().forEach(close => close()));

async function pendingBirth() {
  const f = createWorkbookBirthFixture(); closers.push(() => f.univer.dispose());
  const prepared = prepareWorkbookSheetBirth(scope, f.checkpoint, 'Born worksheet', 1);
  f.commands.syncExecuteCommand(InsertSheetCommand.id, { unitId: f.book.getId(), index: 1, sheet: structuredClone(prepared.entry.initialSheet) });
  f.book.getSheetBySheetId('2')!.getRange('A1').setValue(17);
  const snapshot = f.book.save();
  const intent = { id: crypto.randomUUID(), preparationId: crypto.randomUUID(), previewId: crypto.randomUUID(), renderId: crypto.randomUUID(),
    plan: workbookGridPlan(f.source.model, f.source.sourceSha256, f.checkpoint.acknowledged, snapshot, { births: prepared.state }) };
  const target = structuredClone(f.source); target.sourceSha256 = 'b'.repeat(64);
  const sheet = blankWorkbookSheet('2', 'Born worksheet'); sheet.cells.push({ row: 0, column: 0, kind: 'number', value: 17 });
  target.model.sheets.push(sheet);
  const acknowledgement = checkedWorkbookSaveAcknowledgement({ id: intent.id, projectId: scope.projectId, fileName: scope.fileName,
    renderId: intent.renderId, state: 'applied', sourceSha256: f.source.sourceSha256, targetSha256: target.sourceSha256,
    actualSha256: target.sourceSha256, sourceVersionId: 'source-without-birth', versionId: 'saved-target-with-birth' },
  { ...intent, operationId: intent.id, projectId: scope.projectId, fileName: scope.fileName }, target.sourceSha256);
  await f.api.undo(); await f.api.undo();
  const before: WorkbookCheckpoint = { ...f.checkpoint, desired: f.book.save(), sheetBirths: prepared.state, pending: { intent, snapshot } };
  const removal = workbookSheetActionDescriptorSchema.parse({ ...prepared.entry.descriptor, token: crypto.randomUUID() });
  return { f, before, target, acknowledgement, removal };
}

it('captures actual saved-target baseline and frozen ACK even when current desired already removed the birth', async () => {
  const p = await pendingBirth();
  expect(p.before.desired.sheets['2']).toBeUndefined();
  expect(p.before.source.model.sheets.some(sheet => sheet.id === '2')).toBe(false);
  const context = captureWorkbookSavedBirthDeletion(scope, p.before, p.target, p.acknowledgement, p.removal);
  expect(context.descriptor).toEqual(p.removal);
  expect(context.baseline.sheet.cells[0]?.value).toBe(17);
  expect(context.acknowledgedSheet.cellData?.['0']?.['0']?.v).toBe(17);
  expect(context.sourceSha256).toBe(p.target.sourceSha256);
  expect(context.templateSide).toBe('saved-target');
  expect(workbookSourceDeletionTemplate(context)).toEqual({ versionId: 'saved-target-with-birth', versionSha256: p.target.sourceSha256 });
  expect(p.before.pending?.snapshot.sheets['2']?.cellData?.[0]?.[0]?.v).toBe(17);
  expect(p.before.desired.sheets['2']).toBeUndefined();
});

it('refuses changed receipt scope, operation, frozen target inputs and unprotected birth data', async () => {
  const p = await pendingBirth();
  if (p.acknowledgement.kind !== 'history') throw Error('History fixture required');
  const receipt = p.acknowledgement;
  for (const change of [{ operationId: crypto.randomUUID() }, { renderId: crypto.randomUUID() },
    { sourceSha256: 'c'.repeat(64) }, { targetSha256: 'c'.repeat(64) }, { projectId: crypto.randomUUID() }, { fileName: 'Other.xlsx' }]) {
    expect(() => captureWorkbookSavedBirthDeletion(scope, p.before, p.target, { kind: 'history', provenance: { ...receipt.provenance, ...change } }, p.removal)).toThrow();
  }
  const changedSnapshot = structuredClone(p.before);
  changedSnapshot.pending!.snapshot.sheets['2']!.cellData![0]![0]!.v = 999;
  expect(() => captureWorkbookSavedBirthDeletion(scope, changedSnapshot, p.target, receipt, p.removal)).toThrow('source inputs differ');
  const missing = structuredClone(p.before); delete missing.sheetBirths;
  expect(() => captureWorkbookSavedBirthDeletion(scope, missing, p.target, receipt, p.removal)).toThrow('protected birth state');
  const protectedReceipt = structuredClone(p.before); protectedReceipt.pending!.acknowledgement = receipt;
  expect(() => captureWorkbookSavedBirthDeletion(scope, protectedReceipt, p.target,
    { kind: 'history', provenance: { ...receipt.provenance, versionId: 'changed-history-version' } }, p.removal)).toThrow('receipt changed');
  expect(() => captureWorkbookSavedBirthDeletion(scope, p.before, p.target, receipt,
    { ...p.removal, token: p.before.sheetBirths!.entries[0]!.descriptor.token })).toThrow('removal descriptor changed');
});
