import type { IWorkbookData } from '@univerjs/core';
import type { WorkbookDocument } from '@open-design/contracts/runtime/workbook';

export const WORKSHEET_VISIBILITY_MUTATION = 'sheet.mutation.set-worksheet-hidden';
/** Exact bounded layout mutation. It cannot change geometry or grant access to
 * veryHidden sheets. Called before SDK handlers and by calculation admission. */
export function assertWorkbookVisibilityMutation(params: unknown, book: IWorkbookData, model?: WorkbookDocument): void {
  const value = params as { unitId?: unknown; subUnitId?: unknown; hidden?: unknown } | undefined;
  if (!value || value.unitId !== book.id || typeof value.subUnitId !== 'string' || !Object.hasOwn(book.sheets, value.subUnitId) || value.hidden !== 0 && value.hidden !== 1) throw new Error('Invalid worksheet visibility change.');
  const sheet = book.sheets[value.subUnitId]!;
  if (sheet.hidden === 2 || model && (!model.worksheetVisibilityEditable || !model.sheets.some(sheet => sheet.id === value.subUnitId) || model.sheets.find(sheet => sheet.id === value.subUnitId)?.visibility === 'veryHidden')) throw new Error('This worksheet visibility cannot be changed.');
  if (value.hidden === 1 && !Object.entries(book.sheets).some(([id, sheet]) => id !== value.subUnitId && (sheet.hidden === undefined || sheet.hidden === 0))) throw new Error('Keep at least one worksheet visible.');
}
