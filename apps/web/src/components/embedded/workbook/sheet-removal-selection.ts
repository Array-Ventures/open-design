import { MAX_WORKBOOK_SHEET_CONTEXTS } from './workbook-draft-limits';
import { z } from 'zod';
import type { IWorkbookData } from '@univerjs/core';
import { canonicalWorkbookJsonValue } from '@open-design/contracts/runtime/workbook-sheet-baseline';
import { workbookActionSheetIdSchema, workbookSheetActionDescriptorSchema, type WorkbookSheetActionDescriptor } from './sheet-action-descriptor';
import { workbookGridSnapshotSchema } from './workbook-draft-schema';

export const WORKBOOK_SHEET_REMOVALS = 'evebotSheetRemovals';
const removalMapSchema = z.object({
  version: z.literal(1), generation: z.string().uuid(),
  entries: z.record(workbookActionSheetIdSchema, z.string().uuid()),
}).strict().refine(value => Object.keys(value.entries).length <= MAX_WORKBOOK_SHEET_CONTEXTS
  && new Set(Object.values(value.entries)).size === Object.keys(value.entries).length);
export type WorkbookSheetMutationKind = 'insert' | 'remove' | 'rename';

/** Projection selection data only. Issuance, history and historical-file access
 * are separately owned; parsing this metadata never grants an SDK action. */
export function workbookSheetRemovalSelection(snapshot: IWorkbookData, generation: string): Readonly<Record<string, string>> {
  const raw = snapshot.custom?.[WORKBOOK_SHEET_REMOVALS];
  if (raw === undefined) return {};
  canonicalWorkbookJsonValue(raw);
  const map = removalMapSchema.parse(raw);
  if (map.generation !== generation || Object.keys(map.entries).some(id => snapshot.sheets[id] || snapshot.sheetOrder.includes(id))) {
    throw Error('The worksheet removal selection changed generation or membership.');
  }
  return Object.freeze(map.entries);
}

/** Build the exact prospective metadata through the same helper used by the
 * synchronous native owner. The caller must durably validate this full result
 * through the existing Writer before invoking the native callback. */
export function workbookSheetMutationSnapshot(before: IWorkbookData, after: IWorkbookData,
  kind: WorkbookSheetMutationKind, raw: WorkbookSheetActionDescriptor): IWorkbookData {
  if (kind !== 'insert' && kind !== 'remove' && kind !== 'rename') throw Error('Unknown worksheet mutation kind.');
  const descriptor = workbookSheetActionDescriptorSchema.parse(raw);
  canonicalWorkbookJsonValue(before); canonicalWorkbookJsonValue(after);
  workbookGridSnapshotSchema.parse(before); workbookGridSnapshotSchema.parse(after);
  if (before.id !== after.id || descriptor.generation !== before.custom?.evebotStructureOwner?.generation
    || descriptor.generation !== after.custom?.evebotStructureOwner?.generation) throw Error('The worksheet mutation generation changed.');
  const entries = { ...workbookSheetRemovalSelection(before, descriptor.generation) };
  const id = descriptor.sheetId;
  if (kind === 'remove') {
    if (!before.sheets[id] || after.sheets[id] || after.sheetOrder.includes(id)) throw Error('The worksheet removal target changed.');
    entries[id] = descriptor.token;
  } else if (kind === 'insert') {
    if (before.sheets[id] || !after.sheets[id] || !after.sheetOrder.includes(id)) throw Error('The worksheet insertion target changed.');
    delete entries[id];
  } else if (!before.sheets[id] || !after.sheets[id]
    || canonicalWorkbookJsonValue(before.sheetOrder) !== canonicalWorkbookJsonValue(after.sheetOrder)
    || canonicalWorkbookJsonValue(Object.keys(before.sheets).sort()) !== canonicalWorkbookJsonValue(Object.keys(after.sheets).sort())) {
    throw Error('The worksheet rename membership changed.');
  }
  const next = structuredClone(after);
  next.custom = { ...next.custom };
  if (Object.keys(entries).length) next.custom[WORKBOOK_SHEET_REMOVALS] = removalMapSchema.parse({ version: 1, generation: descriptor.generation, entries });
  else delete next.custom[WORKBOOK_SHEET_REMOVALS];
  workbookSheetRemovalSelection(next, descriptor.generation);
  return next;
}

