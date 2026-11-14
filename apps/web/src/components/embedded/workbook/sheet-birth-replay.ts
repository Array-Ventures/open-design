import type { IWorkbookData } from '@univerjs/core';
import { canonicalWorkbookJsonValue } from '@open-design/contracts/runtime/workbook-sheet-baseline';
import { assertWorkbookBirthSource, checkedWorkbookSheetBirths } from './sheet-birth-context';
import { workbookSheetActionDescriptorSchema, type WorkbookSheetActionDescriptor } from './sheet-action-descriptor';
import { workbookSheetMutationSnapshot } from './sheet-removal-selection';
import type { WorkbookCheckpoint } from './workbook-writer';
import type { WorkbookDraftScope } from './workbook-draft-schema';

/** Native Add Redo replays its immutable blank birth, never a removed desired
 * sheet or historical template. This validates data; live issuance and native
 * top-entry ownership must be independently checked by the controller. */
export function prepareWorkbookBirthReplay(scope: WorkbookDraftScope, state: WorkbookCheckpoint, raw: WorkbookSheetActionDescriptor, index: number): IWorkbookData {
  assertWorkbookBirthSource(scope, state);
  if (!state.sheetBirths) throw Error('The worksheet has no protected birth.');
  const births = checkedWorkbookSheetBirths(state.sheetBirths, state.acknowledged);
  const descriptor = workbookSheetActionDescriptorSchema.parse(raw);
  const entry = births.entries.find(value => canonicalWorkbookJsonValue(value.descriptor) === canonicalWorkbookJsonValue(descriptor));
  if (!entry || births.scope.viewerId !== scope.viewerId || births.scope.projectId !== scope.projectId || births.scope.fileName !== scope.fileName) throw Error('The worksheet birth replay changed ownership.');
  const before = state.desired, id = descriptor.sheetId;
  if (before.sheets[id] || before.sheetOrder.includes(id) || !Number.isInteger(index) || index < 0 || index > before.sheetOrder.length) throw Error('The worksheet birth replay target changed.');
  const after = structuredClone(before);
  after.sheets[id] = structuredClone(entry.initialSheet);
  after.sheetOrder.splice(index, 0, id);
  return workbookSheetMutationSnapshot(before, after, 'insert', descriptor);
}
