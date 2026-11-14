import type { WorkbookMembershipAction, WorkbookMembershipVisibility } from '@open-design/contracts/runtime/workbook';
import type { WorkbookMembershipPrivateStamp } from './grid-membership-bridge';
import type { WorkbookSheetHistoryController } from './sheet-history-controller';
import { ICommandService, IUndoRedoService, RedoCommand, UndoCommand, type Univer } from '@univerjs/core';

/** Mutations precede history pushes and protected history can still be busy.
 * Publish at the pinned SDK's settled boundary on any new history revision,
 * plus final Undo/Redo, without snapshotting every calculation mutation. */
export function publishWorkbookMembershipHistory(univer: Univer, current: () => boolean, publish: () => void) {
  const history = univer.__getInjector().get(IUndoRedoService);
  let revision = history.getUndoRedoCheckpoint().revision;
  return univer.__getInjector().get(ICommandService).onCommandExecuted(command => {
    if (!current()) return;
    const next = history.getUndoRedoCheckpoint().revision;
    if (next !== revision || command.id === UndoCommand.id || command.id === RedoCommand.id) {
      revision = next; publish();
    }
  });
}

interface Context {
  controller: WorkbookSheetHistoryController;
  visibility: Omit<WorkbookMembershipVisibility, 'membership'>;
  scope: { projectId: string; controllerId: string; blocked: boolean; saving?: boolean };
  sourceSha256: string | undefined;
  current: boolean; writerCurrent: boolean; calculationReady: boolean;
  ready: boolean; editable: boolean; canEdit: boolean;
}

/** Private SDK admission shared by the grid and its real-controller tests.
 * Host packets supply no controller, lease, source or permission authority. */
export function workbookMembershipExecutor(ownerId: string, read: () => Context | null) {
  const inspect = () => {
    const value = read();
    if (!value || !value.current || !value.writerCurrent || !value.calculationReady || !value.ready || !value.editable || !value.canEdit) return null;
    const inspected = value.controller.inspectManagement();
    return inspected ? { ...value, inspected } : null;
  };
  return {
    getState() {
      const value = inspect(); if (!value) return null;
      const { visibility, controller, inspected, scope } = value;
      const busy = inspected.busy || Boolean(scope.blocked || scope.saving);
      const allowed = visibility.editable && !busy;
      const visible = visibility.sheets.filter(sheet => sheet.visibility === 'visible').length;
      return { visibility, ownerId, lifetime: controller, historyRevision: inspected.historyRevision, busy,
        canAdd: allowed && inspected.snapshot.sheetOrder.length < 64,
        sheets: visibility.sheets.map(sheet => ({ id: sheet.id, canRename: allowed,
          canDelete: allowed && visibility.sheets.length > 1 && (sheet.visibility !== 'visible' || visible > 1) })) };
    },
    async execute(action: WorkbookMembershipAction['action'], stamp: WorkbookMembershipPrivateStamp) {
      const value = inspect();
      if (!value || stamp.lifetime !== value.controller || stamp.ownerId !== ownerId
        || value.scope.blocked || value.scope.saving || value.scope.projectId !== stamp.projectId || value.scope.controllerId !== stamp.controllerId
        || value.sourceSha256 !== stamp.sourceSha256 || value.inspected.historyRevision !== stamp.historyRevision || value.inspected.busy) {
        throw Error('The worksheet management owner changed.');
      }
      // The controller independently checks its private plan/lease again after
      // any maintenance await. No serialized host ticket can issue an action.
      if (action.kind === 'add') await value.controller.add(action.name, value.inspected.snapshot.sheetOrder.length);
      else if (action.kind === 'rename') await value.controller.rename(action.sheetId, action.name);
      else await value.controller.remove(action.sheetId);
    },
  };
}
