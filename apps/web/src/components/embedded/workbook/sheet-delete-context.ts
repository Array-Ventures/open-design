import { MAX_WORKBOOK_DRAFT_BYTES } from './workbook-draft-limits';
import { z } from 'zod';
import { workbookActionSheetIdSchema, workbookSheetActionDescriptorSchema as workbookSheetDeleteDescriptorSchema } from './sheet-action-descriptor';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { canonicalWorkbookJsonValue, canonicalWorkbookSheetBaseline, workbookSheetBaseline, workbookSheetBaselineSchema, WORKBOOK_SHEET_BASELINE_VERSION, type WorkbookSheetBaselineIdentity } from '@open-design/contracts/runtime/workbook-sheet-baseline';
import type { IWorkbookData, Worksheet } from '@univerjs/core';
import { WORKBOOK_MODEL_LIMITS, workbookCommitRequestSchema } from '@open-design/contracts/runtime/workbook';
import type { WorkbookCheckpoint } from './workbook-writer';
import { workbookDraftScopeSchema, workbookGridSnapshotSchema, type WorkbookDraftScope } from './workbook-draft-schema';
import { workbookSaveProvenanceSchema, type WorkbookSaveAcknowledgement } from './save-provenance';
import { assertWorkbookStructureIdentity } from './grid-structure-identity';
import { gridWorkbook } from './grid-model';
import { assertWorkbookSourceSnapshotInputs } from './source-snapshot-inputs';

export const WORKBOOK_SHEET_DELETE_MARKER = 'evebotSheetDeletion';
const sheetId = workbookActionSheetIdSchema;
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const templateSideSchema = z.enum(['pre-save', 'saved-target']);
export const workbookRemovedSheetSchema = z.preprocess(raw => { canonicalWorkbookJsonValue(raw); return raw; }, workbookGridSnapshotSchema.shape.sheets.valueSchema);
export const workbookRemovedIndexSchema = z.number().int().min(0).max(WORKBOOK_MODEL_LIMITS.sheets - 1);
export { workbookSheetActionDescriptorSchema as workbookSheetDeleteDescriptorSchema } from './sheet-action-descriptor';
export type WorkbookSheetDeleteDescriptor = z.infer<typeof workbookSheetDeleteDescriptorSchema>;
/** Serialized context is data, never proof of a Delete or a historical grant.
 * A recovered receipt association requires a new server check before use. */
export const workbookSourceDeleteContextSchema = z.object({
  descriptor: workbookSheetDeleteDescriptorSchema,
  scope: workbookDraftScopeSchema.omit({ draftId: true }).extend({ fileName: workbookCommitRequestSchema.shape.fileName }),
  sourceSha256: digest, baseline: workbookSheetBaselineSchema, acknowledgedSheet: workbookGridSnapshotSchema.shape.sheets.valueSchema,
  axisOwner: z.object({ generation: z.string().uuid(), sourceSha256: digest }).strict(),
  receiptAssociation: workbookSaveProvenanceSchema.optional(),
  templateSide: templateSideSchema.optional(),
  removedSheet: workbookRemovedSheetSchema.optional(),
  removedIndex: workbookRemovedIndexSchema.optional(),
  birthOrigin: z.object({ birthToken: z.string().uuid(), captureSourceSha256: digest,
    creation: z.object({ operationId: z.string().uuid(), sourceSha256: digest }).strict(),
  }).strict().optional(),
}).strict().superRefine((context, check) => {
  const { descriptor, receiptAssociation: receipt, removedSheet, removedIndex } = context;
  if ((removedSheet === undefined) !== (removedIndex === undefined)) check.addIssue({ code: 'custom', message: 'The removed worksheet configuration and position must be paired.' });
  if (removedSheet) {
    const issue = workbookRemovedSheetIssue(removedSheet, descriptor.sheetId);
    if (issue) check.addIssue({ code: 'custom', message: issue });
  }
  if (descriptor.sheetId !== context.baseline.sheet.id || descriptor.sheetId !== context.acknowledgedSheet.id || descriptor.generation !== context.axisOwner.generation) check.addIssue({ code: 'custom', message: 'The deletion context identity changed.' });
  if (context.templateSide && !receipt) check.addIssue({ code: 'custom', message: 'The template side requires its receipt association.' });
  if (context.birthOrigin && (!receipt || context.templateSide !== 'saved-target'
    || context.birthOrigin.birthToken === descriptor.token
    || context.birthOrigin.creation.operationId !== receipt.operationId
    || context.birthOrigin.creation.sourceSha256 !== receipt.sourceSha256)) check.addIssue({ code: 'custom', message: 'The saved birth origin changed its checked creation.' });
  const templateSha256 = context.templateSide === 'saved-target' ? receipt?.targetSha256 : receipt?.sourceSha256;
  if (receipt && (templateSha256 !== context.sourceSha256 || receipt.projectId !== context.scope.projectId || receipt.fileName !== context.scope.fileName)) check.addIssue({ code: 'custom', message: 'The deletion receipt association changed source or scope.' });
});
export type WorkbookSourceDeleteContext = z.infer<typeof workbookSourceDeleteContextSchema>;

export function workbookRemovedSheetIssue(sheet: z.infer<typeof workbookRemovedSheetSchema>, selectedId: string): string | undefined {
  if (sheet.id !== selectedId || sheet.rowCount * sheet.columnCount > WORKBOOK_MODEL_LIMITS.cells) return 'The removed worksheet geometry or identity changed.';
  for (const [row, cells] of Object.entries(sheet.cellData ?? {})) {
    if (Number(row) >= sheet.rowCount || Object.keys(cells).some(column => Number(column) >= sheet.columnCount)) return 'The removed worksheet contains out-of-bounds cells.';
  }
  return undefined;
}


/** Capture the exact selected source and ACK axis baseline before SDK removal.
 * Does not admit a command, allocate a blank birth or authorize template use. */
export function captureWorkbookSourceDeletion(scope: WorkbookDraftScope, checkpoint: WorkbookCheckpoint, selectedId: string): WorkbookSourceDeleteContext {
  const captured = captureWorkbookDeletionBaseline(scope, checkpoint.source, checkpoint.acknowledged, selectedId);
  if (checkpoint.desired.id !== checkpoint.acknowledged.id) throw Error('The deletion context belongs to another workbook.');
  if (!checkpoint.desired.sheets[selectedId]) throw Error('This worksheet has no current source-owned deletion baseline.');
  assertWorkbookStructureIdentity(checkpoint.desired);
  const position = checkpoint.desired.sheetOrder.indexOf(selectedId);
  if (position < 0 || checkpoint.desired.sheetOrder.filter(id => id === selectedId).length !== 1) throw Error('The removed worksheet position changed.');
  return withWorkbookRemovedConfiguration(captured, checkpoint.desired.sheets[selectedId], position);
}

/** Selected-sheet data only. A checked pending-target conversion can retain
 * its exact removed desired configuration separately from the actual target
 * baseline. Parsing this pair does not issue or restore a native command. */
export function withWorkbookRemovedConfiguration(context: WorkbookSourceDeleteContext, removedSheet: unknown, removedIndex: number): WorkbookSourceDeleteContext {
  canonicalWorkbookJsonValue(removedSheet);
  return workbookSourceDeleteContextSchema.parse({ ...context, removedSheet: structuredClone(removedSheet), removedIndex });
}

/** Data-only capture from a complete validated source read and its exact SDK
 * acknowledgement. Command issuance and history access are separate owners. */
export function captureWorkbookDeletionBaseline(scope: WorkbookDraftScope, source: WorkbookCheckpoint['source'], acknowledged: IWorkbookData, selectedId: string, descriptor?: WorkbookSheetDeleteDescriptor): WorkbookSourceDeleteContext {
  return captureWorkbookDeletionBaselines(scope, source, acknowledged, [{ sheetId: selectedId, descriptor }])[0]!;
}

export interface WorkbookDeletionBaselineRequest {
  sheetId: string;
  descriptor?: WorkbookSheetDeleteDescriptor | undefined;
}
/** Synchronous batch boundary: qualify the complete actual model and frozen
 * snapshot once, then clone only selected contexts. No qualification token or
 * mutable source reference escapes to a later asynchronous consumer. */
export function captureWorkbookDeletionBaselines(scope: WorkbookDraftScope, source: WorkbookCheckpoint['source'], acknowledged: IWorkbookData,
  requests: readonly WorkbookDeletionBaselineRequest[]): WorkbookSourceDeleteContext[] {
  scope = workbookDraftScopeSchema.parse(scope);
  if (!requests.length || requests.length > 4096) throw Error('The deletion baseline batch exceeds its limit.');
  const selected = requests.map(request => ({ sheetId: sheetId.parse(request.sheetId), descriptor: request.descriptor }));
  const { model, sourceSha256 } = source;
  if (model.sourceFormat === 'csv' || model.worksheetMembershipEditable !== true || !model.worksheetStructureEditable || model.calculationMetadata !== 'verified' || model.sheets.some(sheet => !sheet.arrayFormulas || sheet.arrayFormulas.length)) throw Error('Source deletion capture requires a ready qualified scalar baseline.');
  const unitId = `${scope.projectId}:${scope.fileName}`;
  if (acknowledged.id !== unitId) throw Error('The deletion context belongs to another workbook.');
  for (const request of selected) {
    const sourceSheet = model.sheets.find(sheet => sheet.id === request.sheetId);
    if (!sourceSheet || !acknowledged.sheets[request.sheetId] || sourceSheet.visibility === 'veryHidden') throw Error('This worksheet has no current source-owned deletion baseline.');
  }
  assertWorkbookStructureIdentity(acknowledged);
  assertWorkbookSourceSnapshotInputs(gridWorkbook(model, unitId, 'Workbook').data as IWorkbookData, acknowledged, unitId);
  const axisOwner = acknowledged.custom!.evebotStructureOwner as { generation: string; sourceSha256: string };
  let bytes = 2; // JSON array brackets; each subsequent result adds a comma.
  const results: WorkbookSourceDeleteContext[] = [];
  for (const request of selected) {
    const candidate = {
      descriptor: request.descriptor ?? { version: 1, token: crypto.randomUUID(), generation: axisOwner.generation, sheetId: request.sheetId },
      scope: { viewerId: scope.viewerId, projectId: scope.projectId, fileName: scope.fileName }, sourceSha256,
      baseline: workbookSheetBaseline(model, request.sheetId), acknowledgedSheet: acknowledged.sheets[request.sheetId], axisOwner,
    };
    bytes += new Blob([JSON.stringify(candidate)]).size + (results.length ? 1 : 0);
    if (bytes > MAX_WORKBOOK_DRAFT_BYTES) throw Error('The selected worksheet baselines exceed the recovery limit.');
    results.push(workbookSourceDeleteContextSchema.parse(structuredClone(candidate)));
  }
  return results;
}

/** Replace custom metadata before RemoveSheetCommand's undo factory reads it.
 * Earlier real undo configs keep their previous custom object and token. */
export function stampWorkbookSourceDeletion(sheet: Pick<Worksheet, 'getSheetId' | 'getCustomMetadata' | 'setCustomMetadata'>, descriptor: WorkbookSheetDeleteDescriptor) {
  descriptor = workbookSheetDeleteDescriptorSchema.parse(descriptor);
  if (sheet.getSheetId() !== descriptor.sheetId) throw Error('The deletion target changed.');
  sheet.setCustomMetadata({ ...sheet.getCustomMetadata(), [WORKBOOK_SHEET_DELETE_MARKER]: structuredClone(descriptor) });
}

/** Called only with the live Writer's server-checked ACK before protection.
 * The returned stored association is still data on a subsequent remount. */
export function associateWorkbookSourceDeletion(context: WorkbookSourceDeleteContext, checked: WorkbookSaveAcknowledgement, templateSide: 'pre-save' | 'saved-target' = 'pre-save'): WorkbookSourceDeleteContext {
  context = workbookSourceDeleteContextSchema.parse(context);
  if (checked.kind !== 'history') throw Error('A checked source-history receipt is required for deletion recovery.');
  templateSide = templateSideSchema.parse(templateSide);
  if (context.receiptAssociation && (context.templateSide ?? 'pre-save') !== templateSide) throw Error('The immutable deletion template side cannot be replaced.');
  const next = workbookSourceDeleteContextSchema.parse({ ...context, receiptAssociation: checked.provenance, ...(templateSide === 'saved-target' ? { templateSide } : {}) });
  if (context.receiptAssociation && JSON.stringify(context.receiptAssociation) !== JSON.stringify(next.receiptAssociation)) throw Error('The immutable deletion receipt association cannot be replaced.');
  return next;
}

/** Declare the exact historical asset selected by the explicit receipt side.
 * This is data derivation only: the host must still authorize same-file history
 * and the worker must compare the actual historical baseline before applying it. */
export function workbookSourceDeletionTemplate(raw: WorkbookSourceDeleteContext) {
  const context = workbookSourceDeleteContextSchema.parse(raw);
  if (!context.receiptAssociation) throw Error('The worksheet template has no checked receipt association.');
  const target = context.templateSide === 'saved-target';
  return { versionId: target ? context.receiptAssociation.versionId : context.receiptAssociation.sourceVersionId,
    versionSha256: target ? context.receiptAssociation.targetSha256 : context.receiptAssociation.sourceSha256 };
}

/** Recompute from the sole protected baseline; never retain a second claimed
 * hash which could survive modification of its source semantics. Not a grant. */
export function workbookSourceDeletionBaselineIdentity(raw: WorkbookSourceDeleteContext): WorkbookSheetBaselineIdentity {
  const context = workbookSourceDeleteContextSchema.parse(raw);
  return { version: WORKBOOK_SHEET_BASELINE_VERSION, sha256: bytesToHex(sha256(new TextEncoder().encode(canonicalWorkbookSheetBaseline(context.baseline)))) };
}
