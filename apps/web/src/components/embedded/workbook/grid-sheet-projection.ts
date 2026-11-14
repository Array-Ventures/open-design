import { appendRestoredSheetModel } from './grid-restored-sheet';
import { checkedWorkbookBirthRemovals } from './sheet-birth-removal';
import type { WorkbookCheckpoint } from './workbook-writer';
import { workbookSheetRemovalSelection } from './sheet-removal-selection';
import { checkedWorkbookSheetBirths, blankWorkbookSheet, WORKBOOK_SHEET_BIRTH_MARKER, type WorkbookSheetBirthState } from './sheet-birth-context';
import { matchesWorkbookSourceSnapshot, type WorkbookSourceSnapshotBinding } from './source-snapshot-binding';
import type { WorkbookSaveAcknowledgement } from './save-provenance';
import type { WorkbookDraftScope } from './workbook-draft-schema';
import { assertWorkbookStructureIdentity } from './grid-structure-identity';
import { assertWorkbookScalarSnapshot } from './grid-scalar-admission';
import type { IWorkbookData } from '@univerjs/core';
import { workbookSheetProjectionSchema, workbookDocumentSchema, type WorkbookDocument } from '@open-design/contracts/runtime/workbook';
import { canonicalCommentJson, canonicalWorkbookSheetBaseline, workbookSheetBaseline } from '@open-design/contracts/runtime/workbook-sheet-baseline';
import { workbookSourceDeleteContextSchema, workbookSourceDeletionTemplate, workbookSourceDeletionBaselineIdentity, WORKBOOK_SHEET_DELETE_MARKER, type WorkbookSourceDeleteContext } from './sheet-delete-context';

/** Current continuity is an explicit checked-ACK owner input, not metadata on
 * an imported sheet. It is recomputed from the actual model and ACK snapshot;
 * this local consistency proof never authorizes historical asset access. */
export interface WorkbookSheetProjectionOwner {
  scope: WorkbookDraftScope;
  acknowledgement: WorkbookSaveAcknowledgement;
  binding: WorkbookSourceSnapshotBinding;
}

export interface WorkbookPlanContext {
  scope?: WorkbookDraftScope | undefined;
  pending?: WorkbookCheckpoint['pending'] | undefined;
  deletions?: readonly WorkbookSourceDeleteContext[] | undefined;
  births?: WorkbookSheetBirthState | undefined;
  sourceOwner?: WorkbookSheetProjectionOwner | undefined;
}

/** Validate every selected retained reference, including a clean desired view.
 * Scope is supplied by the current caller, never inferred from stored contexts.
 * This is data consistency only; source eligibility and template authorization
 * remain independent checks at their existing owners. */
export function checkedWorkbookRemovalContexts(snapshot: IWorkbookData, initial: IWorkbookData, context?: WorkbookPlanContext, source?: WorkbookCheckpoint['source']) {
  const generation = initial.custom?.evebotStructureOwner?.generation;
  const selection = workbookSheetRemovalSelection(snapshot, typeof generation === 'string' ? generation : '');
  const checked = (context?.deletions ?? []).map(value => workbookSourceDeleteContextSchema.parse(value));
  const scope = context?.scope ?? context?.sourceOwner?.scope;
  const births = context?.births ? checkedWorkbookSheetBirths(context.births, initial) : undefined;
  if (births?.removals?.length) {
    if (!scope || !source) throw Error('The birth removals have no current source or scope.');
    checkedWorkbookBirthRemovals(scope, { version: 1, source, acknowledged: initial, desired: snapshot,
      pending: context?.pending ?? null, sheetBirths: context!.births,
      ...(context?.sourceOwner ? { sourceAcknowledgement: context.sourceOwner.acknowledgement, sourceSnapshotBinding: context.sourceOwner.binding } : {}),
    });
  }
  for (const [id, token] of Object.entries(selection)) {
    if (!scope || snapshot.id !== initial.id || `${scope.projectId}:${scope.fileName}` !== initial.id) throw Error('The worksheet removal selection has no current scope.');
    const matches = checked.filter(value => value.descriptor.sheetId === id && value.descriptor.token === token);
    const provisional = births?.removals?.filter(value => value.descriptor.sheetId === id && value.descriptor.token === token) ?? [];
    if (matches.length + provisional.length !== 1) throw Error('The worksheet removal selection has no unique retained context.');
    if (provisional.length) continue;
    const value = matches[0]!;
    if (value.scope.viewerId !== scope.viewerId || value.scope.projectId !== scope.projectId || value.scope.fileName !== scope.fileName
      || canonicalCommentJson(value.axisOwner) !== canonicalCommentJson(initial.custom?.evebotStructureOwner)) throw Error('The worksheet removal selection changed scope or generation.');
  }
  return { selection, checked, births };
}

/** Derive source survivors, protected blank origins and explicit retained
 * template data. Markers never grant birth, native history or asset authority. */
export function gridSourceSheetProjection(model: WorkbookDocument, sourceSha256: string, initial: IWorkbookData, current: IWorkbookData, context?: WorkbookPlanContext) {
  if (initial.id !== current.id) throw Error('Workbook identity changed.');
  const { selection, checked, births } = checkedWorkbookRemovalContexts(current, initial, context, { model, sourceSha256 });
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
  const entries = new Map(births?.entries.map(item => [item.descriptor.sheetId, item]));
  const restored = new Map<string, WorkbookSourceDeleteContext>();
  for (const id of afterIds.filter(id => !sourceIds.includes(id))) {
    const item = entries.get(id);
    const removal = current.sheets[id]!.custom?.[WORKBOOK_SHEET_DELETE_MARKER];
    const provisional = removal !== undefined && births?.removals?.some(value => value.descriptor.sheetId === id
      && canonicalCommentJson(value.descriptor) === canonicalCommentJson(removal)
      && value.birthToken === item?.descriptor.token);
    // Conversion must not invalidate the already frozen creation while its ACK
    // is being protected. This is the SAME origin:new operation, not a general
    // historical restore or a grant from a marker/receipt stored in metadata.
    const pending = context?.pending, scope = context?.scope ?? context?.sourceOwner?.scope;
    const converted = removal !== undefined && checked.some(value => {
      const origin = value.birthOrigin, receipt = value.receiptAssociation, acknowledgement = pending?.acknowledgement;
      if (!origin || !receipt || !pending || !scope || !item || !pending.snapshot.sheets[id] || acknowledgement?.kind !== 'history') return false;
      return value.descriptor.sheetId === id && canonicalCommentJson(value.descriptor) === canonicalCommentJson(removal)
        && origin.birthToken === item?.descriptor.token && origin.creation.operationId === pending.intent.id
        && origin.creation.sourceSha256 === sourceSha256 && pending.intent.plan.sourceSha256 === sourceSha256
        && receipt.renderId === pending.intent.renderId && canonicalCommentJson(receipt) === canonicalCommentJson(acknowledgement.provenance)
        && value.scope.viewerId === scope.viewerId && value.scope.projectId === scope.projectId && value.scope.fileName === scope.fileName
        && canonicalCommentJson(value.axisOwner) === canonicalCommentJson(initial.custom?.evebotStructureOwner)
        && pending.intent.plan.sheets?.some(sheet => sheet.sheetId === id && sheet.origin === 'new')
        && canonicalCommentJson(pending.snapshot.sheets[id]?.custom?.[WORKBOOK_SHEET_BIRTH_MARKER]) === canonicalCommentJson(item?.descriptor);
    });
    if (removal !== undefined && !provisional && !converted) {
      const matches = checked.filter(value => value.descriptor.sheetId === id && canonicalCommentJson(value.descriptor) === canonicalCommentJson(removal));
      const value = matches[0];
      if (!scope || matches.length !== 1 || !value || value.scope.viewerId !== scope.viewerId
        || value.scope.projectId !== scope.projectId || value.scope.fileName !== scope.fileName
        || canonicalCommentJson(value.axisOwner) !== canonicalCommentJson(initial.custom?.evebotStructureOwner)) throw Error('The restored worksheet has no unique scoped historical context.');
      // This selects data for the existing authorized frozen-history API; the
      // context/receipt alone never grants a native Undo or historical access.
      workbookSourceDeletionTemplate(value); workbookSourceDeletionBaselineIdentity(value);
      restored.set(id, value); continue;
    }
    if (!item || canonicalCommentJson(current.sheets[id]!.custom?.[WORKBOOK_SHEET_BIRTH_MARKER]) !== canonicalCommentJson(item.descriptor)) throw Error('A new or restored worksheet requires its own protected owner.');
  }
  if (canonicalCommentJson(sourceIds.filter(id => afterIds.includes(id))) !== canonicalCommentJson(afterIds.filter(id => sourceIds.includes(id)))) throw Error('Reordering source worksheets is unsupported.');
  assertWorkbookStructureIdentity(initial); assertWorkbookStructureIdentity(current);
  const owner = context?.sourceOwner;
  const carriedSource = owner && matchesWorkbookSourceSnapshot({
    version: 1, source: { model, sourceSha256 }, acknowledged: initial, desired: initial,
    pending: null, sourceAcknowledgement: owner.acknowledgement, sourceSnapshotBinding: owner.binding,
  }, owner.scope, { model, sourceSha256 });
  for (const id of sourceIds.filter(id => !afterIds.includes(id))) {
    if (model.sheets.find(sheet => sheet.id === id)!.visibility === 'veryHidden') throw Error('A very hidden worksheet cannot be deleted here.');
    const matches = checked.filter(value => {
      if (value.descriptor.sheetId !== id || selection[id] !== undefined && value.descriptor.token !== selection[id]) return false;
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
  const sheets = workbookSheetProjectionSchema.parse(afterIds.map(id => {
    const context = restored.get(id);
    return context ? { sheetId: id, name: current.sheets[id]!.name, origin: 'restore', template: workbookSourceDeletionTemplate(context), baselineIdentity: workbookSourceDeletionBaselineIdentity(context) }
      : { sheetId: id, name: current.sheets[id]!.name, origin: sourceIds.includes(id) ? 'source' : 'new' };
  }));
  const before = structuredClone(initial), after = structuredClone(current), projected = structuredClone(model);
  before.sheetOrder = [...afterIds];
  before.sheets = Object.fromEntries(afterIds.map(id => {
    // The protected JSON snapshot also permits null sparse cells. Existing
    // grid readers treat these as blank; this does not convert model styles or
    // reinterpret the historical source. The context schema was checked above.
    const historical = restored.get(id)?.acknowledgedSheet as IWorkbookData['sheets'][string] | undefined;
    return [id, before.sheets[id] ?? structuredClone(historical ?? entries.get(id)!.initialSheet)];
  }));
  for (const context of restored.values()) appendRestoredSheetModel(projected, context);
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
  return { model: workbookDocumentSchema.parse(projected), before, after, sheets, restored };
}
