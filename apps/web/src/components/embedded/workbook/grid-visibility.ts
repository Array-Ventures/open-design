import { ICommandService, type IWorkbookData, type Univer } from '@univerjs/core';
import { SetWorksheetHideCommand, SetWorksheetShowCommand } from '@univerjs/sheets';
import type { FUniver } from '@univerjs/presets';
import { workbookVisibilityEditSchema, type WorkbookDocument } from '@open-design/contracts/runtime/workbook';
import { z } from 'zod';
import { assertWorkbookVisibilityMutation, WORKSHEET_VISIBILITY_MUTATION } from './grid-visibility-policy';

export interface WorkbookVisibilityScope { projectId: string; controllerId: string; sourceSha256: string; blocked: boolean }
const actionSchema = workbookVisibilityEditSchema.extend({ type: z.literal('studio:workbook-visibility'), projectId: z.string().uuid(), controllerId: z.string().uuid(), sourceSha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();

/** Register before SDK plugins: no nested handler may mutate visibility before
 * the readiness/source owner has admitted the exact mutation. */
export function ownWorkbookVisibility(univer: Univer, model: () => WorkbookDocument, snapshot: () => IWorkbookData | undefined, ready: () => boolean) {
  return univer.__getInjector().get(ICommandService).beforeCommandExecuted((command, options) => {
    if (command.id !== WORKSHEET_VISIBILITY_MUTATION) return;
    if (options?.fromFormula) throw new Error('Calculation cannot change worksheet visibility.');
    const book = snapshot();
    if (!ready() || !book) throw new Error('The worksheet is not ready for changes.');
    assertWorkbookVisibilityMutation(command.params, book, model());
  });
}

/** Host controls use the same session/controller/source ownership as formatting.
 * Real SDK commands retain normal undo/redo; every write is independently
 * validated again against retained OOXML in the isolated worker. */
export function workbookVisibilityBridge(univer: Univer, api: FUniver, model: () => WorkbookDocument, scope: () => WorkbookVisibilityScope | undefined) {
  let error: string | null = null;
  const snapshot = () => api.getActiveWorkbook()?.save();
  function publish() {
    const current = scope(); if (!current) return;
    const book = snapshot(), visible = Object.values(book?.sheets ?? {}).filter(sheet => sheet.hidden === undefined || sheet.hidden === 0).length;
    const editable = Boolean(book && model().worksheetVisibilityEditable && !current.blocked && api.getActiveWorkbook()?.getWorkbookPermission().canEdit());
    const sheets = model().sheets.filter(sheet => sheet.visibility !== 'veryHidden').map(sheet => ({
      id: sheet.id, name: sheet.name, visibility: book?.sheets[sheet.id]?.hidden === 1 ? 'hidden' as const : 'visible' as const,
      canHide: editable && visible > 1 && book?.sheets[sheet.id]?.hidden !== 1,
    }));
    const active = api.getActiveWorkbook()?.getActiveSheet()?.getSheetId();
    const activeSheetId = sheets.find(sheet => sheet.id === active && sheet.visibility === 'visible')?.id ?? sheets.find(sheet => sheet.visibility === 'visible')?.id;
    if (!activeSheetId) return;
    window.parent.postMessage({ type: 'studio:workbook-visibility-state', projectId: current.projectId, controllerId: current.controllerId, sourceSha256: current.sourceSha256, editable, activeSheetId, sheets, error }, window.location.origin);
  }
  const receive = (event: MessageEvent) => {
    if (event.source !== window.parent || event.origin !== window.location.origin) return;
    const current = scope(); if (!current) return;
    if (event.data?.type === 'studio:artifact-request' && event.data.projectId === current.projectId) { publish(); return; }
    if (current.blocked) return;
    const parsed = actionSchema.safeParse(event.data);
    if (!parsed.success || parsed.data.projectId !== current.projectId || parsed.data.controllerId !== current.controllerId || parsed.data.sourceSha256 !== current.sourceSha256) return;
    try {
      const book = snapshot();
      if (!book || !api.getActiveWorkbook()?.getWorkbookPermission().canEdit()) throw new Error('This workbook is not editable.');
      const action = parsed.data, params = { unitId: book.id, subUnitId: action.sheetId, hidden: action.visibility === 'hidden' ? 1 : 0 };
      assertWorkbookVisibilityMutation(params, book, model());
      const commands = univer.__getInjector().get(ICommandService);
      if (!commands.syncExecuteCommand(action.visibility === 'hidden' ? SetWorksheetHideCommand.id : SetWorksheetShowCommand.id, params)) throw new Error('The worksheet visibility could not be changed.');
      error = null;
    } catch (failure) { error = failure instanceof Error ? failure.message.slice(0, 300) : 'The worksheet visibility could not be changed.'; }
    publish();
  };
  window.addEventListener('message', receive); publish();
  return { publish, dispose: () => window.removeEventListener('message', receive) };
}
