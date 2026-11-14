import { CommandType } from '@univerjs/core';
import { InsertSheetMutation, RemoveSheetMutation } from '@univerjs/sheets';
import { canonicalWorkbookJsonValue } from '@open-design/contracts/runtime/workbook-sheet-baseline';
import type { WorkbookSheetBirthEntry } from './sheet-birth-context';

interface NativeData {
  unitId: string; entryId: number;
  undoMutations: readonly Readonly<Record<string, unknown>>[];
  redoMutations: readonly Readonly<Record<string, unknown>>[];
}
function params(mutation: Readonly<Record<string, unknown>>, id: string, allowed: readonly string[]): Record<string, unknown> {
  if (mutation.id !== id || mutation.type !== undefined && mutation.type !== CommandType.MUTATION
    || Object.keys(mutation).some(key => !['id','type','params'].includes(key))) throw Error('The worksheet history native payload changed.');
  const value = mutation.params;
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !allowed.includes(key))) throw Error('The worksheet history native payload changed.');
  const data = value as Record<string, unknown>;
  if (data.trigger !== undefined && (typeof data.trigger !== 'string' || !/^[A-Za-z0-9_.-]{1,200}$/.test(data.trigger))) throw Error('The worksheet history native payload changed.');
  // Pinned CommandService._attachMutationTrigger rewrites ONLY this outer
  // routing field on native Undo/Redo. All sheet-inner data remains compared.
  const { trigger: _routing, ...content } = data;
  return content;
}
/** Data equality only. The caller must obtain the frozen projection from the
 * actual current SDK item, then independently prove its live issued identity. */
export function assertNativeWorkbookBirthHistory(data: NativeData, unitId: string, entry: WorkbookSheetBirthEntry, index: number): void {
  if (data.unitId !== unitId || data.undoMutations.length !== 1 || data.redoMutations.length !== 1) throw Error('The worksheet history native payload changed.');
  const undo = params(data.undoMutations[0]!, RemoveSheetMutation.id, ['unitId','subUnitId','subUnitName','trigger']);
  const redo = params(data.redoMutations[0]!, InsertSheetMutation.id, ['unitId','index','sheet','trigger']);
  const expectedUndo = { unitId, subUnitId: entry.descriptor.sheetId, subUnitName: entry.initialSheet.name };
  const expectedRedo = { unitId, index, sheet: entry.initialSheet };
  if (canonicalWorkbookJsonValue(undo) !== canonicalWorkbookJsonValue(expectedUndo)
    || canonicalWorkbookJsonValue(redo) !== canonicalWorkbookJsonValue(expectedRedo)) throw Error('The worksheet history native payload changed.');
}
