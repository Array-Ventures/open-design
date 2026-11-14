import type { WorkbookNativeRoot } from './sheet-root-retirement';
import { assertNativeWorkbookBirthHistory } from './native-birth-history';
import { ICommandService, IUndoRedoService, IUniverInstanceService, RedoCommand, UndoCommand, UniverInstanceType, type ICommand, type IWorkbookData, type Univer, type Workbook } from '@univerjs/core';
import { getSheetCommandTarget, InsertSheetCommand, InsertSheetMutation, RemoveSheetCommand, RemoveSheetMutation, RemoveSheetUndoMutationFactory, SheetInterceptorService, SetWorksheetNameCommand, SetWorksheetNameMutation } from '@univerjs/sheets';
import { canonicalWorkbookJsonValue } from '@open-design/contracts/runtime/workbook-sheet-baseline';
import type { WorkbookWriter, WorkbookCheckpoint } from './workbook-writer';
import type { WorkbookDraftScope } from './workbook-draft-schema';
import { workbookSheetActionDescriptorSchema, type WorkbookSheetActionDescriptor } from './sheet-action-descriptor';
import { WORKBOOK_SHEET_BIRTH_MARKER, type WorkbookSheetBirthEntry } from './sheet-birth-context';
import { captureWorkbookSourceDeletion, WORKBOOK_SHEET_DELETE_MARKER } from './sheet-delete-context';
import { WorkbookSheetMutationOwner } from './sheet-mutation-owner';
import { workbookSheetMutationSnapshot } from './sheet-removal-selection';
import { prepareNativeWorkbookDelete, nativeSheetPayloadIdentity, projectNativeSheetSequence, type NativeSheetHistoryPayload, type NativeSheetMutation } from './native-delete-history';
import { deriveWorkbookRestoredDeletion } from './sheet-delete-derived';
import type { WorkbookProtectedSheetSequence } from './sheet-calculation-permit';
import { admitWorkbookNativeIssuer } from './native-history-budget';

type Direction = 'undo' | 'redo';
interface IssuedBirth { entry: WorkbookSheetBirthEntry; index: number; nativeEntryId: number }
interface BirthAction { birth: IssuedBirth; direction: Direction; checkpoint: ReturnType<IUndoRedoService['getUndoRedoCheckpoint']> }
interface IssuedNativeSheetAction { purpose: 'delete' | 'rename'; descriptor: WorkbookSheetActionDescriptor; nativeEntryId: number; payload: NativeSheetHistoryPayload }
interface NativeSheetAction { issued: IssuedNativeSheetAction; direction: Direction; checkpoint: ReturnType<IUndoRedoService['getUndoRedoCheckpoint']> }

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
  private readonly deletions = new Map<string, IssuedNativeSheetAction>();
  private readonly renames = new Map<string, IssuedNativeSheetAction>();
  private readonly renameTokens = new Set<string>();
  private issuerBytes = 2;
  private readonly injector;
  private busy = false;
  private disposed = false;

  constructor(univer: Univer, private readonly writer: WorkbookWriter, private readonly scope: WorkbookDraftScope,
    private readonly snapshot: () => IWorkbookData, private readonly current: () => boolean,
    private readonly runProtectedSequence: WorkbookProtectedSheetSequence = (_sequence, _prospective, execute) => execute()) {
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
            const deletion = this.nativeAction(direction, 'delete');
            if (deletion) return this.replayNativeAction(deletion, () => native.handler(accessor, params, options) === true, 'delete');
            const rename = this.nativeAction(direction, 'rename');
            if (rename) return this.replayNativeAction(rename, () => native.handler(accessor, params, options) === true, 'rename');
            const action = this.action(direction);
            if (!action) return native.handler(accessor, params, options);
            return this.protect(action, () => native.handler(accessor, params, options) === true);
          },
          syncHandler: (accessor, params, options) => {
            if (this.nativeAction(direction, 'delete') || this.nativeAction(direction, 'rename') || this.action(direction)) throw Error('Protected worksheet history requires asynchronous dispatch.');
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
          if (!input || target?.workbook !== this.unit || Object.keys(input).some(key => !['unitId', 'subUnitId'].includes(key))
            || (input.unitId !== undefined && input.unitId !== this.unit.getUnitId())
            || typeof input.subUnitId !== 'string') throw Error('The source Delete target is invalid.');
          return this.performRemove(input.subUnitId).then(() => true);
        },
        syncHandler: (accessor, params, options) => {
          const target = getSheetCommandTarget(this.instances, params as { unitId?: string; subUnitId?: string } | undefined);
          if (target && target.workbook !== this.unit) return remove.handler(accessor, params, options);
          throw Error('Protected worksheet Delete requires asynchronous dispatch.');
        },
      }));
      const rename: ICommand = SetWorksheetNameCommand;
      this.handles.push(this.commands.replaceCommand(SetWorksheetNameCommand, {
        id: rename.id, type: rename.type,
        handler: (accessor, params, options) => {
          const input = params as { unitId?: string; subUnitId?: string; name?: string } | undefined;
          const target = getSheetCommandTarget(this.instances, input);
          if (target && target.workbook !== this.unit) return rename.handler(accessor, params, options);
          if (!input || target?.workbook !== this.unit || Object.keys(input).some(key => !['unitId', 'subUnitId', 'name'].includes(key))
            || (input.unitId !== undefined && input.unitId !== this.unit.getUnitId())
            || typeof input.subUnitId !== 'string' || typeof input.name !== 'string') throw Error('The Rename target is invalid.');
          return this.performRename(input.subUnitId, input.name).then(() => true);
        },
        syncHandler: (accessor, params, options) => {
          const target = getSheetCommandTarget(this.instances, params as { unitId?: string; subUnitId?: string } | undefined);
          if (target && target.workbook !== this.unit) return rename.handler(accessor, params, options);
          throw Error('Protected worksheet Rename requires asynchronous dispatch.');
        },
      }));
    } catch (error) { this.dispose(); throw error; }
  }

  isCurrent(): boolean {
    return !this.disposed && this.current() && this.handles.length === 5 && this.handles.every(handle => handle.isCurrent())
      && this.instances.getFocusedUnit() === this.unit
      && this.instances.getUnit(this.unit.getUnitId(), UniverInstanceType.UNIVER_SHEET) === this.unit;
  }
  private owns(descriptor: WorkbookSheetActionDescriptor): boolean {
    const owned = this.issued.get(descriptor.token);
    if (!owned || canonicalWorkbookJsonValue(owned) !== canonicalWorkbookJsonValue(descriptor)) return false;
    if (this.renameTokens.has(descriptor.token)) return true;
    const state = this.writer.checkpoint();
    return [...(state.sheetBirths?.entries.map(value => value.descriptor) ?? []),
      ...(state.sheetBirths?.removals?.map(value => value.descriptor) ?? []),
      ...(state.sheetDeletions?.map(value => value.descriptor) ?? [])]
      .some(value => canonicalWorkbookJsonValue(value) === canonicalWorkbookJsonValue(descriptor));
  }
  private issuerAdmission(descriptor: WorkbookSheetActionDescriptor, detail?: object) {
    if (this.issued.has(descriptor.token)) throw Error('The native worksheet issuer token is already in use.');
    return admitWorkbookNativeIssuer(this.issued.size, this.issuerBytes,
      { descriptor, ...(detail ? { owned: detail } : {}) });
  }
  private historyIssuerData(purpose: 'delete' | 'rename', descriptor: WorkbookSheetActionDescriptor, payload: NativeSheetHistoryPayload) {
    return { history: { purpose, descriptor, payload, nativeEntryId: Number.MAX_SAFE_INTEGER } };
  }
  private birthIssuerData(entry: WorkbookSheetBirthEntry, index: number) {
    return { birth: { entry, index, nativeEntryId: Number.MAX_SAFE_INTEGER } };
  }
  private issue(descriptor: WorkbookSheetActionDescriptor, detail?: object): void {
    const admitted = this.issuerAdmission(descriptor, detail);
    this.issued.set(descriptor.token, structuredClone(descriptor));
    this.issuerBytes = admitted.total;
  }

  private protectedNativeRoots(history: ReturnType<IUndoRedoService['getUndoRedoEntryIds']>): WorkbookNativeRoot[] {
    const reachable = new Set([...history.undos, ...history.redos]);
    const roots: WorkbookNativeRoot[] = [];
    // Payload inspection is deliberately top-only. Retain buried issued IDs
    // using their immutable private payload; native Undo/Redo will validate
    // the actual payload again once that same item becomes the stack top.
    for (const birth of this.births.values()) {
      for (const direction of ['undo', 'redo'] as const) if (history[direction === 'undo' ? 'undos' : 'redos'].at(-1) === birth.nativeEntryId) {
        assertNativeWorkbookBirthHistory(this.history.getUndoRedoMutationData(history.unitId, direction, birth.nativeEntryId), history.unitId, birth.entry, birth.index);
      }
      roots.push({ descriptor: birth.entry.descriptor, reachable: reachable.has(birth.nativeEntryId), sheets: [birth.entry.initialSheet] });
    }
    for (const issued of [...this.deletions.values(), ...this.renames.values()]) {
      for (const direction of ['undo', 'redo'] as const) if (history[direction === 'undo' ? 'undos' : 'redos'].at(-1) === issued.nativeEntryId) {
        this.assertNativePayload(issued, this.history.getUndoRedoMutationData(history.unitId, direction, issued.nativeEntryId));
      }
      const sheets = [...issued.payload.undoMutations, ...issued.payload.redoMutations]
        .filter(value => value.id === InsertSheetMutation.id).map(value => (value.params as { sheet: IWorkbookData['sheets'][string] }).sheet);
      roots.push({ descriptor: issued.descriptor, reachable: reachable.has(issued.nativeEntryId), sheets });
    }
    return roots;
  }

  /** Explicit live-controller maintenance; returned IDs are retention evidence,
   * never durable issuance. Referenced snapshot metadata is not cleaned here. */
  async retireProtectedRoots(): Promise<{ retiredContexts: number; retiredIssuers: number }> {
    if (this.busy || !this.isCurrent()) throw Error('The worksheet action owner is not current.');
    this.busy = true;
    try {
      const writer = this.writer, snapshot = this.snapshot();
      const history = this.history.getUndoRedoEntryIds(this.unit.getUnitId());
      const checkpoint = this.history.getUndoRedoCheckpoint();
      const roots = this.protectedNativeRoots(history);
      const verify = () => {
        if (this.writer !== writer || !this.isCurrent() || canonicalWorkbookJsonValue(this.snapshot()) !== canonicalWorkbookJsonValue(snapshot)
          || canonicalWorkbookJsonValue(this.history.getUndoRedoEntryIds(history.unitId)) !== canonicalWorkbookJsonValue(history)) throw Error('The worksheet history changed while retiring roots.');
        this.assertHistoryCheckpoint(checkpoint);
        this.protectedNativeRoots(history);
      };
      let retiredIssuers = 0;
      const result = await writer.protectSheetRootRetirement(snapshot, roots, verify, retained => {
        // Compute the retained accounting first; all following Map/Set deletes
        // are synchronous and cannot call application/native callbacks.
        let count = 0, bytes = 2;
        for (const [token, descriptor] of this.issued) if (retained.has(token)) {
          const birth = this.births.get(token), action = this.deletions.get(token) ?? this.renames.get(token);
          const detail = birth ? this.birthIssuerData(birth.entry, birth.index)
            : action ? this.historyIssuerData(action.purpose, descriptor, action.payload) : undefined;
          bytes = admitWorkbookNativeIssuer(count++, bytes, { descriptor, ...(detail ? { owned: detail } : {}) }).total;
        }
        for (const token of this.issued.keys()) if (!retained.has(token)) {
          this.issued.delete(token); this.births.delete(token); this.deletions.delete(token); this.renames.delete(token); this.renameTokens.delete(token);
          retiredIssuers++;
        }
        this.issuerBytes = bytes;
      });
      return { ...result, retiredIssuers };
    } finally { this.busy = false; }
  }

  async remove(sheetId: string): Promise<void> {
    if (await this.commands.executeCommand(RemoveSheetCommand.id, { unitId: this.unit.getUnitId(), subUnitId: sheetId }) !== true) throw Error('The source Delete was refused.');
  }

  async rename(sheetId: string, name: string): Promise<void> {
    if (await this.commands.executeCommand(SetWorksheetNameCommand.id, { unitId: this.unit.getUnitId(), subUnitId: sheetId, name }) !== true) throw Error('The worksheet Rename was refused.');
  }

  private async performRename(sheetId: string, name: string): Promise<void> {
    if (this.busy || !this.isCurrent()) throw Error('The worksheet action owner is not current.');
    this.busy = true;
    try {
      const before = this.snapshot();
      if (!before.sheets[sheetId] || before.sheets[sheetId]!.hidden === 2) throw Error('The Rename target is unavailable.');
      if (canonicalWorkbookJsonValue(this.writer.checkpoint().desired) !== canonicalWorkbookJsonValue(before)) throw Error('The worksheet writer snapshot is not current.');
      if (name === before.sheets[sheetId]!.name) return;
      const oldName = before.sheets[sheetId]!.name!;
      const descriptor = workbookSheetActionDescriptorSchema.parse({ version: 1, token: crypto.randomUUID(), sheetId,
        generation: before.custom?.evebotStructureOwner?.generation });
      const params = { unitId: before.id, subUnitId: sheetId, name };
      const dependencies = this.injector.get(SheetInterceptorService).onCommandExecute({ id: SetWorksheetNameCommand.id, params });
      const payload: NativeSheetHistoryPayload = structuredClone({
        undoMutations: [...(dependencies.preUndos ?? []), { id: SetWorksheetNameMutation.id, params: { ...params, name: oldName, oldName: name } }, ...dependencies.undos],
        redoMutations: [...(dependencies.preRedos ?? []), { id: SetWorksheetNameMutation.id, params: { ...params, oldName } }, ...dependencies.redos],
      });
      nativeSheetPayloadIdentity(payload);
      const projection = projectNativeSheetSequence(before, descriptor, payload.redoMutations);
      projectNativeSheetSequence(projection.snapshot, descriptor, payload.undoMutations);
      const checkpoint = this.history.getUndoRedoCheckpoint();
      const verify = () => {
        if (!this.isCurrent() || canonicalWorkbookJsonValue(this.snapshot()) !== canonicalWorkbookJsonValue(before)
          || canonicalWorkbookJsonValue(this.history.getUndoRedoCheckpoint()) !== canonicalWorkbookJsonValue(checkpoint)) throw Error('The worksheet history changed while protecting Rename.');
        this.issuerAdmission(descriptor, this.historyIssuerData('rename', descriptor, payload));
        return undefined;
      };
      await this.writer.protectSheetRename(projection.snapshot, () => {
        verify();
        return this.commitNativeAction('rename', descriptor, before, payload, checkpoint);
      }, verify);
    } finally { this.busy = false; }
  }

  private deletionOrigin(state: WorkbookCheckpoint, sheetId: string) {
    if (state.source.model.sheets.some(value => value.id === sheetId)) return { kind: 'source' as const };
    const sheet = state.desired.sheets[sheetId];
    const marker = sheet?.custom?.[WORKBOOK_SHEET_DELETE_MARKER] as WorkbookSheetActionDescriptor | undefined;
    if (marker) {
      const issued = this.deletions.get(marker.token);
      if (!issued || canonicalWorkbookJsonValue(issued.descriptor) !== canonicalWorkbookJsonValue(marker)
        || issued.descriptor.sheetId !== sheetId || !this.owns(issued.descriptor)) throw Error('The selected worksheet has no live deletion ancestor.');
      if (state.sheetDeletions?.some(value => canonicalWorkbookJsonValue(value.descriptor) === canonicalWorkbookJsonValue(issued.descriptor))) {
        return { kind: 'restored' as const, ancestor: issued.descriptor };
      }
    }
    const birth = [...this.births.values()].find(value => value.entry.descriptor.sheetId === sheetId);
    if (!birth || !this.owns(birth.entry.descriptor)
      || canonicalWorkbookJsonValue(sheet?.custom?.[WORKBOOK_SHEET_BIRTH_MARKER]) !== canonicalWorkbookJsonValue(birth.entry.descriptor)
      || marker && !state.sheetBirths?.removals?.some(value => value.birthToken === birth.entry.descriptor.token
        && canonicalWorkbookJsonValue(value.descriptor) === canonicalWorkbookJsonValue(marker))) throw Error('The selected worksheet has no live unsaved birth issuer.');
    return { kind: 'birth' as const, birth: birth.entry.descriptor };
  }

  private async performRemove(sheetId: string): Promise<void> {
    if (this.busy || !this.isCurrent()) throw Error('The worksheet action owner is not current.');
    this.busy = true;
    try {
      const before = this.snapshot(), writerState = this.writer.checkpoint();
      if (canonicalWorkbookJsonValue(writerState.desired) !== canonicalWorkbookJsonValue(before)) throw Error('The worksheet writer snapshot is not current.');
      if (!before.sheets[sheetId] || before.sheets[sheetId]!.hidden === 2
        || before.sheetOrder.filter(id => !before.sheets[id]!.hidden).length <= 1 && !before.sheets[sheetId]!.hidden) throw Error('Keep at least one worksheet visible.');
      const origin = this.deletionOrigin(writerState, sheetId);
      const insert = this.injector.invoke(accessor => RemoveSheetUndoMutationFactory(accessor, { unitId: before.id, subUnitId: sheetId, subUnitName: before.sheets[sheetId]!.name! }));
      if (insert.index !== before.sheetOrder.indexOf(sheetId) || canonicalWorkbookJsonValue(insert.sheet) !== canonicalWorkbookJsonValue(before.sheets[sheetId])) throw Error('The native Delete factory changed its removed configuration.');
      const dependencies = this.injector.get(SheetInterceptorService).onCommandExecute({ id: RemoveSheetCommand.id, params: { unitId: before.id, subUnitId: sheetId } });
      const checkpoint = this.history.getUndoRedoCheckpoint();
      let preparedIssuer: ReturnType<typeof prepareNativeWorkbookDelete> | undefined;
      const verify = () => {
        if (!this.isCurrent() || canonicalWorkbookJsonValue(this.snapshot()) !== canonicalWorkbookJsonValue(before)
          || canonicalWorkbookJsonValue(this.history.getUndoRedoCheckpoint()) !== canonicalWorkbookJsonValue(checkpoint)) throw Error('The worksheet history changed while protecting its action.');
        if (origin.kind !== 'source') {
          const current = this.deletionOrigin(this.writer.checkpoint(), sheetId);
          if (canonicalWorkbookJsonValue(current) !== canonicalWorkbookJsonValue(origin)) throw Error('The worksheet deletion origin changed.');
        }
        if (!preparedIssuer) throw Error('The worksheet deletion issuer is not prepared.');
        this.issuerAdmission(preparedIssuer.descriptor, this.historyIssuerData('delete', preparedIssuer.descriptor, preparedIssuer.payload));
        return undefined;
      };
      const execute = (prepared: ReturnType<typeof prepareNativeWorkbookDelete>) => {
        verify();
        const { descriptor, sheet, stamped, payload } = prepared;
        return this.commitNativeAction('delete', descriptor, stamped, payload, checkpoint,
          () => this.unit.getSheetBySheetId(sheetId)!.setCustomMetadata(structuredClone(sheet.custom!)));
      };
      if (origin.kind === 'birth') {
        await this.writer.protectSheetBirthRemoval(origin.birth, removal => {
          if (!preparedIssuer || canonicalWorkbookJsonValue(preparedIssuer.descriptor) !== canonicalWorkbookJsonValue(removal.descriptor)) throw Error('The prepared birth deletion changed.');
          return execute(preparedIssuer);
        }, verify, removal => {
          preparedIssuer = prepareNativeWorkbookDelete(before, removal.descriptor, insert, dependencies);
          return preparedIssuer.projection.snapshot;
        });
      } else {
        const context = origin.kind === 'source' ? captureWorkbookSourceDeletion(this.scope, writerState, sheetId)
          : deriveWorkbookRestoredDeletion(writerState, origin.ancestor);
        const prepared = prepareNativeWorkbookDelete(before, context.descriptor, insert, dependencies);
        preparedIssuer = prepared;
        await this.writer.protectSheetDeletion(context, prepared.projection.snapshot, () => execute(prepared), verify,
          origin.kind === 'restored' ? origin.ancestor : undefined);
      }
    } finally { this.busy = false; }
  }

  private commitNativeAction(purpose: 'delete' | 'rename', descriptor: WorkbookSheetActionDescriptor,
    before: IWorkbookData, payload: NativeSheetHistoryPayload,
    checkpoint: ReturnType<IUndoRedoService['getUndoRedoCheckpoint']>, stamp?: () => void): IWorkbookData {
    this.issue(descriptor, this.historyIssuerData(purpose, descriptor, payload));
    if (purpose === 'rename') this.renameTokens.add(descriptor.token);
    stamp?.();
    const result = this.runNativeSequence(descriptor, before, payload.redoMutations, () => {
      for (const mutation of payload.redoMutations) if (this.commands.syncExecuteCommand(mutation.id, structuredClone(mutation.params)) !== true) return false;
      if (!this.isCurrent() || canonicalWorkbookJsonValue(this.history.getUndoRedoCheckpoint()) !== canonicalWorkbookJsonValue(checkpoint)) throw Error('The native worksheet action changed history before its owned push.');
      this.history.pushUndoRedo({ unitID: before.id, undoMutations: structuredClone(payload.undoMutations), redoMutations: structuredClone(payload.redoMutations) });
      return true;
    });
    const native = this.assertHistoryPush(checkpoint);
    const issued = { purpose, descriptor: structuredClone(descriptor), nativeEntryId: native.undoEntryId, payload: structuredClone(payload) };
    this.assertNativePayload(issued, this.history.getUndoRedoMutationData(before.id, 'undo', native.undoEntryId));
    (purpose === 'delete' ? this.deletions : this.renames).set(descriptor.token, issued);
    return result;
  }

  private assertHistoryCheckpoint(checkpoint: ReturnType<IUndoRedoService['getUndoRedoCheckpoint']>): void {
    if (!this.isCurrent() || canonicalWorkbookJsonValue(this.history.getUndoRedoCheckpoint()) !== canonicalWorkbookJsonValue(checkpoint)) {
      throw Error('The worksheet history changed while protecting its action.');
    }
  }

  private assertHistoryPush(checkpoint: ReturnType<IUndoRedoService['getUndoRedoCheckpoint']>) {
    const native = this.history.getUndoRedoCheckpoint();
    if (!this.isCurrent() || native.unitId !== this.unit.getUnitId() || native.undoEntryId === null
      || native.revision !== checkpoint.revision + 1) throw Error('The native worksheet history entry is unavailable.');
    return { ...native, undoEntryId: native.undoEntryId };
  }

  private assertHistoryTransfer(checkpoint: ReturnType<IUndoRedoService['getUndoRedoCheckpoint']>, direction: Direction, entryId: number): Direction {
    const native = this.history.getUndoRedoCheckpoint();
    const opposite = direction === 'undo' ? 'redo' : 'undo';
    if (!this.isCurrent() || native.unitId !== checkpoint.unitId || native.revision !== checkpoint.revision + 1
      || native[opposite === 'undo' ? 'undoEntryId' : 'redoEntryId'] !== entryId) throw Error('The protected native worksheet history transfer changed.');
    return opposite;
  }

  private assertNativePayload(issued: IssuedNativeSheetAction, data: Parameters<typeof nativeSheetPayloadIdentity>[0]): void {
    if (nativeSheetPayloadIdentity(data) !== nativeSheetPayloadIdentity(issued.payload)) throw Error(`The native ${issued.purpose === 'delete' ? 'Delete' : 'Rename'} payload changed.`);
  }

  private nativeAction(direction: Direction, kind: 'delete' | 'rename'): NativeSheetAction | null {
    const checkpoint = this.history.getUndoRedoCheckpoint();
    const nativeEntryId = checkpoint[direction === 'undo' ? 'undoEntryId' : 'redoEntryId'];
    if (checkpoint.unitId !== this.unit.getUnitId() || nativeEntryId === null) return null;
    const pool = kind === 'delete' ? this.deletions : this.renames;
    const issued = [...pool.values()].find(value => value.nativeEntryId === nativeEntryId);
    if (!issued) return null;
    const data = this.history.getUndoRedoMutationData(checkpoint.unitId, direction, nativeEntryId);
    if (!this.isCurrent() || this.busy || !this.owns(issued.descriptor)) throw Error('The native worksheet issuer is not current.');
    this.assertNativePayload(issued, data);
    if (kind === 'delete' && Boolean(this.snapshot().sheets[issued.descriptor.sheetId]) !== (direction === 'redo')) throw Error('The native Delete direction changed.');
    return { issued, direction, checkpoint };
  }

  private async replayNativeAction(action: NativeSheetAction, execute: () => boolean, kind: 'delete' | 'rename'): Promise<boolean> {
    this.busy = true;
    try {
      const descriptor = action.issued.descriptor;
      const mutations = action.direction === 'undo' ? action.issued.payload.undoMutations : action.issued.payload.redoMutations;
      const before = this.snapshot();
      if (canonicalWorkbookJsonValue(this.writer.checkpoint().desired) !== canonicalWorkbookJsonValue(before)) throw Error('The worksheet writer snapshot is not current.');
      const projection = projectNativeSheetSequence(before, descriptor, mutations);
      const verify = () => {
        if (!this.isCurrent() || !this.owns(descriptor)
          || canonicalWorkbookJsonValue(this.history.getUndoRedoCheckpoint()) !== canonicalWorkbookJsonValue(action.checkpoint)) throw Error('The worksheet history changed while protecting its action.');
        this.assertNativePayload(action.issued, this.history.getUndoRedoMutationData(action.checkpoint.unitId, action.direction, action.issued.nativeEntryId));
        return undefined;
      };
      const protectedExecute = () => {
          verify();
          return this.runNativeSequence(descriptor, before, mutations, () => {
            if (execute() !== true) return false;
            const opposite = this.assertHistoryTransfer(action.checkpoint, action.direction, action.issued.nativeEntryId);
            this.assertNativePayload(action.issued, this.history.getUndoRedoMutationData(action.checkpoint.unitId, opposite, action.issued.nativeEntryId));
            return true;
          });
        };
      if (kind === 'delete') await this.writer.protectSheetDeletionReplay(descriptor, projection.snapshot, protectedExecute, verify);
      else await this.writer.protectSheetRename(projection.snapshot, protectedExecute, verify);
      return true;
    } finally { this.busy = false; }
  }

  private runNativeSequence(descriptor: WorkbookSheetActionDescriptor, before: IWorkbookData,
    mutations: readonly NativeSheetMutation[], execute: () => boolean): IWorkbookData {
    const projection = projectNativeSheetSequence(before, descriptor, mutations);
    const { kind, before: immediateBefore, after } = projection.transition;
    return this.mutation.run(kind, descriptor, immediateBefore, after, () => this.runProtectedSequence(mutations, projection.snapshot, execute), projection.snapshot);
  }

  async add(name: string, index: number): Promise<WorkbookSheetBirthEntry> {
    if (this.busy || !this.isCurrent()) throw Error('The worksheet action owner is not current.');
    this.busy = true;
    try {
      const checkpoint = this.history.getUndoRedoCheckpoint();
      return await this.writer.protectSheetBirth(name, index, entry => {
        this.assertHistoryCheckpoint(checkpoint);
        this.issue(entry.descriptor, this.birthIssuerData(entry, index));
        const before = this.snapshot(), after = structuredClone(before);
        after.sheets[entry.descriptor.sheetId] = structuredClone(entry.initialSheet);
        after.sheetOrder.splice(index, 0, entry.descriptor.sheetId);
        const sequence = [{ id: InsertSheetMutation.id, params: { unitId: before.id, index, sheet: structuredClone(entry.initialSheet) } }];
        const result = this.mutation.run('insert', entry.descriptor, before, after, () => this.runProtectedSequence(sequence, after, () => this.commands.syncExecuteCommand(InsertSheetCommand.id, {
          unitId: before.id, index, sheet: structuredClone(entry.initialSheet),
        })));
        const native = this.assertHistoryPush(checkpoint);
        assertNativeWorkbookBirthHistory(this.history.getUndoRedoMutationData(before.id, 'undo', native.undoEntryId), before.id, entry, index);
        this.births.set(entry.descriptor.token, { entry: structuredClone(entry), index, nativeEntryId: native.undoEntryId });
        return result;
      }, entry => {
        this.assertHistoryCheckpoint(checkpoint);
        this.issuerAdmission(entry.descriptor, this.birthIssuerData(entry, index));
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
    if (mutations.some(mutation => mutation.id === SetWorksheetNameMutation.id)) throw Error('The native Rename history has no live issuer.');
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
      const checkedExecute = () => {
        if (execute() !== true) return false;
        const opposite = this.assertHistoryTransfer(action.checkpoint, action.direction, action.birth.nativeEntryId);
        assertNativeWorkbookBirthHistory(this.history.getUndoRedoMutationData(action.checkpoint.unitId, opposite, action.birth.nativeEntryId),
          action.checkpoint.unitId, action.birth.entry, action.birth.index);
        return true;
      };
      const sequence: NativeSheetMutation[] = action.direction === 'redo'
        ? [{ id: InsertSheetMutation.id, params: { unitId: this.unit.getUnitId(), index: action.birth.index, sheet: structuredClone(action.birth.entry.initialSheet) } }]
        : [{ id: RemoveSheetMutation.id, params: { unitId: this.unit.getUnitId(), subUnitId: origin.sheetId, subUnitName: action.birth.entry.initialSheet.name } }];
      if (action.direction === 'redo') {
        await this.writer.protectSheetBirthReplay(origin, action.birth.index, after => {
          this.verify(action);
          return this.mutation.run('insert', origin, this.snapshot(), after, () => this.runProtectedSequence(sequence, after, checkedExecute));
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
            return this.mutation.run('remove', context.descriptor, before, prospective, () => this.runProtectedSequence(sequence, prospective, checkedExecute));
          }, () => { this.verify(action); this.issuerAdmission(context.descriptor); return undefined; });
        } else {
          await this.writer.protectSheetBirthRemoval(origin, removal => {
            this.verify(action); this.issue(removal.descriptor);
            const before = this.snapshot(), after = structuredClone(before);
            delete after.sheets[origin.sheetId]; after.sheetOrder = after.sheetOrder.filter(id => id !== origin.sheetId);
            const prospective = workbookSheetMutationSnapshot(before, after, 'remove', removal.descriptor);
            return this.mutation.run('remove', removal.descriptor, before, prospective, () => this.runProtectedSequence(sequence, prospective, checkedExecute));
          }, removal => { this.verify(action); this.issuerAdmission(removal.descriptor); return undefined; });
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
    this.issued.clear();
    this.births.clear();
    this.deletions.clear();
    this.renames.clear();
    this.renameTokens.clear();
    this.issuerBytes = 2;
  }
}
