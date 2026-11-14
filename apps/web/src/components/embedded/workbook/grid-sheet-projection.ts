import { checkedWorkbookSheetBirths, blankWorkbookSheet, WORKBOOK_SHEET_BIRTH_MARKER, type WorkbookSheetBirthState } from './sheet-birth-context';
import { matchesWorkbookSourceSnapshot, type WorkbookSourceSnapshotBinding } from './source-snapshot-binding';
import type { WorkbookSaveAcknowledgement } from './save-provenance';
import type { WorkbookDraftScope } from './workbook-draft-schema';
import { assertWorkbookStructureIdentity } from './grid-structure-identity';
import { assertWorkbookScalarSnapshot } from './grid-scalar-admission';
import type { IWorkbookData } from '@univerjs/core';
import { workbookSourceSheetProjectionSchema, type WorkbookDocument } from '@open-design/contracts/runtime/workbook';
import { canonicalCommentJson, canonicalWorkbookSheetBaseline, workbookSheetBaseline } from '@open-design/contracts/runtime/workbook-sheet-baseline';
import { workbookSourceDeleteContextSchema, WORKBOOK_SHEET_DELETE_MARKER, type WorkbookSourceDeleteContext } from './sheet-delete-context';

/** Current continuity is an explicit checked-ACK owner input, not metadata on
 * an imported sheet. It is recomputed from the actual model and ACK snapshot;
 * this local consistency proof never authorizes historical asset access. */
export interface WorkbookSheetProjectionOwner {
  scope: WorkbookDraftScope;
  acknowledgement: WorkbookSaveAcknowledgement;
  binding: WorkbookSourceSnapshotBinding;
}

export interface WorkbookPlanContext {
  deletions?: readonly WorkbookSourceDeleteContext[] | undefined;
  births?: WorkbookSheetBirthState | undefined;
  sourceOwner?: WorkbookSheetProjectionOwner | undefined;
}

/** Derive source survivors and explicitly protected blank origins. A marker is
 * never a birth/restore grant; unknown and historical restoration still refuse. */
export function gridSourceSheetProjection(model: WorkbookDocument, sourceSha256: string, initial: IWorkbookData, current: IWorkbookData, context?: WorkbookPlanContext) {
  if (initial.id !== current.id) throw Error('Workbook identity changed.');
  const sourceIds = model.sheets.map(sheet => sheet.id), afterIds = current.sheetOrder;
  const changed = canonicalCommentJson(sourceIds) !== canonicalCommentJson(afterIds) || model.sheets.some(sheet => current.sheets[sheet.id] && current.sheets[sheet.id]!.name !== sheet.name);
  if (!changed) return null;
  if (model.sourceFormat === 'csv' || model.worksheetMembershipEditable !== true || !model.worksheetStructureEditable || model.calculationMetadata !== 'verified' || model.sheets.some(sheet => !sheet.arrayFormulas || sheet.arrayFormulas.length)) throw Error('Worksheet membership requires a qualified scalar source.');
  // These metadata owners need a separately qualified producer. Never filter
  // names/tables away to make a synthetic reduced workbook parse successfully.
  if (model.definedNames?.length || model.tables?.length) throw Error('Worksheet membership with defined names or tables is not ready.');
  if (canonicalCommentJson(Object.keys(initial.sheets).sort()) !== canonicalCommentJson([...sourceIds].sort()) || sourceIds.some(id => initial.sheets[id]?.id !== id) || afterIds.some(id => current.sheets[id]?.id !== id)) throw Error('Worksheet identity changed.');
  if (canonicalCommentJson(initial.sheetOrder) !== canonicalCommentJson(sourceIds)) throw Error('The source worksheet baseline changed.');
  if (new Set(afterIds).size !== afterIds.length || canonicalCommentJson([...afterIds].sort()) !== canonicalCommentJson(Object.keys(current.sheets).sort())) throw Error('Worksheet membership is inconsistent.');
  const births = context?.births ? checkedWorkbookSheetBirths(context.births, initial) : undefined;
  const entries = new Map(births?.entries.map(item => [item.descriptor.sheetId, item]));
  for (const id of afterIds.filter(id => !sourceIds.includes(id))) {
    const item = entries.get(id);
    if (current.sheets[id]!.custom?.[WORKBOOK_SHEET_DELETE_MARKER] !== undefined) throw Error('A restored worksheet requires its checked historical template owner.');
    if (!item || canonicalCommentJson(current.sheets[id]!.custom?.[WORKBOOK_SHEET_BIRTH_MARKER]) !== canonicalCommentJson(item.descriptor)) throw Error('A new or restored worksheet requires its own protected owner.');
  }
  if (canonicalCommentJson(sourceIds.filter(id => afterIds.includes(id))) !== canonicalCommentJson(afterIds.filter(id => sourceIds.includes(id)))) throw Error('Reordering source worksheets is unsupported.');
  assertWorkbookStructureIdentity(initial); assertWorkbookStructureIdentity(current);
  const checked = (context?.deletions ?? []).map(value => workbookSourceDeleteContextSchema.parse(value));
  const owner = context?.sourceOwner;
  const carriedSource = owner && matchesWorkbookSourceSnapshot({
    version: 1, source: { model, sourceSha256 }, acknowledged: initial, desired: initial,
    pending: null, sourceAcknowledgement: owner.acknowledgement, sourceSnapshotBinding: owner.binding,
  }, owner.scope, { model, sourceSha256 });
  for (const id of sourceIds.filter(id => !afterIds.includes(id))) {
    if (model.sheets.find(sheet => sheet.id === id)!.visibility === 'veryHidden') throw Error('A very hidden worksheet cannot be deleted here.');
    const matches = checked.filter(value => {
      if (value.descriptor.sheetId !== id) return false;
      if (value.sourceSha256 === sourceSha256) return true;
      return Boolean(carriedSource && owner && value.receiptAssociation
        && owner.scope.viewerId === value.scope.viewerId
        && owner.scope.projectId === value.scope.projectId && owner.scope.fileName === value.scope.fileName);
    });
    if (matches.length !== 1) throw Error('The deleted worksheet has no unique current-source context.');
    const context = matches[0]!;
    const sameAxisOwner = canonicalCommentJson(context.axisOwner) === canonicalCommentJson(initial.custom?.evebotStructureOwner);
    const sameArtifact = `${context.scope.projectId}:${context.scope.fileName}` === initial.id;
    if (!sameAxisOwner || !sameArtifact) throw Error('The deleted worksheet source or ACK context changed.');
    if (context.sourceSha256 === sourceSha256 && (
      canonicalCommentJson(context.acknowledgedSheet) !== canonicalCommentJson(initial.sheets[id])
      || canonicalWorkbookSheetBaseline(context.baseline) !== canonicalWorkbookSheetBaseline(workbookSheetBaseline(model, id))
    )) throw Error('The deleted worksheet source or ACK context changed.');
  }
  assertWorkbookScalarSnapshot(current);
  const sheets = workbookSourceSheetProjectionSchema.parse(afterIds.map(id => ({ sheetId: id, name: current.sheets[id]!.name, origin: sourceIds.includes(id) ? 'source' : 'new' })));
  const before = structuredClone(initial), after = structuredClone(current), projected = structuredClone(model);
  before.sheetOrder = [...afterIds];
  before.sheets = Object.fromEntries(afterIds.map(id => [id, before.sheets[id] ?? structuredClone(entries.get(id)!.initialSheet)]));
  projected.sheets = afterIds.map(id => {
    const sheet = projected.sheets.find(sheet => sheet.id === id) ?? blankWorkbookSheet(id, current.sheets[id]!.name!);
    sheet.name = current.sheets[id]!.name!;
    before.sheets[id]!.name = sheet.name;
    return sheet;
  });
  const active = projected.sheets.find(sheet => sheet.id === model.activeSheetId && current.sheets[sheet.id]?.hidden !== 1 && current.sheets[sheet.id]?.hidden !== 2)
    ?? projected.sheets.find(sheet => current.sheets[sheet.id]?.hidden !== 1 && current.sheets[sheet.id]?.hidden !== 2);
  if (!active) throw Error('Keep at least one worksheet visible.');
  projected.activeSheetId = active.id;
  return { model: projected, before, after, sheets };
}
