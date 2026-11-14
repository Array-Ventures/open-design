import { expect, it } from 'vitest';
import { IUniverInstanceService, UniverInstanceType, UndoCommand, type Workbook } from '@univerjs/core';
import { RemoveSheetCommand } from '@univerjs/sheets';
import { createWorkbookBirthFixture, birthScope as scope } from '../helpers/workbook-birth-fixture';
import { standInWorkbookResult } from '../helpers/workbook-birth-transport';
import { blankWorkbookSheet } from '../../src/components/embedded/workbook/sheet-birth-context';
import { captureWorkbookSourceDeletion, stampWorkbookSourceDeletion } from '../../src/components/embedded/workbook/sheet-delete-context';
import { WorkbookSheetMutationOwner } from '../../src/components/embedded/workbook/sheet-mutation-owner';
import { workbookSheetMutationSnapshot, WORKBOOK_SHEET_REMOVALS } from '../../src/components/embedded/workbook/sheet-removal-selection';
import { WorkbookWriter } from '../../src/components/embedded/workbook/workbook-writer';
import { serializeWorkbookDraft } from '../../src/components/embedded/workbook/draft-store';
import { workbookGridPlan } from '../../src/components/embedded/workbook/grid-plan';
import type { IWorkbookData } from '@univerjs/core';

function gate() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
function removed(before: IWorkbookData) {
  const after = structuredClone(before); delete after.sheets['2']; after.sheetOrder = ['1']; return after;
}

it('keeps both retained removals while a frozen pending selection and the current same-ID selection differ', async () => {
  const f = createWorkbookBirthFixture('1', 100, [blankWorkbookSheet('2', 'Second')]);
  const transport = gate(), started = gate();
  const target = structuredClone(f.source); target.sourceSha256 = 'b'.repeat(64); target.model.sheets = target.model.sheets.filter(sheet => sheet.id !== '2');
  let writes = 0;
  const writer = new WorkbookWriter(f.source, f.book.save(), async intent => {
    writes++; started.resolve(); await transport.promise;
    return standInWorkbookResult(scope, intent, target, 'before-delete', 'after-delete');
  }, () => {}, undefined, { scope, isCurrent: () => true,
    validate: value => { serializeWorkbookDraft(scope, value); },
    save: async value => { if (value) serializeWorkbookDraft(scope, value); },
  });
  const issued = new Set<string>();
  const owner = new WorkbookSheetMutationOwner(f.univer, f.book.getId(), {
    snapshot: () => f.book.save(), isCurrent: () => true,
    owns: value => issued.has(value.token) && Boolean(writer.checkpoint().sheetDeletions?.some(context => context.descriptor.token === value.token)),
  });
  const unit = f.univer.__getInjector().get(IUniverInstanceService).getUnit<Workbook>(f.book.getId(), UniverInstanceType.UNIVER_SHEET)!;
  let saving: Promise<void> | undefined;
  try {
    const first = captureWorkbookSourceDeletion(scope, writer.checkpoint(), '2'); issued.add(first.descriptor.token);
    stampWorkbookSourceDeletion(unit.getSheetBySheetId('2')!, first.descriptor);
    const beforeFirst = f.book.save(); writer.update(beforeFirst);
    await writer.protectSheetDeletion(first, workbookSheetMutationSnapshot(beforeFirst, removed(beforeFirst), 'remove', first.descriptor),
      () => owner.run('remove', first.descriptor, beforeFirst, removed(beforeFirst),
        () => f.commands.syncExecuteCommand(RemoveSheetCommand.id, { unitId: f.book.getId(), subUnitId: '2' })));
    saving = writer.flush(); await started.promise;
    const frozen = structuredClone(writer.checkpoint().pending!);
    // Source-level projection fixture only: pre-pop history protection is a
    // separate still-uninstalled controller gate, not claimed by this call.
    owner.run('insert', first.descriptor, f.book.save(), beforeFirst, () => f.commands.syncExecuteCommand(UndoCommand.id));
    writer.update(f.book.save());
    const second = captureWorkbookSourceDeletion(scope, writer.checkpoint(), '2'); issued.add(second.descriptor.token);
    stampWorkbookSourceDeletion(unit.getSheetBySheetId('2')!, second.descriptor);
    const beforeSecond = f.book.save(); writer.update(beforeSecond);
    await writer.protectSheetDeletion(second, workbookSheetMutationSnapshot(beforeSecond, removed(beforeSecond), 'remove', second.descriptor),
      () => owner.run('remove', second.descriptor, beforeSecond, removed(beforeSecond),
        () => f.commands.syncExecuteCommand(RemoveSheetCommand.id, { unitId: f.book.getId(), subUnitId: '2' })));
    expect(writer.checkpoint().pending).toEqual(frozen);
    expect(writer.checkpoint().sheetDeletions?.map(value => value.descriptor.token)).toEqual([first.descriptor.token, second.descriptor.token]);
    serializeWorkbookDraft(scope, writer.checkpoint());
    transport.resolve(); await saving;
    expect(writes).toBe(1);
    expect(writer.state()).toEqual({ dirty: false, saving: false, error: null });
  } finally { transport.resolve(); await saving; await writer.close(); owner.dispose(); f.univer.dispose(); }
});


it('rejects unknown selection references, foreign scopes/generations and changed source association without relaxing legacy ambiguity', () => {
  const f = createWorkbookBirthFixture('1', 100, [blankWorkbookSheet('2', 'Second')]);
  try {
    const first = captureWorkbookSourceDeletion(scope, f.checkpoint, '2');
    const second = captureWorkbookSourceDeletion(scope, f.checkpoint, '2');
    const initial = f.book.save();
    const current = workbookSheetMutationSnapshot(initial, removed(initial), 'remove', second.descriptor);
    const plan = (snapshot: IWorkbookData, contexts = [first, second], currentScope: typeof scope | undefined = scope) =>
      workbookGridPlan(f.source.model, f.source.sourceSha256, initial, snapshot, { scope: currentScope, deletions: contexts });
    expect(plan(current).sheets).toEqual([{ sheetId: '1', name: 'Existing', origin: 'source' }]);
    expect(() => workbookGridPlan(f.source.model, f.source.sourceSha256, initial, current, { deletions: [first, second] })).toThrow('current scope');
    for (const mutate of [
      (copy: IWorkbookData) => { copy.custom![WORKBOOK_SHEET_REMOVALS].entries['2'] = crypto.randomUUID(); },
      (copy: IWorkbookData) => { copy.custom![WORKBOOK_SHEET_REMOVALS].entries['3'] = crypto.randomUUID(); },
      (copy: IWorkbookData) => { copy.custom![WORKBOOK_SHEET_REMOVALS].generation = crypto.randomUUID(); },
    ]) {
      const copy = structuredClone(current); mutate(copy);
      expect(() => plan(copy)).toThrow();
    }
    const foreign = structuredClone(second); foreign.scope.viewerId = 'different-person';
    expect(() => plan(current, [first, foreign])).toThrow('scope');
    const changedSource = structuredClone(second); changedSource.sourceSha256 = 'c'.repeat(64);
    expect(() => plan(current, [first, changedSource])).toThrow('current-source context');
    const legacy = structuredClone(current); delete legacy.custom![WORKBOOK_SHEET_REMOVALS];
    expect(() => plan(legacy)).toThrow('unique current-source context');
    expect(plan(legacy, [first]).sheets).toHaveLength(1);
    const clean = structuredClone(initial);
    clean.custom![WORKBOOK_SHEET_REMOVALS] = { version: 1, generation: first.descriptor.generation, entries: { '3': first.descriptor.token } };
    expect(() => plan(clean)).toThrow('retained context');
    expect(() => serializeWorkbookDraft(scope, { ...f.checkpoint, desired: clean, sheetDeletions: [first] })).toThrow('retained context');
  } finally { f.univer.dispose(); }
});
