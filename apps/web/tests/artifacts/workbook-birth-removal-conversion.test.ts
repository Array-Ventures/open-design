import { afterEach, expect, it } from 'vitest';
import { IUniverInstanceService, UniverInstanceType, type Workbook } from '@univerjs/core';
import { InsertSheetCommand, RemoveSheetCommand } from '@univerjs/sheets';
import { createWorkbookBirthFixture, birthScope as scope } from '../helpers/workbook-birth-fixture';
import { standInWorkbookResult } from '../helpers/workbook-birth-transport';
import { blankWorkbookSheet } from '../../src/components/embedded/workbook/sheet-birth-context';
import { stampWorkbookSourceDeletion } from '../../src/components/embedded/workbook/sheet-delete-context';
import { WorkbookSheetMutationOwner } from '../../src/components/embedded/workbook/sheet-mutation-owner';
import { WorkbookWriter, type WorkbookCheckpoint } from '../../src/components/embedded/workbook/workbook-writer';
import { serializeWorkbookDraft } from '../../src/components/embedded/workbook/draft-store';

function gate() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
const close: (() => void)[] = [];
afterEach(() => close.splice(0).reverse().forEach(dispose => dispose()));

it('converts actual pending17 to its checked target baseline while retaining removed desired19 and the immutable blank birth', async () => {
  const f = createWorkbookBirthFixture(); close.push(() => f.univer.dispose());
  const started = gate(), release = gate();
  const target = structuredClone(f.source); target.sourceSha256 = 'b'.repeat(64);
  const second = blankWorkbookSheet('2', 'Second'); second.cells.push({ row: 0, column: 0, kind: 'number', value: 17 }); target.model.sheets.push(second);
  const deleted = structuredClone(f.source); deleted.sourceSha256 = 'c'.repeat(64);
  const stored: WorkbookCheckpoint[] = [], operations: string[] = [];
  const writer = new WorkbookWriter(f.source, f.book.save(), async (intent, checkpoint) => {
    operations.push(intent.id); intent.renderId ??= crypto.randomUUID(); await checkpoint();
    if (operations.length === 1) { started.resolve(); await release.promise; return standInWorkbookResult(scope, intent, target, 'source-without-birth', 'target-with-birth'); }
    expect(intent.plan.sourceSha256).toBe(target.sourceSha256);
    expect(intent.plan.sheets).toEqual([{ sheetId: '1', name: 'Existing', origin: 'source' }]);
    return standInWorkbookResult(scope, intent, deleted, 'target-with-birth', 'target-after-delete');
  }, () => {}, undefined, { scope, isCurrent: () => true,
    validate: value => { serializeWorkbookDraft(scope, value); },
    save: async value => { if (value) { serializeWorkbookDraft(scope, value); stored.push(structuredClone(value)); } },
  });
  let saving: Promise<void> | undefined;
  let owner: WorkbookSheetMutationOwner | undefined;
  try {
    const birth = await writer.protectSheetBirth('Second', 1, value => {
      expect(f.commands.syncExecuteCommand(InsertSheetCommand.id, { unitId: f.book.getId(), index: 1, sheet: structuredClone(value.initialSheet) })).toBe(true);
      return f.book.save();
    });
    f.book.getSheetBySheetId('2')!.getRange('A1').setValue(17); writer.update(f.book.save());
    saving = writer.flush(); await started.promise;
    const original = structuredClone(writer.checkpoint().pending!);
    f.book.getSheetBySheetId('2')!.getRange('A1').setValue(19); writer.update(f.book.save());
    const issued = new Set<string>();
    owner = new WorkbookSheetMutationOwner(f.univer, f.book.getId(), {
      isCurrent: () => true, snapshot: () => f.book.save(), owns: value => issued.has(value.token),
    });
    const unit = f.univer.__getInjector().get(IUniverInstanceService).getUnit<Workbook>(f.book.getId(), UniverInstanceType.UNIVER_SHEET)!;
    const removal = await writer.protectSheetBirthRemoval(birth.descriptor, value => {
      expect(stored.at(-1)?.sheetBirths?.removals).toEqual([value]);
      expect(stored.at(-1)?.pending).toEqual(original);
      issued.add(value.descriptor.token);
      stampWorkbookSourceDeletion(unit.getSheetBySheetId('2')!, value.descriptor);
      const before = f.book.save(), after = { ...before, sheets: { ...before.sheets }, sheetOrder: ['1'] };
      delete after.sheets['2'];
      return owner!.run('remove', value.descriptor, before, after,
        () => f.commands.syncExecuteCommand(RemoveSheetCommand.id, { unitId: f.book.getId(), subUnitId: '2' }));
    });
    expect(removal).toMatchObject({ kind: 'pending-target', captureSourceSha256: f.source.sourceSha256,
      creation: { operationId: original.intent.id, sourceSha256: f.source.sourceSha256 }, removedIndex: 1 });
    expect(removal.removedSheet.cellData?.[0]?.[0]?.v).toBe(19);
    expect(writer.checkpoint().pending).toEqual(original);
    expect(writer.checkpoint().sheetDeletions).toBeUndefined(); // No invented target baseline.
    release.resolve(); await saving;
    expect(operations).toHaveLength(2);
    const context = writer.checkpoint().sheetDeletions![0]!;
    expect(context).toMatchObject({ descriptor: removal.descriptor, sourceSha256: target.sourceSha256, templateSide: 'saved-target',
      receiptAssociation: { sourceVersionId: 'source-without-birth', versionId: 'target-with-birth' },
      birthOrigin: { birthToken: birth.descriptor.token, captureSourceSha256: f.source.sourceSha256, creation: removal.kind === 'pending-target' ? removal.creation : undefined } });
    expect(context.baseline.sheet.cells[0]?.value).toBe(17);
    expect(context.acknowledgedSheet.cellData?.[0]?.[0]?.v).toBe(17);
    expect(context.removedSheet?.cellData?.[0]?.[0]?.v).toBe(19);
    expect(writer.checkpoint().sheetBirths?.removals).toBeUndefined();
    expect(writer.checkpoint().sheetBirths?.entries[0]?.initialSheet.cellData).toEqual({});
    expect(stored.some(value => value.source.sourceSha256 === f.source.sourceSha256 && value.pending?.acknowledgement?.kind === 'history'
      && value.sheetDeletions?.[0]?.sourceSha256 === target.sourceSha256)).toBe(true);
    expect(writer.state()).toEqual({ dirty: false, saving: false, error: null });
  } finally { release.resolve(); await saving; owner?.dispose(); await writer.close(); }
});
