import { IUniverInstanceService, UniverInstanceType, UndoCommand, type IWorkbookData, type Workbook } from '@univerjs/core';
import { InsertSheetCommand, RemoveSheetCommand } from '@univerjs/sheets';
import { canonicalWorkbookJsonValue } from '@open-design/contracts/runtime/workbook-sheet-baseline';
import { createWorkbookBirthFixture, birthScope as scope } from './workbook-birth-fixture';
import { WorkbookWriter, type WorkbookCheckpoint, type WorkbookWriteIntent, type WorkbookWriteResult } from '../../src/components/embedded/workbook/workbook-writer';
import { WorkbookSheetMutationOwner } from '../../src/components/embedded/workbook/sheet-mutation-owner';
import { captureWorkbookSourceDeletion, stampWorkbookSourceDeletion } from '../../src/components/embedded/workbook/sheet-delete-context';
import { serializeWorkbookDraft } from '../../src/components/embedded/workbook/draft-store';
import type { WorkbookSheetBirthEntry } from '../../src/components/embedded/workbook/sheet-birth-context';
import { workbookSheetMutationSnapshot } from '../../src/components/embedded/workbook/sheet-removal-selection';
import type { WorkbookDocument } from '@open-design/contracts/runtime/workbook';
import type { WorkbookBirthRemoval } from '../../src/components/embedded/workbook/sheet-birth-removal-schema';

export interface RemovedBirthFixture { removal: WorkbookBirthRemoval; nativeSheet: IWorkbookData['sheets'][string]; index: number }
export function createBirthRemovalHarness(options: {
  write: (intent: WorkbookWriteIntent, checkpoint: () => Promise<void>, initial: WorkbookCheckpoint['source']) => Promise<WorkbookWriteResult>;
  save?: (state: WorkbookCheckpoint | null) => Promise<void>;
  afterSave?: (state: WorkbookCheckpoint | null) => void;
  current?: () => boolean;
  additionalSheets?: WorkbookDocument['sheets'];
}) {
  const f = createWorkbookBirthFixture('1', 100, options.additionalSheets ?? []);
  const records: Array<WorkbookCheckpoint | null> = [];
  const durable: { value: WorkbookCheckpoint | null } = { value: null };
  const issued = new Map<string, string>();
  const writer = new WorkbookWriter(f.source, f.book.save(), (intent, checkpoint) => options.write(intent, checkpoint, f.source), () => {}, undefined, {
    scope, isCurrent: options.current ?? (() => true), validate: value => { serializeWorkbookDraft(scope, value); },
    save: async value => {
      if (value) serializeWorkbookDraft(scope, value);
      await options.save?.(value);
      durable.value = value ? structuredClone(value) : null;
      records.push(durable.value);
      options.afterSave?.(durable.value);
    },
  });
  const owner = new WorkbookSheetMutationOwner(f.univer, f.book.getId(), {
    isCurrent: options.current ?? (() => true), snapshot: () => f.book.save(), owns: descriptor => {
      if (issued.get(descriptor.token) !== canonicalWorkbookJsonValue(descriptor)) return false;
      const state = writer.checkpoint();
      return [...(state.sheetBirths?.entries.map(value => value.descriptor) ?? []),
        ...(state.sheetBirths?.removals?.map(value => value.descriptor) ?? []),
        ...(state.sheetDeletions?.map(value => value.descriptor) ?? [])].some(value => canonicalWorkbookJsonValue(value) === canonicalWorkbookJsonValue(descriptor));
    },
  });
  const unit = f.univer.__getInjector().get(IUniverInstanceService).getUnit<Workbook>(f.book.getId(), UniverInstanceType.UNIVER_SHEET)!;
  return { ...f, writer, owner, records, durable,
    edit(id: string, value: number) { f.book.getSheetBySheetId(id)!.getRange('A1').setValue(value); writer.update(f.book.save()); },
    async add(name = 'Second') {
      return writer.protectSheetBirth(name, f.book.save().sheetOrder.length, birth => {
        issued.set(birth.descriptor.token, canonicalWorkbookJsonValue(birth.descriptor));
        const before = f.book.save();
        const after: IWorkbookData = { ...before, sheets: { ...before.sheets, [birth.descriptor.sheetId]: structuredClone(birth.initialSheet) }, sheetOrder: [...before.sheetOrder, birth.descriptor.sheetId] };
        return owner.run('insert', birth.descriptor, before, after, () => f.commands.syncExecuteCommand(InsertSheetCommand.id, {
          unitId: f.book.getId(), index: before.sheetOrder.length, sheet: structuredClone(birth.initialSheet),
        }));
      });
    },
    async remove(birth: WorkbookSheetBirthEntry): Promise<RemovedBirthFixture> {
      let nativeSheet: IWorkbookData['sheets'][string] | undefined;
      const removal = await writer.protectSheetBirthRemoval(birth.descriptor, value => {
        issued.set(value.descriptor.token, canonicalWorkbookJsonValue(value.descriptor));
        stampWorkbookSourceDeletion(unit.getSheetBySheetId(value.descriptor.sheetId)!, value.descriptor);
        const before = f.book.save(); nativeSheet = structuredClone(before.sheets[value.descriptor.sheetId]!);
        const after: IWorkbookData = { ...before, sheets: { ...before.sheets }, sheetOrder: before.sheetOrder.filter(id => id !== value.descriptor.sheetId) };
        delete after.sheets[value.descriptor.sheetId];
        return owner.run('remove', value.descriptor, before, after, () => f.commands.syncExecuteCommand(RemoveSheetCommand.id, {
          unitId: f.book.getId(), subUnitId: value.descriptor.sheetId,
        }));
      });
      if (!nativeSheet) throw Error('Native removal did not execute');
      return { removal, nativeSheet, index: removal.removedIndex };
    },
    async removeSource(id: string) {
      const context = captureWorkbookSourceDeletion(scope, writer.checkpoint(), id);
      const before = f.book.save(), after = structuredClone(before);
      delete after.sheets[id]; after.sheetOrder = after.sheetOrder.filter(value => value !== id);
      const prospective = workbookSheetMutationSnapshot(before, after, 'remove', context.descriptor);
      await writer.protectSheetDeletion(context, prospective, () => {
        issued.set(context.descriptor.token, canonicalWorkbookJsonValue(context.descriptor));
        stampWorkbookSourceDeletion(unit.getSheetBySheetId(id)!, context.descriptor);
        return owner.run('remove', context.descriptor, f.book.save(), prospective, () => f.commands.syncExecuteCommand(RemoveSheetCommand.id, {
          unitId: f.book.getId(), subUnitId: id,
        }));
      });
      return context;
    },
    /** Source protocol fixture only. A live controller must protect native
     * history BEFORE pop; this direct real SDK seam does not qualify that UI. */
    restore(value: RemovedBirthFixture) {
      const before = f.book.save(), id = value.removal.descriptor.sheetId;
      const after: IWorkbookData = { ...before, sheets: { ...before.sheets, [id]: structuredClone(value.nativeSheet) }, sheetOrder: [...before.sheetOrder] };
      after.sheetOrder.splice(value.index, 0, id);
      owner.run('insert', value.removal.descriptor, before, after, () => f.commands.syncExecuteCommand(UndoCommand.id));
      writer.update(f.book.save());
    },
    async close() { await writer.close(); owner.dispose(); f.univer.dispose(); },
  };
}
