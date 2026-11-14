import { assertNativeWorkbookBirthHistory } from './native-birth-history';
import { ICommandService, IUndoRedoService, IUniverInstanceService, RedoCommand, UndoCommand, UniverInstanceType, type ICommand, type IWorkbookData, type Univer, type Workbook } from '@univerjs/core';
import { getSheetCommandTarget, InsertSheetCommand, InsertSheetMutation, RemoveSheetCommand, RemoveSheetMutation, RemoveSheetUndoMutationFactory, SheetInterceptorService } from '@univerjs/sheets';
import { canonicalWorkbookJsonValue } from '@open-design/contracts/runtime/workbook-sheet-baseline';
import type { WorkbookWriter } from './workbook-writer';
import type { WorkbookDraftScope } from './workbook-draft-schema';
import type { WorkbookSheetActionDescriptor } from './sheet-action-descriptor';
import { WORKBOOK_SHEET_BIRTH_MARKER, type WorkbookSheetBirthEntry } from './sheet-birth-context';
import { captureWorkbookSourceDeletion, WORKBOOK_SHEET_DELETE_MARKER } from './sheet-delete-context';
import { WorkbookSheetMutationOwner } from './sheet-mutation-owner';
import { workbookSheetMutationSnapshot } from './sheet-removal-selection';
import { nativeDeletePayloadIdentity, projectNativeSheetDelete, type NativeDeletePayload, type NativeSheetMutation } from './native-delete-history';
import type { WorkbookSourceDeleteContext } from './sheet-delete-context';

type Direction = 'undo' | 'redo';
interface IssuedBirth { entry: WorkbookSheetBirthEntry; index: number; nativeEntryId: number }
interface BirthAction { birth: IssuedBirth; direction: Direction; checkpoint: ReturnType<IUndoRedoService['getUndoRedoCheckpoint']> }
interface IssuedDelete { context: WorkbookSourceDeleteContext; nativeEntryId: number; payload: NativeDeletePayload }
interface DeleteAction { deletion: IssuedDelete; direction: Direction; checkpoint: ReturnType<IUndoRedoService['getUndoRedoCheckpoint']> }

/** Uninstalled native-history producer. Imported/recovered descriptors are not
 * issuance. Source Delete uses only the exact privately issued native item and
 * the existing independently authorized template/projection consumers. */
export class WorkbookSheetHistoryController {
  private readonly commands;
  private readonly history;
  private readonly instances;
  private readonly unit: Workbook;
  private readonly mutation: WorkbookSheetMutationOwner;
  private readonly handles: ReturnType<ICommandService['replaceCommand']>[] = [];
  private readonly issued = new Map<string, WorkbookSheetActionDescriptor>();
  private readonly births = new Map<string, IssuedBirth>();
  private readonly deletions = new Map<string, IssuedDelete>();
  private readonly injector;
  private busy = false;
  private disposed = false;

  constructor(univer: Univer, private readonly writer: WorkbookWriter, private readonly scope: WorkbookDraftScope,
    private readonly snapshot: () => IWorkbookData, private readonly current: () => boolean) {
    const injector = univer.__getInjector();
    this.injector = injector;
    this.commands = injector.get(ICommandService);
    this.history = injector.get(IUndoRedoService);
    this.instances = injector.get(IUniverInstanceService);
    const unit = this.instances.getUnit<Workbook>(`${scope.projectId}:${scope.fileName}`, UniverInstanceType.UNIVER_SHEET);
    if (!unit) throw Error('The worksheet history kernel is unavailable.');
    this.unit = unit;
    this.mutation = new WorkbookSheetMutationOwner(univer, unit.getUnitId(), {
      isCurrent: () => this.isCurrent(), snapshot, owns: descriptor => this.owns(descriptor),
    });
    try {
      for (const [direction, original] of [['undo', UndoCommand], ['redo', RedoCommand]] as const) {
        const native: ICommand = original;
        this.handles.push(this.commands.replaceCommand(original, {
          id: original.id, type: original.type,
          handler: (accessor, params, options) => {
            const deletion = this.deleteAction(direction);
            if (deletion) return this.replayDelete(deletion, () => native.handler(accessor, params, options) === true);
            const action = this.action(direction);
            if (!action) return native.handler(accessor, params, options);
            return this.protect(action, () => native.handler(accessor, params, options) === true);
          },
          syncHandler: (accessor, params, options) => {
            if (this.deleteAction(direction) || this.action(direction)) throw Error('Protected worksheet history requires asynchronous dispatch.');
            return native.handler(accessor, params, options);
          },
        }));
      }
      const add: ICommand = InsertSheetCommand;
      this.handles.push(this.commands.replaceCommand(InsertSheetCommand, {
        id: add.id, type: add.type,
        handler: (accessor, params, options) => add.handler(accessor, params, options),
      }));
      const remove: ICommand = RemoveSheetCommand;
      this.handles.push(this.commands.replaceCommand(RemoveSheetCommand, {
        id: RemoveSheetCommand.id, type: RemoveSheetCommand.type,
        handler: (accessor, params, options) => {
          const input = params as { unitId?: string; subUnitId?: string } | undefined;
          const target = getSheetCommandTarget(this.instances, input);
          if (target && target.workbook !== this.unit) return remove.handler(accessor, params, options);
          if (!input || Object.keys(input).some(key => !['unitId', 'subUnitId'].includes(key))
            || input.unitId !== this.unit.getUnitId() || typeof input.subUnitId !== 'string') throw Error('The source Delete target is invalid.');
          return this.performRemove(input.subUnitId).then(() => true);
        },
        syncHandler: (accessor, params, options) => {
          const target = getSheetCommandTarget(this.instances, params as { unitId?: string; subUnitId?: string } | undefined);
          if (target && target.workbook !== this.unit) return remove.handler(accessor, params, options);
          throw Error('Protected worksheet Delete requires asynchronous dispatch.');
        },
      }));
    } catch (error) { this.dispose(); throw error; }
  }

  isCurrent(): boolean {
    return !this.disposed && this.current() && this.handles.length === 4 && this.handles.every(handle => handle.isCurrent())
      && this.instances.getFocusedUnit() === this.unit
      && this.instances.getUnit(this.unit.getUnitId(), UniverInstanceType.UNIVER_SHEET) === this.unit;
  }
  private owns(descriptor: WorkbookSheetActionDescriptor): boolean {
    const owned = this.issued.get(descriptor.token);
    if (!owned || canonicalWorkbookJsonValue(owned) !== canonicalWorkbookJsonValue(descriptor)) return false;
    const state = this.writer.checkpoint();
    return [...(state.sheetBirths?.entries.map(value => value.descriptor) ?? []),
      ...(state.sheetBirths?.removals?.map(value => value.descriptor) ?? []),
      ...(state.sheetDeletions?.map(value => value.descriptor) ?? [])]
      .some(value => canonicalWorkbookJsonValue(value) === canonicalWorkbookJsonValue(descriptor));
  }
  private issue(descriptor: WorkbookSheetActionDescriptor): void {
    this.issued.set(descriptor.token, structuredClone(descriptor));
  }

  async remove(sheetId: string): Promise<void> {
    if (await this.commands.executeCommand(RemoveSheetCommand.id, { unitId: this.unit.getUnitId(), subUnitId: sheetId }) !== true) throw Error('The source Delete was refused.');
  }

  private async performRemove(sheetId: string): Promise<void> {
    if (this.busy || !this.isCurrent()) throw Error('The worksheet action owner is not current.');
    this.busy = true;
    try {
      const before = this.snapshot();
      const writerState = this.writer.checkpoint();
      if (canonicalWorkbookJsonValue(writerState.desired) !== canonicalWorkbookJsonValue(before)) throw Error('The worksheet writer snapshot is not current.');
      if (!before.sheets[sheetId] || before.sheets[sheetId]!.hidden === 2
        || before.sheetOrder.filter(id => !before.sheets[id]!.hidden).length <= 1 && !before.sheets[sheetId]!.hidden) throw Error('Keep at least one worksheet visible.');
      const context = captureWorkbookSourceDeletion(this.scope, writerState, sheetId);
      const insert = this.injector.invoke(accessor => RemoveSheetUndoMutationFactory(accessor, { unitId: before.id, subUnitId: sheetId, subUnitName: before.sheets[sheetId]!.name! }));
      if (insert.index !== context.removedIndex || canonicalWorkbookJsonValue(insert.sheet) !== canonicalWorkbookJsonValue(context.removedSheet)) throw Error('The native Delete factory changed its removed configuration.');
      const sheet = structuredClone(insert.sheet);
      sheet.custom = { ...sheet.custom, [WORKBOOK_SHEET_DELETE_MARKER]: structuredClone(context.descriptor) };
      const dependencies = this.injector.get(SheetInterceptorService).onCommandExecute({ id: RemoveSheetCommand.id, params: { unitId: before.id, subUnitId: sheetId } });
      const payload: NativeDeletePayload = structuredClone({
        undoMutations: [...(dependencies.preUndos ?? []), { id: InsertSheetMutation.id, params: { ...insert, sheet } }, ...dependencies.undos],
        redoMutations: [...(dependencies.preRedos ?? []), { id: RemoveSheetMutation.id, params: { unitId: before.id, subUnitId: sheetId, subUnitName: sheet.name } }, ...dependencies.redos],
      });
      nativeDeletePayloadIdentity(payload);
      const stamped = structuredClone(before);
      stamped.sheets[sheetId] = sheet;
      const projection = projectNativeSheetDelete(stamped, context.descriptor, payload.redoMutations);
      // Validate the native inverse before storing or entering a callback.
      projectNativeSheetDelete(projection.snapshot, context.descriptor, payload.undoMutations);
      const checkpoint = this.history.getUndoRedoCheckpoint();
      const verify = () => {
        if (!this.isCurrent() || canonicalWorkbookJsonValue(this.snapshot()) !== canonicalWorkbookJsonValue(before)
          || canonicalWorkbookJsonValue(this.history.getUndoRedoCheckpoint()) !== canonicalWorkbookJsonValue(checkpoint)) throw Error('The worksheet history changed while protecting its action.');
        return undefined;
      };
      await this.writer.protectSheetDeletion(context, projection.snapshot, () => {
        verify();
        this.issue(context.descriptor);
        this.unit.getSheetBySheetId(sheetId)!.setCustomMetadata(structuredClone(sheet.custom!));
        const result = this.runDeleteSequence(context.descriptor, stamped, payload.redoMutations, () => {
          for (const mutation of payload.redoMutations) if (this.commands.syncExecuteCommand(mutation.id, structuredClone(mutation.params)) !== true) return false;
          if (!this.isCurrent() || canonicalWorkbookJsonValue(this.history.getUndoRedoCheckpoint()) !== canonicalWorkbookJsonValue(checkpoint)) throw Error('The native Delete changed history before its owned push.');
          this.history.pushUndoRedo({ unitID: before.id, undoMutations: structuredClone(payload.undoMutations), redoMutations: structuredClone(payload.redoMutations) });
          return true;
        });
        const native = this.history.getUndoRedoCheckpoint();
        if (native.unitId !== before.id || native.undoEntryId === null || native.revision !== checkpoint.revision + 1) throw Error('The native Delete history entry is unavailable.');
        const issued = { context: structuredClone(context), nativeEntryId: native.undoEntryId, payload: structuredClone(payload) };
        this.assertDeletePayload(issued, this.history.getUndoRedoMutationData(before.id, 'undo', native.undoEntryId));
        this.deletions.set(context.descriptor.token, issued);
        return result;
      }, verify);
    } finally { this.busy = false; }
  }

  private assertDeletePayload(issued: IssuedDelete, data: Parameters<typeof nativeDeletePayloadIdentity>[0]): void {
    if (nativeDeletePayloadIdentity(data) !== nativeDeletePayloadIdentity(issued.payload)) throw Error('The native Delete payload changed.');
  }

  private deleteAction(direction: Direction): DeleteAction | null {
    const checkpoint = this.history.getUndoRedoCheckpoint();
    const nativeEntryId = checkpoint[direction === 'undo' ? 'undoEntryId' : 'redoEntryId'];
    if (checkpoint.unitId !== this.unit.getUnitId() || nativeEntryId === null) return null;
    const data = this.history.getUndoRedoMutationData(checkpoint.unitId, direction, nativeEntryId);
    const issued = [...this.deletions.values()].find(value => value.nativeEntryId === nativeEntryId);
    if (!issued) return null;
    if (!this.isCurrent() || this.busy || !this.owns(issued.context.descriptor)) throw Error('The native Delete issuer is not current.');
    this.assertDeletePayload(issued, data);
    if (Boolean(this.snapshot().sheets[issued.context.descriptor.sheetId]) !== (direction === 'redo')) throw Error('The native Delete direction changed.');
    return { deletion: issued, direction, checkpoint };
  }

  private async replayDelete(action: DeleteAction, execute: () => boolean): Promise<boolean> {
    this.busy = true;
    try {
      const descriptor = action.deletion.context.descriptor;
      const mutations = action.direction === 'undo' ? action.deletion.payload.undoMutations : action.deletion.payload.redoMutations;
      const before = this.snapshot();
      if (canonicalWorkbookJsonValue(this.writer.checkpoint().desired) !== canonicalWorkbookJsonValue(before)) throw Error('The worksheet writer snapshot is not current.');
      const projection = projectNativeSheetDelete(before, descriptor, mutations);
      const verify = () => {
        if (!this.isCurrent() || !this.owns(descriptor)
          || canonicalWorkbookJsonValue(this.history.getUndoRedoCheckpoint()) !== canonicalWorkbookJsonValue(action.checkpoint)) throw Error('The worksheet history changed while protecting its action.');
        this.assertDeletePayload(action.deletion, this.history.getUndoRedoMutationData(action.checkpoint.unitId, action.direction, action.deletion.nativeEntryId));
        return undefined;
      };
      await this.writer.protectSheetDeletionReplay(descriptor, projection.snapshot,
        () => {
          verify();
          return this.runDeleteSequence(descriptor, before, mutations, () => {
            if (execute() !== true) return false;
            const after = this.history.getUndoRedoCheckpoint();
            const opposite = action.direction === 'undo' ? 'redo' : 'undo';
            if (after.unitId !== action.checkpoint.unitId || after.revision !== action.checkpoint.revision + 1
              || after[opposite === 'undo' ? 'undoEntryId' : 'redoEntryId'] !== action.deletion.nativeEntryId) throw Error('The protected native Delete history transfer changed.');
            this.assertDeletePayload(action.deletion, this.history.getUndoRedoMutationData(after.unitId, opposite, action.deletion.nativeEntryId));
            return true;
          });
        }, verify);
      return true;
    } finally { this.busy = false; }
  }

  private runDeleteSequence(descriptor: WorkbookSheetActionDescriptor, before: IWorkbookData,
    mutations: readonly NativeSheetMutation[], execute: () => boolean): IWorkbookData {
    const projection = projectNativeSheetDelete(before, descriptor, mutations);
    const { kind, before: immediateBefore, after } = projection.transition;
    return this.mutation.run(kind, descriptor, immediateBefore, after, execute, projection.snapshot);
  }

  async add(name: string, index: number): Promise<WorkbookSheetBirthEntry> {
    if (this.busy || !this.isCurrent()) throw Error('The worksheet action owner is not current.');
    this.busy = true;
    try {
      return await this.writer.protectSheetBirth(name, index, entry => {
        if (!this.isCurrent()) throw Error('The worksheet action owner changed.');
        this.issue(entry.descriptor);
        const before = this.snapshot(), after = structuredClone(before);
        after.sheets[entry.descriptor.sheetId] = structuredClone(entry.initialSheet);
        after.sheetOrder.splice(index, 0, entry.descriptor.sheetId);
        const result = this.mutation.run('insert', entry.descriptor, before, after, () => this.commands.syncExecuteCommand(InsertSheetCommand.id, {
          unitId: before.id, index, sheet: structuredClone(entry.initialSheet),
        }));
        const native = this.history.getUndoRedoCheckpoint();
        if (native.unitId !== this.unit.getUnitId() || native.undoEntryId === null) throw Error('The native Add history entry is unavailable.');
        assertNativeWorkbookBirthHistory(this.history.getUndoRedoMutationData(before.id, 'undo', native.undoEntryId), before.id, entry, index);
        this.births.set(entry.descriptor.token, { entry: structuredClone(entry), index, nativeEntryId: native.undoEntryId });
        return result;
      }, () => {
        if (!this.isCurrent()) throw Error('The worksheet action owner changed.');
        return undefined;
      });
    } finally { this.busy = false; }
  }

  private action(direction: Direction): BirthAction | null {
    const checkpoint = this.history.getUndoRedoCheckpoint();
    if (checkpoint.unitId !== this.unit.getUnitId()) return null;
    const nativeEntryId = checkpoint[direction === 'undo' ? 'undoEntryId' : 'redoEntryId'];
    if (nativeEntryId === null) return null;
    const data = this.history.getUndoRedoMutationData(checkpoint.unitId, direction, nativeEntryId);
    const mutations = [...data.undoMutations, ...data.redoMutations];
    const inserted = mutations.filter(mutation => mutation.id === InsertSheetMutation.id);
    const removed = mutations.filter(mutation => mutation.id === RemoveSheetMutation.id);
    if (!inserted.length && !removed.length) return null;
    if (inserted.length !== 1 || removed.length !== 1 || data.undoMutations.length !== 1 || data.redoMutations.length !== 1) throw Error('Compound or unknown worksheet history is not ready.');
    const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
    const insertParams = inserted[0]!.params, removeParams = removed[0]!.params;
    if (!record(insertParams) || !record(removeParams) || !record(insertParams.sheet)
      || typeof insertParams.sheet.id !== 'string' || typeof removeParams.subUnitId !== 'string'
      || insertParams.sheet.id !== removeParams.subUnitId) throw Error('The worksheet history target metadata is invalid.');
    const custom = insertParams.sheet.custom;
    if (custom !== undefined && !record(custom)) throw Error('The worksheet history target metadata is invalid.');
    if (record(custom) && custom[WORKBOOK_SHEET_DELETE_MARKER] !== undefined) throw Error('Historical worksheet restoration is not ready.');
    const marker = record(custom) ? custom[WORKBOOK_SHEET_BIRTH_MARKER] : undefined;
    const birth = record(marker) && typeof marker.token === 'string' ? this.births.get(marker.token) : undefined;
    if (!birth || birth.entry.descriptor.sheetId !== insertParams.sheet.id || !this.owns(birth.entry.descriptor)) throw Error('The worksheet history has no live birth issuer.');
    if (nativeEntryId !== birth.nativeEntryId) throw Error('The worksheet history native entry has no live issuer.');
    if (!this.isCurrent() || this.busy) throw Error('The worksheet history owner is not current.');
    const present = Boolean(this.snapshot().sheets[birth.entry.descriptor.sheetId]);
    if (present !== (direction === 'undo')) throw Error('The worksheet birth history direction changed.');
    assertNativeWorkbookBirthHistory(data, checkpoint.unitId, birth.entry, birth.index);
    return { birth, direction, checkpoint };
  }

  private verify(action: BirthAction): void {
    if (!this.isCurrent() || !this.owns(action.birth.entry.descriptor)
      || canonicalWorkbookJsonValue(this.history.getUndoRedoCheckpoint()) !== canonicalWorkbookJsonValue(action.checkpoint)) throw Error('The worksheet history changed while protecting its action.');
    assertNativeWorkbookBirthHistory(this.history.getUndoRedoMutationData(action.checkpoint.unitId, action.direction, action.birth.nativeEntryId), action.checkpoint.unitId, action.birth.entry, action.birth.index);
  }
  private async protect(action: BirthAction, execute: () => boolean): Promise<boolean> {
    this.busy = true;
    try {
      const origin = action.birth.entry.descriptor;
      if (action.direction === 'redo') {
        await this.writer.protectSheetBirthReplay(origin, action.birth.index, after => {
          this.verify(action);
          return this.mutation.run('insert', origin, this.snapshot(), after, execute);
        }, () => { this.verify(action); return undefined; });
      } else {
        const state = this.writer.checkpoint();
        if (state.source.model.sheets.some(sheet => sheet.id === origin.sheetId)) {
          const context = captureWorkbookSourceDeletion(this.scope, state, origin.sheetId);
          const before = this.snapshot(), after = structuredClone(before);
          delete after.sheets[origin.sheetId]; after.sheetOrder = after.sheetOrder.filter(id => id !== origin.sheetId);
          const prospective = workbookSheetMutationSnapshot(before, after, 'remove', context.descriptor);
          await this.writer.protectSheetDeletion(context, prospective, () => {
            this.verify(action); this.issue(context.descriptor);
            return this.mutation.run('remove', context.descriptor, before, prospective, execute);
          }, () => { this.verify(action); return undefined; });
        } else {
          await this.writer.protectSheetBirthRemoval(origin, removal => {
            this.verify(action); this.issue(removal.descriptor);
            const before = this.snapshot(), after = structuredClone(before);
            delete after.sheets[origin.sheetId]; after.sheetOrder = after.sheetOrder.filter(id => id !== origin.sheetId);
            return this.mutation.run('remove', removal.descriptor, before, after, execute);
          }, () => { this.verify(action); return undefined; });
        }
      }
      return true;
    } finally { this.busy = false; }
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const handle of [...this.handles].reverse()) handle.dispose();
    this.mutation.dispose();
  }
}
