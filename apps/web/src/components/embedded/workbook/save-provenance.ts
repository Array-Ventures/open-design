import type { WorkbookCheckpoint } from './workbook-writer';
import { workbookDraftScopeSchema, type WorkbookDraftScope } from './workbook-draft-schema';
import { canonicalWorkbookJsonValue } from '@open-design/contracts/runtime/workbook-sheet-baseline';
import { z } from 'zod';
import { workbookCommitRequestSchema } from '@open-design/contracts/runtime/workbook';
import { checkedWorkbookSave } from './save-identity';
import { WorkbookHostError } from './host-request';
import type { WorkbookSaveAttempt } from './save-transport';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const version = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);
export const workbookSaveProvenanceSchema = z.object({
  operationId: z.string().uuid(), projectId: z.string().uuid(), fileName: workbookCommitRequestSchema.shape.fileName,
  renderId: z.string().uuid(), sourceSha256: digest, sourceVersionId: version, targetSha256: digest, versionId: version,
}).strict().refine(value => value.sourceSha256 === value.targetSha256 || value.sourceVersionId !== value.versionId, 'Different workbook byte identities cannot share one immutable history version.');
export type WorkbookSaveProvenance = z.infer<typeof workbookSaveProvenanceSchema>;
export const workbookSaveAcknowledgementSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('history'), provenance: workbookSaveProvenanceSchema }).strict(),
  z.object({ kind: z.literal('unavailable'), reason: z.enum(['legacy-receipt', 'whole-file-restore']) }).strict(),
]);
export type WorkbookSaveAcknowledgement = z.infer<typeof workbookSaveAcknowledgementSchema>;

/** Qualifies receipt metadata only, not SDK ancestry or durable ownership.
 * sourceVersionId names the pre-save bytes; versionId names the saved target.
 * Both digests must match the retained intent and the validated fresh preview.
 * The future owner must persist this binding before retiring its old baseline.
 */
export function checkedWorkbookSaveAcknowledgement(raw: unknown, attempt: WorkbookSaveAttempt, refreshedSourceSha256: string): WorkbookSaveAcknowledgement {
  const receipt = checkedWorkbookSave(raw, attempt);
  if (receipt.state !== 'applied' || receipt.actualSha256 !== receipt.targetSha256 || digest.parse(refreshedSourceSha256) !== receipt.targetSha256) throw new WorkbookHostError('The workbook acknowledgement does not match the saved source and refreshed target.');
  if (receipt.restoreFromVersionId) return { kind: 'unavailable', reason: 'whole-file-restore' };
  // Legacy/null fields permit ordinary saves but never authorize history-backed
  // automatic Undo. No version is invented from the target or a worksheet name.
  if (!receipt.sourceVersionId) return { kind: 'unavailable', reason: 'legacy-receipt' };
  return { kind: 'history', provenance: workbookSaveProvenanceSchema.parse({
    operationId: receipt.id, projectId: receipt.projectId, fileName: receipt.fileName, renderId: receipt.renderId,
    sourceSha256: receipt.sourceSha256, sourceVersionId: receipt.sourceVersionId,
    targetSha256: receipt.targetSha256, versionId: receipt.versionId,
  }) };
}


/** Recheck the exact retained pending identity before transferring protected
 * birth data. Metadata consistency only, never server or SDK authority. */
export function assertWorkbookPendingAcknowledgement(scope: WorkbookDraftScope, before: WorkbookCheckpoint,
  target: WorkbookCheckpoint['source'], acknowledgement: WorkbookSaveAcknowledgement): asserts acknowledgement is Extract<WorkbookSaveAcknowledgement, { kind: 'history' }> {
  scope = workbookDraftScopeSchema.parse(scope);
  const checked = workbookSaveAcknowledgementSchema.parse(acknowledgement), pending = before.pending;
  if (!pending || checked.kind !== 'history') throw Error('A pending birth requires its checked target receipt.');
  if (pending.acknowledgement && canonicalWorkbookJsonValue(pending.acknowledgement) !== canonicalWorkbookJsonValue(checked)) throw Error('The checked birth receipt changed while protected.');
  const proof = checked.provenance;
  if (proof.operationId !== pending.intent.id || proof.renderId !== pending.intent.renderId
    || proof.sourceSha256 !== before.source.sourceSha256 || proof.sourceSha256 !== pending.intent.plan.sourceSha256
    || proof.targetSha256 !== target.sourceSha256 || proof.projectId !== scope.projectId || proof.fileName !== scope.fileName) throw Error('The saved birth receipt changed source, target or operation.');
}
