import { z } from 'zod';
import { workbookHostRequest, WorkbookHostError } from './host-request';
import { checkedWorkbookSave } from './save-identity';
import type { WorkbookSaveAttempt } from './save-transport';
const proofSchema = z.object({ state: z.literal('unadmitted'), projectId: z.string().uuid(), operationId: z.string().uuid(), preparationId: z.string().uuid(), fileName: z.string(), sourceSha256: z.string().regex(/^[a-f0-9]{64}$/), renderId: z.string().uuid().nullable() }).strict();
const admittedSchema = z.object({ state: z.literal('admitted'), save: z.unknown() }).strict();
/** Explicit discard reconciliation never calls prepare or save. A server claim
 * closes a lost-first-prepare race; a lost response is retried with the same IDs.
 * The caller must also check its generation before deleting its local journal. */
export async function cancelWorkbookSavePreparation(attempt: WorkbookSaveAttempt, signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const raw = await workbookHostRequest(attempt.projectId, { action: 'cancel-preparation', body: {
    operationId: attempt.operationId, preparationId: attempt.preparationId, fileName: attempt.fileName,
    workbookEditPlan: JSON.stringify(attempt.plan), ...(attempt.renderId ? { renderId: attempt.renderId } : {}),
  } }, signal);
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const admitted = admittedSchema.safeParse(raw);
  if (admitted.success) return { state: 'admitted' as const, save: checkedWorkbookSave(admitted.data.save, attempt) };
  const proof = proofSchema.parse(raw);
  if (proof.projectId !== attempt.projectId || proof.operationId !== attempt.operationId || proof.preparationId !== attempt.preparationId
    || proof.fileName !== attempt.fileName || proof.sourceSha256 !== attempt.plan.sourceSha256 || attempt.renderId && proof.renderId !== attempt.renderId) throw new WorkbookHostError('The workbook cancellation identity could not be validated.');
  return proof;
}
