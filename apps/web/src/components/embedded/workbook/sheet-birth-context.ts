import { z } from 'zod';
import { mergeWorksheetSnapshotWithDefault, type IWorkbookData, type IWorksheetData } from '@univerjs/core';
import { canonicalWorkbookJsonValue } from '@open-design/contracts/runtime/workbook-sheet-baseline';
import { WORKBOOK_MINIMUM_SHEET_WINDOW, WORKBOOK_SHEET_ID_MAX, workbookCommitRequestSchema, workbookSourceSheetProjectionSchema, type WorkbookSheet } from '@open-design/contracts/runtime/workbook';
import { workbookDraftScopeSchema, workbookGridSnapshotSchema, type WorkbookDraftScope } from './workbook-draft-schema';
import { workbookSheetActionDescriptorSchema, type WorkbookSheetActionDescriptor } from './sheet-action-descriptor';
import { assertWorkbookStructureIdentity, seedWorkbookNewSheetIdentity } from './grid-structure-identity';
import type { WorkbookCheckpoint } from './workbook-writer';
import { captureWorkbookDeletionBaseline, associateWorkbookSourceDeletion } from './sheet-delete-context';
import { workbookSaveAcknowledgementSchema, type WorkbookSaveAcknowledgement } from './save-provenance';
import { gridWorkbook } from './grid-model';
import { assertWorkbookSourceSnapshotInputs } from './source-snapshot-inputs';

export const WORKBOOK_SHEET_BIRTH_MARKER = 'evebotSheetBirth';
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const descriptor = workbookSheetActionDescriptorSchema;
const entry = z.object({ descriptor, initialSheet: workbookGridSnapshotSchema.shape.sheets.valueSchema }).strict();
/** These protected records are data, not evidence that this kernel issued a
 * command. Only the live generation's issuer can admit native birth/history. */
const birthState = z.object({
  version: z.literal(1), scope: workbookDraftScopeSchema.omit({ draftId: true }).extend({ fileName: workbookCommitRequestSchema.shape.fileName }),
  axisOwner: z.object({ generation: z.string().uuid(), sourceSha256: digest }).strict(),
  highWaterId: z.number().int().min(1).max(WORKBOOK_SHEET_ID_MAX),
  entries: z.array(entry).max(4096),
}).strict().superRefine((state, check) => {
  const ids = new Set<string>(), tokens = new Set<string>();
  for (const item of state.entries) {
    if (item.descriptor.generation !== state.axisOwner.generation || item.descriptor.sheetId !== item.initialSheet.id
      || Number(item.descriptor.sheetId) > state.highWaterId || ids.has(item.descriptor.sheetId) || tokens.has(item.descriptor.token)) {
      check.addIssue({ code: 'custom', message: 'The worksheet birth state identity changed.' });
    }
    ids.add(item.descriptor.sheetId); tokens.add(item.descriptor.token);
  }
});
export const workbookSheetBirthStateSchema = z.preprocess(raw => { canonicalWorkbookJsonValue(raw); return raw; }, birthState);
export type WorkbookSheetBirthState = z.infer<typeof workbookSheetBirthStateSchema>;
export interface WorkbookSheetBirthEntry { descriptor: z.infer<typeof descriptor>; initialSheet: IWorksheetData }
export type ValidatedWorkbookSheetBirthState = Omit<WorkbookSheetBirthState, 'entries'> & { entries: WorkbookSheetBirthEntry[] };

/** The source owner emits an ordinary empty worksheet. Its reader and this
 * virtual baseline share the same minimum window; neither invents source cells. */
export function blankWorkbookSheet(id: string, name: string): WorkbookSheet {
  workbookSourceSheetProjectionSchema.parse([{ sheetId: id, name, origin: 'new' }]);
  return { id, name, visibility: 'visible', rowCount: WORKBOOK_MINIMUM_SHEET_WINDOW.rows,
    columnCount: WORKBOOK_MINIMUM_SHEET_WINDOW.columns, cells: [], merges: [], rowDimensions: [],
    columnDimensions: [], frozenRows: 0, frozenColumns: 0, arrayFormulas: [] };
}

function blankNativeSheet(book: IWorkbookData, value: z.infer<typeof descriptor>, name: string) {
  blankWorkbookSheet(value.sheetId, name);
  const without = { ...book, sheetOrder: book.sheetOrder.filter(id => id !== value.sheetId),
    sheets: Object.fromEntries(Object.entries(book.sheets).filter(([id]) => id !== value.sheetId)) };
  return seedWorkbookNewSheetIdentity(without, mergeWorksheetSnapshotWithDefault({
    id: value.sheetId, name, rowCount: WORKBOOK_MINIMUM_SHEET_WINDOW.rows,
    columnCount: WORKBOOK_MINIMUM_SHEET_WINDOW.columns, defaultStyle: '0',
    cellData: {}, rowData: {}, columnData: {}, custom: { [WORKBOOK_SHEET_BIRTH_MARKER]: value },
  }));
}

/** Validate the actual baseline, not merely its token or a source custom field. */
export function checkedWorkbookSheetBirths(raw: WorkbookSheetBirthState, book: IWorkbookData): ValidatedWorkbookSheetBirthState {
  const state = workbookSheetBirthStateSchema.parse(raw);
  assertWorkbookStructureIdentity(book);
  if (`${state.scope.projectId}:${state.scope.fileName}` !== book.id
    || canonicalWorkbookJsonValue(state.axisOwner) !== canonicalWorkbookJsonValue(book.custom?.evebotStructureOwner)) throw Error('The worksheet birth state changed workbook or generation.');
  // Template equality owns one blank view, not every live source axis. Avoid
  // rescanning the whole workbook for each retained native-history origin.
  const templateBook: IWorkbookData = { ...book, sheetOrder: [], sheets: {} };
  for (const id of book.sheetOrder) if (!/^[1-9][0-9]{0,4}$/.test(id) || Number(id) > state.highWaterId) throw Error('The worksheet birth high-water identity changed.');
  const entries: WorkbookSheetBirthEntry[] = [];
  for (const item of state.entries) {
    const expected = blankNativeSheet(templateBook, item.descriptor, item.initialSheet.name!);
    if (canonicalWorkbookJsonValue(expected) !== canonicalWorkbookJsonValue(item.initialSheet)) throw Error('The worksheet birth blank baseline changed.');
    entries.push({ descriptor: item.descriptor, initialSheet: expected });
  }
  return { ...state, entries };
}

/** Prepare a bounded numeric origin before a command captures redo. The caller
 * must durably protect this state and verify live issuer/lease ownership before
 * running the real SDK command. This function does not grant that authority. */
export function prepareWorkbookSheetBirth(scope: WorkbookDraftScope, checkpoint: WorkbookCheckpoint, name: string, index: number, previous?: WorkbookSheetBirthState) {
  const checkedScope = workbookDraftScopeSchema.parse(scope), before = checkpoint.desired;
  assertWorkbookStructureIdentity(before);
  if (checkpoint.pending) throw Error('Pending birth ownership is not connected yet.');
  workbookCommitRequestSchema.shape.fileName.parse(checkedScope.fileName);
  const unitId = `${checkedScope.projectId}:${checkedScope.fileName}`;
  if (before.id !== unitId || checkpoint.acknowledged.id !== unitId) throw Error('The worksheet birth belongs to another workbook.');
  const model = checkpoint.source.model;
  if (model.sourceFormat === 'csv' || !model.worksheetStructureEditable || model.calculationMetadata !== 'verified'
    || model.sheets.some(sheet => !sheet.arrayFormulas || sheet.arrayFormulas.length) || model.definedNames?.length || model.tables?.length) throw Error('Worksheet birth requires a qualified scalar source.');
  assertWorkbookStructureIdentity(checkpoint.acknowledged);
  assertWorkbookSourceSnapshotInputs(gridWorkbook(model, unitId, 'Workbook').data as IWorkbookData, checkpoint.acknowledged, unitId);
  if (canonicalWorkbookJsonValue(before.custom?.evebotStructureOwner) !== canonicalWorkbookJsonValue(checkpoint.acknowledged.custom?.evebotStructureOwner)) throw Error('The worksheet birth kernel changed.');
  if (!Number.isSafeInteger(index) || index < 0 || index > before.sheetOrder.length) throw Error('The worksheet insertion position changed.');
  const owned = previous ? checkedWorkbookSheetBirths(previous, checkpoint.acknowledged) : undefined;
  if (owned && canonicalWorkbookJsonValue(owned.scope) !== canonicalWorkbookJsonValue({ viewerId: checkedScope.viewerId, projectId: checkedScope.projectId, fileName: checkedScope.fileName })) throw Error('The worksheet birth scope changed.');
  const sourceIds = model.sheets.map(sheet => sheet.id), issuedIds = new Set(owned?.entries.map(item => item.descriptor.sheetId));
  if (before.sheetOrder.some(id => !sourceIds.includes(id) && !issuedIds.has(id))) throw Error('An existing worksheet has no protected birth origin.');
  const ids = [...sourceIds, ...before.sheetOrder];
  for (const id of ids) if (!/^[1-9][0-9]{0,4}$/.test(id) || Number(id) > WORKBOOK_SHEET_ID_MAX) throw Error('Worksheet birth requires numeric source identities.');
  const highWaterId = Math.max(owned?.highWaterId ?? 0, ...ids.map(Number));
  if (highWaterId >= WORKBOOK_SHEET_ID_MAX) throw Error('The worksheet identity space is exhausted.');
  const value = descriptor.parse({ version: 1, token: crypto.randomUUID(), generation: (before.custom!.evebotStructureOwner as { generation: string }).generation, sheetId: String(highWaterId + 1) });
  const initialSheet = blankNativeSheet(before, value, name);
  const snapshot = structuredClone(before);
  snapshot.sheets[value.sheetId] = structuredClone(initialSheet);
  snapshot.sheetOrder.splice(index, 0, value.sheetId);
  workbookSourceSheetProjectionSchema.parse(snapshot.sheetOrder.map(sheetId => ({ sheetId, name: snapshot.sheets[sheetId]!.name, origin: 'new' })));
  const state = workbookSheetBirthStateSchema.parse({ version: 1,
    scope: { viewerId: checkedScope.viewerId, projectId: checkedScope.projectId, fileName: checkedScope.fileName },
    axisOwner: before.custom!.evebotStructureOwner, highWaterId: highWaterId + 1,
    entries: [...(owned?.entries ?? []), { descriptor: value, initialSheet }],
  });
  return { state, entry: { descriptor: value, initialSheet } satisfies WorkbookSheetBirthEntry, snapshot };
}


/** Bind only a frozen owned creation intent to its checked saved target. A
 * current desired snapshot can already omit this birth; it never supplies the
 * target baseline. This derives protected data, not live issuer authority. */
export function captureWorkbookSavedBirthDeletion(scope: WorkbookDraftScope, before: WorkbookCheckpoint,
  target: WorkbookCheckpoint['source'], rawAcknowledgement: WorkbookSaveAcknowledgement,
  rawRemoval: WorkbookSheetActionDescriptor) {
  const checkedScope = workbookDraftScopeSchema.parse(scope);
  const checked = workbookSaveAcknowledgementSchema.parse(rawAcknowledgement);
  const pending = before.pending;
  if (!pending || checked.kind !== 'history') throw Error('A pending birth requires its checked target receipt.');
  if (pending.acknowledgement && canonicalWorkbookJsonValue(pending.acknowledgement) !== canonicalWorkbookJsonValue(checked)) throw Error('The checked birth receipt changed while protected.');
  const removal = descriptor.parse(rawRemoval);
  if (!before.sheetBirths) throw Error('The pending creation has no protected birth state.');
  const births = checkedWorkbookSheetBirths(before.sheetBirths, before.acknowledged);
  if (births.scope.viewerId !== checkedScope.viewerId || births.scope.projectId !== checkedScope.projectId || births.scope.fileName !== checkedScope.fileName) throw Error('The pending birth scope changed.');
  const birth = births.entries.find(item => item.descriptor.sheetId === removal.sheetId);
  if (!birth) throw Error('The pending creation has no protected birth origin.');
  const proof = checked.provenance, id = birth.descriptor.sheetId;
  const selected = pending.snapshot.sheets[id];
  if (proof.operationId !== pending.intent.id || proof.renderId !== pending.intent.renderId
    || proof.sourceSha256 !== before.source.sourceSha256 || proof.sourceSha256 !== pending.intent.plan.sourceSha256
    || proof.targetSha256 !== target.sourceSha256 || proof.projectId !== checkedScope.projectId || proof.fileName !== checkedScope.fileName) throw Error('The saved birth receipt changed source, target or operation.');
  if (before.source.model.sheets.some(sheet => sheet.id === id) || before.acknowledged.sheets[id]
    || !selected || !pending.intent.plan.sheets?.some(sheet => sheet.sheetId === id && sheet.origin === 'new')
    || canonicalWorkbookJsonValue(selected.custom?.[WORKBOOK_SHEET_BIRTH_MARKER]) !== canonicalWorkbookJsonValue(birth.descriptor)) throw Error('The pending creation has no exact protected birth origin.');
  if (removal.sheetId !== id || removal.generation !== birth.descriptor.generation || removal.token === birth.descriptor.token) throw Error('The pending birth removal descriptor changed.');
  const captured = captureWorkbookDeletionBaseline(checkedScope, target, pending.snapshot, id, removal);
  return associateWorkbookSourceDeletion(captured, checked, 'saved-target');
}
