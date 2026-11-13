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
export type WorkbookSaveAcknowledgement =
  | { kind: 'history'; provenance: WorkbookSaveProvenance }
  | { kind: 'unavailable'; reason: 'legacy-receipt' | 'whole-file-restore' };

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
