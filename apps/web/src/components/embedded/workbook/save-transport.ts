import { z } from 'zod';
import { WorkbookSaveTerminalError } from './save-terminal';
import { workbookEditPlanSchema } from '@open-design/contracts/runtime/workbook';
import { workbookHostRequest, WorkbookHostError } from './host-request';
import { prepareWorkbookJob, workbookPollDelay, checkedWorkbookJob, WorkbookPreparationGoneError } from './preview-transport';

const digest = z.string().regex(/^[0-9a-f]{64}$/);
const Save = z.object({ id: z.string().uuid(), projectId: z.string().uuid(), renderId: z.string().uuid(), fileName: z.string(),
  state: z.enum(['pending', 'applied', 'conflict', 'cancelled']), sourceSha256: digest, targetSha256: digest, actualSha256: digest.nullable(),
  versionId: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/).nullable() }).passthrough();
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
    || save.state === 'applied' && (!save.versionId || save.actualSha256 !== save.targetSha256)
    || save.state !== 'applied' && (save.versionId !== null || ['pending', 'cancelled'].includes(save.state) && save.actualSha256 !== null)) throw new WorkbookHostError('The workbook save identity could not be validated.');
  // Status is authoritative when admission succeeded but its response was lost.
  attempt.renderId = save.renderId;
  return save;
}
/** The caller retains this attempt across timeouts and retries. Probe durable
 * status first; a lost acknowledgement must never create a second write. */
export function saveWorkbook(attempt: WorkbookSaveAttempt, signal?: AbortSignal, beforeAdmission?: () => Promise<void>) {
  return settleWorkbookSave(attempt, signal, beforeAdmission, true);
}
async function settleWorkbookSave(attempt: WorkbookSaveAttempt, signal: AbortSignal | undefined, beforeAdmission: (() => Promise<void>) | undefined, mayRecoverPreparation: boolean): Promise<z.infer<typeof Save>> {
  let save: z.infer<typeof Save> | undefined;
  try { save = checkedSave(await workbookHostRequest(attempt.projectId, { action: 'read-save', saveId: attempt.operationId }, signal), attempt); }
  catch (error) { if (!(error instanceof WorkbookHostError) || error.status !== 404) throw error; }
  if (!save && attempt.renderId) {
    // A 404 save lookup alone races an earlier admission. A durable render
    // tombstone shares admission's row lock, so no delayed old-candidate request
    // can be admitted after this proof. Probe the receipt again after it.
    const previous = checkedWorkbookJob(await workbookHostRequest(attempt.projectId, { action: 'read-render', renderId: attempt.renderId }, signal), attempt.projectId, attempt.fileName, 'xlsx');
    if (previous.id !== attempt.renderId) throw new WorkbookHostError('The workbook preparation identity changed.');
    if (previous.state === 'deleted') {
      try { save = checkedSave(await workbookHostRequest(attempt.projectId, { action: 'read-save', saveId: attempt.operationId }, signal), attempt); }
      catch (error) { if (!(error instanceof WorkbookHostError) || error.status !== 404) throw error; }
      if (!save) {
        if (!beforeAdmission) throw new WorkbookHostError('Recovery storage is required before replacing this expired workbook preparation.');
        if (!mayRecoverPreparation) throw new WorkbookHostError('The replacement workbook preparation expired. Retry the same save.');
        mayRecoverPreparation = false;
        const renderId = attempt.renderId, preparationId = attempt.preparationId;
        attempt.preparationId = crypto.randomUUID();
        delete attempt.renderId;
        try { await beforeAdmission(); }
        catch (error) { attempt.renderId = renderId; attempt.preparationId = preparationId; throw error; }
      }
    }
  }
  if (!save) {
    if (!attempt.renderId) {
      try {
        const job = await prepareWorkbookJob(attempt.projectId, attempt.fileName, 'xlsx', attempt.preparationId, signal, JSON.stringify(attempt.plan));
        attempt.renderId = job.id;
      } catch (error) {
        if (!(error instanceof WorkbookPreparationGoneError) || !mayRecoverPreparation) throw error;
        // A lost prepare reply may leave only preparationId in the journal.
        // Its replay supplies an exact immutable job identity; the normal
        // tombstone/status fence still runs before any replacement is made.
        const previous = checkedWorkbookJob(error.job, attempt.projectId, attempt.fileName, 'xlsx');
        if (previous.state !== 'deleted') throw error;
        attempt.renderId = previous.id;
        return settleWorkbookSave(attempt, signal, beforeAdmission, true);
      }
    }
    await beforeAdmission?.();
    save = checkedSave(await workbookHostRequest(attempt.projectId, { action: 'save', body: { operationId: attempt.operationId, renderId: attempt.renderId } }, signal), attempt);
  }
  while (save.state === 'pending') {
    await workbookPollDelay(signal);
    save = checkedSave(await workbookHostRequest(attempt.projectId, { action: 'read-save', saveId: attempt.operationId }, signal), attempt);
  }
  if (save.state === 'conflict' || save.state === 'cancelled') throw new WorkbookSaveTerminalError(save.id, save.renderId, save.state);
  return save;
}
