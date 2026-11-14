import { canonicalWorkbookJsonValue } from '@open-design/contracts/runtime/workbook-sheet-baseline';
import type { WorkbookCheckpoint } from './workbook-writer';
import type { WorkbookSheetActionDescriptor } from './sheet-action-descriptor';
import { workbookSourceDeleteContextSchema, withWorkbookRemovedConfiguration, workbookSourceDeletionTemplate,
  WORKBOOK_SHEET_DELETE_MARKER, type WorkbookSourceDeleteContext } from './sheet-delete-context';

function backing(context: WorkbookSourceDeleteContext) {
  const { descriptor: _descriptor, removedSheet: _removedSheet, removedIndex: _removedIndex, ...immutable } = context;
  return canonicalWorkbookJsonValue(immutable);
}

/** Data derivation only. A live controller must independently prove that it
 * issued the ancestor and recheck that authority after durable storage. */
export function deriveWorkbookRestoredDeletion(state: WorkbookCheckpoint, origin: WorkbookSheetActionDescriptor): WorkbookSourceDeleteContext {
  const matches = state.sheetDeletions?.filter(value => canonicalWorkbookJsonValue(value.descriptor) === canonicalWorkbookJsonValue(origin)) ?? [];
  if (matches.length !== 1) throw Error('The restored deletion has no unique retained ancestor.');
  const ancestor = workbookSourceDeleteContextSchema.parse(matches[0]);
  workbookSourceDeletionTemplate(ancestor);
  const sheet = state.desired.sheets[origin.sheetId], index = state.desired.sheetOrder.indexOf(origin.sheetId);
  if (!sheet || index < 0 || state.source.model.sheets.some(value => value.id === origin.sheetId)
    || canonicalWorkbookJsonValue(sheet.custom?.[WORKBOOK_SHEET_DELETE_MARKER]) !== canonicalWorkbookJsonValue(origin)) throw Error('The selected restored worksheet changed its ancestor.');
  const descriptor = { ...origin, token: crypto.randomUUID() };
  return withWorkbookRemovedConfiguration({ ...ancestor, descriptor }, sheet, index);
}

/** Strict same-backing selection proof, never a generic stale-checksum escape. */
export function assertDerivedWorkbookDeletion(state: WorkbookCheckpoint, raw: WorkbookSourceDeleteContext, origin: WorkbookSheetActionDescriptor): void {
  const candidate = workbookSourceDeleteContextSchema.parse(raw);
  const matches = state.sheetDeletions?.filter(value => canonicalWorkbookJsonValue(value.descriptor) === canonicalWorkbookJsonValue(origin)) ?? [];
  if (matches.length !== 1) throw Error('The restored deletion has no unique retained ancestor.');
  const ancestor = workbookSourceDeleteContextSchema.parse(matches[0]);
  workbookSourceDeletionTemplate(ancestor);
  const selected = state.desired.sheets[origin.sheetId];
  if (candidate.descriptor.token === origin.token || candidate.descriptor.sheetId !== origin.sheetId
    || candidate.descriptor.generation !== origin.generation || backing(candidate) !== backing(ancestor)
    || !selected || state.source.model.sheets.some(value => value.id === origin.sheetId)
    || canonicalWorkbookJsonValue(selected.custom?.[WORKBOOK_SHEET_DELETE_MARKER]) !== canonicalWorkbookJsonValue(origin)
    || candidate.removedIndex !== state.desired.sheetOrder.indexOf(origin.sheetId)
    || canonicalWorkbookJsonValue(candidate.removedSheet) !== canonicalWorkbookJsonValue(selected)) throw Error('The restored deletion changed its selected configuration or immutable backing.');
}
