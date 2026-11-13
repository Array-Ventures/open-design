import { z } from 'zod';
import type { Worksheet } from '@univerjs/core';
import { WORKBOOK_SHEET_ID_MAX, workbookSheetSchema, workbookCommitRequestSchema } from '@open-design/contracts/runtime/workbook';
import type { WorkbookCheckpoint } from './workbook-writer';
import { workbookDraftScopeSchema, workbookGridSnapshotSchema, type WorkbookDraftScope } from './workbook-draft-schema';
import { workbookSaveProvenanceSchema, type WorkbookSaveAcknowledgement } from './save-provenance';
import { assertWorkbookStructureIdentity } from './grid-structure-identity';
import { gridWorkbook } from './grid-model';
import { assertWorkbookSourceSnapshotInputs } from './source-snapshot-inputs';

export const WORKBOOK_SHEET_DELETE_MARKER = 'evebotSheetDeletion';
const sheetId = z.string().regex(/^[1-9][0-9]{0,4}$/).refine(value => Number(value) <= WORKBOOK_SHEET_ID_MAX);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const workbookSheetDeleteDescriptorSchema = z.object({ version: z.literal(1), token: z.string().uuid(), generation: z.string().uuid(), sheetId }).strict();
export type WorkbookSheetDeleteDescriptor = z.infer<typeof workbookSheetDeleteDescriptorSchema>;
/** Serialized context is data, never proof of a Delete or a historical grant.
 * A recovered receipt association requires a new server check before use. */
export const workbookSourceDeleteContextSchema = z.object({
  descriptor: workbookSheetDeleteDescriptorSchema,
  scope: workbookDraftScopeSchema.omit({ draftId: true }).extend({ fileName: workbookCommitRequestSchema.shape.fileName }),
  sourceSha256: digest, date1904: z.boolean(), richTextMetadata: z.literal('verified').optional(),
  sourceSheet: workbookSheetSchema, acknowledgedSheet: workbookGridSnapshotSchema.shape.sheets.valueSchema,
  axisOwner: z.object({ generation: z.string().uuid(), sourceSha256: digest }).strict(),
  receiptAssociation: workbookSaveProvenanceSchema.optional(),
}).strict().superRefine((context, check) => {
  const { descriptor, receiptAssociation: receipt } = context;
  if (descriptor.sheetId !== context.sourceSheet.id || descriptor.sheetId !== context.acknowledgedSheet.id || descriptor.generation !== context.axisOwner.generation) check.addIssue({ code: 'custom', message: 'The deletion context identity changed.' });
  if (receipt && (receipt.sourceSha256 !== context.sourceSha256 || receipt.projectId !== context.scope.projectId || receipt.fileName !== context.scope.fileName)) check.addIssue({ code: 'custom', message: 'The deletion receipt association changed source or scope.' });
});
export type WorkbookSourceDeleteContext = z.infer<typeof workbookSourceDeleteContextSchema>;

/** Capture the exact selected source and ACK axis baseline before SDK removal.
 * Does not admit a command, allocate a blank birth or authorize template use. */
export function captureWorkbookSourceDeletion(scope: WorkbookDraftScope, checkpoint: WorkbookCheckpoint, selectedId: string): WorkbookSourceDeleteContext {
  scope = workbookDraftScopeSchema.parse(scope); selectedId = sheetId.parse(selectedId);
  const { model, sourceSha256 } = checkpoint.source;
  if (checkpoint.pending || model.sourceFormat === 'csv' || !model.worksheetStructureEditable || model.calculationMetadata !== 'verified' || model.sheets.some(sheet => !sheet.arrayFormulas || sheet.arrayFormulas.length)) throw Error('Source deletion capture requires a ready qualified scalar baseline.');
  const unitId = `${scope.projectId}:${scope.fileName}`;
  if (checkpoint.acknowledged.id !== unitId || checkpoint.desired.id !== unitId) throw Error('The deletion context belongs to another workbook.');
  const sourceSheet = model.sheets.find(sheet => sheet.id === selectedId), acknowledgedSheet = checkpoint.acknowledged.sheets[selectedId];
  if (!sourceSheet || !acknowledgedSheet || !checkpoint.desired.sheets[selectedId] || sourceSheet.visibility === 'veryHidden') throw Error('This worksheet has no current source-owned deletion baseline.');
  assertWorkbookStructureIdentity(checkpoint.acknowledged);
  assertWorkbookSourceSnapshotInputs(gridWorkbook(model, unitId, 'Workbook').data as typeof checkpoint.acknowledged, checkpoint.acknowledged, unitId);
  const axisOwner = checkpoint.acknowledged.custom!.evebotStructureOwner as { generation: string; sourceSha256: string };
  return workbookSourceDeleteContextSchema.parse(structuredClone({
    descriptor: { version: 1, token: crypto.randomUUID(), generation: axisOwner.generation, sheetId: selectedId },
    scope: { viewerId: scope.viewerId, projectId: scope.projectId, fileName: scope.fileName }, sourceSha256, date1904: model.date1904,
    ...(model.richTextMetadata ? { richTextMetadata: model.richTextMetadata } : {}), sourceSheet, acknowledgedSheet, axisOwner,
  }));
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
export function associateWorkbookSourceDeletion(context: WorkbookSourceDeleteContext, checked: WorkbookSaveAcknowledgement): WorkbookSourceDeleteContext {
  context = workbookSourceDeleteContextSchema.parse(context);
  if (checked.kind !== 'history') throw Error('A checked source-history receipt is required for deletion recovery.');
  const next = workbookSourceDeleteContextSchema.parse({ ...context, receiptAssociation: checked.provenance });
  if (context.receiptAssociation && JSON.stringify(context.receiptAssociation) !== JSON.stringify(next.receiptAssociation)) throw Error('The immutable deletion receipt association cannot be replaced.');
  return next;
}
