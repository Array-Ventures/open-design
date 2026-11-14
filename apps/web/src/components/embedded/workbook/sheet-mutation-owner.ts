import { ICommandService, IUniverInstanceService, UniverInstanceType, type ICommand, type IWorkbookData, type Univer, type Workbook } from '@univerjs/core';
import { InsertSheetMutation, RemoveSheetMutation } from '@univerjs/sheets';
import { canonicalWorkbookJsonValue } from '@open-design/contracts/runtime/workbook-sheet-baseline';
import { workbookSheetActionDescriptorSchema, type WorkbookSheetActionDescriptor } from './sheet-action-descriptor';
import { WORKBOOK_SHEET_REMOVALS, workbookSheetRemovalSelection, workbookSheetMutationSnapshot, type WorkbookSheetMutationKind } from './sheet-removal-selection';


interface MutationTicket {
  kind: WorkbookSheetMutationKind;
  descriptor: WorkbookSheetActionDescriptor;
  before: IWorkbookData;
  after: IWorkbookData;
  invoked: boolean;
}
export interface WorkbookSheetMutationAuthority {
  /** Live issuer/pool and existing protection/lease checks, never a metadata lookup. */
  isCurrent(): boolean;
  owns(descriptor: WorkbookSheetActionDescriptor): boolean;
  snapshot(): IWorkbookData;
}

/** Uninstalled controller foundation. Construct only for the owned kernel;
 * invoke run inside the Writer's already awaited protected synchronous callback.
 * Native history must be protected before stack pop, outside this mutation seam. */
export class WorkbookSheetMutationOwner {
  private readonly handles: ReturnType<ICommandService['replaceCommand']>[] = [];
  private readonly commands;
  private readonly instances;
  private readonly unit: Workbook;
  private ticket: MutationTicket | undefined;
  private executing = false;
  private fault: Error | undefined;
  private disposed = false;

  constructor(univer: Univer, unitId: string, private readonly authority: WorkbookSheetMutationAuthority) {
    const injector = univer.__getInjector();
    this.commands = injector.get(ICommandService);
    this.instances = injector.get(IUniverInstanceService);
    const unit = this.instances.getUnit<Workbook>(unitId, UniverInstanceType.UNIVER_SHEET);
    if (!unit) throw Error('The worksheet kernel is unavailable.');
    this.unit = unit;
    try {
      for (const [kind, original] of [['insert', InsertSheetMutation], ['remove', RemoveSheetMutation]] as const) {
        const originalCommand: ICommand = original;
        const command: ICommand = { ...original, handler: (accessor, params, options) => {
          const ticket = this.ticket;
          this.ticket = undefined;
          if (this.executing) throw this.conflict('A nested worksheet mutation was refused.');
          if (!ticket || ticket.kind !== kind || !this.isCurrent() || !this.authority.owns(ticket.descriptor)) throw Error('The worksheet mutation is not protected.');
          const input = params as { unitId?: string; subUnitId?: string; sheet?: { id?: string } } | undefined;
          if (input?.unitId !== unitId || (kind === 'insert' ? input.sheet?.id : input.subUnitId) !== ticket.descriptor.sheetId
            || canonicalWorkbookJsonValue(this.authority.snapshot()) !== canonicalWorkbookJsonValue(ticket.before)) throw Error('The protected worksheet target changed.');
          this.executing = true;
          ticket.invoked = true;
          try {
            const result = originalCommand.handler(accessor, params, options);
            if (result !== true) throw Error('The native worksheet mutation did not complete.');
            const custom: Record<string, unknown> = { ...this.unit.getCustomMetadata() };
            const selection = ticket.after.custom?.[WORKBOOK_SHEET_REMOVALS];
            if (selection === undefined) delete custom[WORKBOOK_SHEET_REMOVALS];
            else custom[WORKBOOK_SHEET_REMOVALS] = structuredClone(selection);
            this.unit.setCustomMetadata(custom);
            if (!this.isCurrent() || canonicalWorkbookJsonValue(this.authority.snapshot()) !== canonicalWorkbookJsonValue(ticket.after)) throw Error('The native worksheet mutation changed its protected result.');
            return true;
          } catch (error) {
            throw this.conflict(error instanceof Error ? error.message : 'The native worksheet mutation failed.');
          } finally { this.executing = false; }
        } };
        this.handles.push(this.commands.replaceCommand(original, command));
      }
    } catch (error) { this.dispose(); throw error; }
  }

  isCurrent(): boolean {
    return !this.disposed && !this.fault && this.handles.length === 2 && this.handles.every(handle => handle.isCurrent())
      && this.authority.isCurrent() && this.instances.getFocusedUnit() === this.unit
      && this.instances.getUnit(this.unit.getUnitId(), UniverInstanceType.UNIVER_SHEET) === this.unit;
  }

  run(kind: WorkbookSheetMutationKind, descriptor: WorkbookSheetActionDescriptor, before: IWorkbookData,
    after: IWorkbookData, execute: () => boolean): IWorkbookData {
    if (this.ticket || this.executing || !this.isCurrent() || !this.authority.owns(descriptor)) throw Error('The worksheet action owner is not current.');
    const expected = workbookSheetMutationSnapshot(before, after, kind, descriptor);
    for (const [sheetId, token] of Object.entries(workbookSheetRemovalSelection(before, descriptor.generation))) {
      if (!this.authority.owns({ version: 1, generation: descriptor.generation, sheetId, token })) throw Error('A removal selection has no live protected owner.');
    }
    const ticket: MutationTicket = { kind, descriptor: workbookSheetActionDescriptorSchema.parse(descriptor), before: structuredClone(before), after: expected, invoked: false };
    this.ticket = ticket;
    try {
      const result = execute();
      if (this.fault) throw this.fault;
      if (this.ticket) throw Error('The protected worksheet mutation was not invoked.');
      if (result !== true || !this.isCurrent() || canonicalWorkbookJsonValue(this.authority.snapshot()) !== canonicalWorkbookJsonValue(expected)) {
        throw this.conflict('The worksheet command did not match its protected result.');
      }
      return structuredClone(expected);
    } catch (error) {
      if (ticket.invoked || this.fault || canonicalWorkbookJsonValue(this.authority.snapshot()) !== canonicalWorkbookJsonValue(before)) {
        throw this.conflict(error instanceof Error ? error.message : 'The worksheet action changed its protected result.');
      }
      throw error;
    } finally { this.ticket = undefined; }
  }

  private conflict(message: string): Error {
    this.fault ??= Error(message);
    return this.fault;
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.ticket = undefined;
    for (const handle of [...this.handles].reverse()) handle.dispose();
  }
}
