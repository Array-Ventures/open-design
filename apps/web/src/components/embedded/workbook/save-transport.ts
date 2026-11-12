import { z } from 'zod';
import { workbookEditPlanSchema } from '@open-design/contracts/runtime/workbook';
import { workbookHostRequest, WorkbookHostError } from './host-request';
import { prepareWorkbookJob, workbookPollDelay } from './preview-transport';

const digest = z.string().regex(/^[0-9a-f]{64}$/);
const Save = z.object({ id: z.string().uuid(), projectId: z.string().uuid(), renderId: z.string().uuid(), fileName: z.string(),
  state: z.enum(['pending', 'applied', 'conflict', 'cancelled']), sourceSha256: digest, targetSha256: digest, actualSha256: digest.nullable(),
  versionId: z.string().nullable() }).passthrough();
export interface WorkbookSaveAttempt {
  operationId: string; preparationId: string; projectId: string; fileName: string;
  plan: z.infer<typeof workbookEditPlanSchema>; renderId?: string;
}
export function newWorkbookSaveAttempt(projectId: string, fileName: string, plan: z.infer<typeof workbookEditPlanSchema>): WorkbookSaveAttempt {
  return { operationId: crypto.randomUUID(), preparationId: crypto.randomUUID(), projectId, fileName, plan: workbookEditPlanSchema.parse(plan) };
}
function checkedSave(raw: unknown, attempt: WorkbookSaveAttempt) {
  const save = Save.parse(raw);
  if (save.id !== attempt.operationId || save.projectId !== attempt.projectId || save.fileName !== attempt.fileName
    || save.sourceSha256 !== attempt.plan.sourceSha256 || attempt.renderId && save.renderId !== attempt.renderId
    || save.state === 'applied' && (!save.versionId || save.actualSha256 !== save.targetSha256)) throw new WorkbookHostError('The workbook save identity could not be validated.');
  // Status is authoritative when admission succeeded but its response was lost.
  attempt.renderId = save.renderId;
  return save;
}
/** The caller retains this attempt across timeouts and retries. Probe durable
 * status first; a lost acknowledgement must never create a second write. */
export async function saveWorkbook(attempt: WorkbookSaveAttempt, signal?: AbortSignal, beforeAdmission?: () => Promise<void>) {
  let save: z.infer<typeof Save> | undefined;
  try { save = checkedSave(await workbookHostRequest(attempt.projectId, { action: 'read-save', saveId: attempt.operationId }, signal), attempt); }
  catch (error) { if (!(error instanceof WorkbookHostError) || error.status !== 404) throw error; }
  if (!save) {
    if (!attempt.renderId) {
      const job = await prepareWorkbookJob(attempt.projectId, attempt.fileName, 'xlsx', attempt.preparationId, signal, JSON.stringify(attempt.plan));
      attempt.renderId = job.id;
    }
    await beforeAdmission?.();
    save = checkedSave(await workbookHostRequest(attempt.projectId, { action: 'save', body: { operationId: attempt.operationId, renderId: attempt.renderId } }, signal), attempt);
  }
  while (save.state === 'pending') {
    await workbookPollDelay(signal);
    save = checkedSave(await workbookHostRequest(attempt.projectId, { action: 'read-save', saveId: attempt.operationId }, signal), attempt);
  }
  if (save.state === 'conflict') throw new WorkbookHostError('The workbook changed elsewhere. Your edits are still here; reload only after keeping a copy.', 409);
  if (save.state !== 'applied') throw new WorkbookHostError('This save was cancelled. Your edits are still here.', 410);
  return save;
}
