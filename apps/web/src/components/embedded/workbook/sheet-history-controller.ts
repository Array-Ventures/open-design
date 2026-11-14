import { assertNativeWorkbookBirthHistory } from './native-birth-history';
import { ICommandService, IUndoRedoService, IUniverInstanceService, RedoCommand, UndoCommand, UniverInstanceType, type ICommand, type IWorkbookData, type Univer, type Workbook } from '@univerjs/core';
import { InsertSheetCommand, InsertSheetMutation, RemoveSheetMutation } from '@univerjs/sheets';
import { canonicalWorkbookJsonValue } from '@open-design/contracts/runtime/workbook-sheet-baseline';
import type { WorkbookWriter } from './workbook-writer';
import type { WorkbookDraftScope } from './workbook-draft-schema';
import type { WorkbookSheetActionDescriptor } from './sheet-action-descriptor';
import { WORKBOOK_SHEET_BIRTH_MARKER, type WorkbookSheetBirthEntry } from './sheet-birth-context';
import { captureWorkbookSourceDeletion, WORKBOOK_SHEET_DELETE_MARKER } from './sheet-delete-context';
import { WorkbookSheetMutationOwner } from './sheet-mutation-owner';
import { workbookSheetMutationSnapshot } from './sheet-removal-selection';

type Direction = 'undo' | 'redo';
interface IssuedBirth { entry: WorkbookSheetBirthEntry; index: number; nativeEntryId: number }
interface BirthAction { birth: IssuedBirth; direction: Direction; checkpoint: ReturnType<IUndoRedoService['getUndoRedoCheckpoint']> }

/** Uninstalled native-history producer. Imported/recovered descriptors are not
 * issuance. Historical Delete Undo and compound membership remain refused until
 * their independently authorized template/projection consumers are connected. */
export class WorkbookSheetHistoryController {
  private readonly commands;
  private readonly history;
  private readonly instances;
  private readonly unit: Workbook;
  private readonly mutation: WorkbookSheetMutationOwner;
  private readonly handles: ReturnType<ICommandService['replaceCommand']>[] = [];
  private readonly issued = new Map<string, WorkbookSheetActionDescriptor>();
  private readonly births = new Map<string, IssuedBirth>();
  private busy = false;
  private disposed = false;

  constructor(univer: Univer, private readonly writer: WorkbookWriter, private readonly scope: WorkbookDraftScope,
    private readonly snapshot: () => IWorkbookData, private readonly current: () => boolean) {
    const injector = univer.__getInjector();
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
            const action = this.action(direction);
            if (!action) return native.handler(accessor, params, options);
            return this.protect(action, () => native.handler(accessor, params, options) === true);
          },
          syncHandler: (accessor, params, options) => {
            if (this.action(direction)) throw Error('Protected worksheet history requires asynchronous dispatch.');
            return native.handler(accessor, params, options);
          },
        }));
      }
      const add: ICommand = InsertSheetCommand;
      this.handles.push(this.commands.replaceCommand(InsertSheetCommand, {
        id: add.id, type: add.type,
        handler: (accessor, params, options) => add.handler(accessor, params, options),
      }));
    } catch (error) { this.dispose(); throw error; }
  }

  isCurrent(): boolean {
    return !this.disposed && this.current() && this.handles.length === 3 && this.handles.every(handle => handle.isCurrent())
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
    const select = (mutation: string, path: readonly string[]) => this.history.getUndoRedoMutationStrings(checkpoint.unitId, mutation, path, 'top')[direction === 'undo' ? 'undos' : 'redos'];
    const inserted = select(InsertSheetMutation.id, ['sheet','id']);
    const removed = select(RemoveSheetMutation.id, ['subUnitId']);
    if (!inserted.length && !removed.length) return null;
    if (inserted.length !== 1 || removed.length !== 1 || inserted[0] !== removed[0]) throw Error('Compound or unknown worksheet history is not ready.');
    if (select(InsertSheetMutation.id, ['sheet','custom',WORKBOOK_SHEET_DELETE_MARKER,'token']).length) throw Error('Historical worksheet restoration is not ready.');
    const tokens = select(InsertSheetMutation.id, ['sheet','custom',WORKBOOK_SHEET_BIRTH_MARKER,'token']);
    const birth = tokens.length === 1 ? this.births.get(tokens[0]!) : undefined;
    if (!birth || birth.entry.descriptor.sheetId !== inserted[0] || !this.owns(birth.entry.descriptor)) throw Error('The worksheet history has no live birth issuer.');
    if (checkpoint[direction === 'undo' ? 'undoEntryId' : 'redoEntryId'] !== birth.nativeEntryId) throw Error('The worksheet history native entry has no live issuer.');
    if (!this.isCurrent() || this.busy) throw Error('The worksheet history owner is not current.');
    const present = Boolean(this.snapshot().sheets[birth.entry.descriptor.sheetId]);
    if (present !== (direction === 'undo')) throw Error('The worksheet birth history direction changed.');
    assertNativeWorkbookBirthHistory(this.history.getUndoRedoMutationData(checkpoint.unitId, direction, birth.nativeEntryId), checkpoint.unitId, birth.entry, birth.index);
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
