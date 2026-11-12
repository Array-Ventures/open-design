import type { z } from 'zod';
import { checkedWorkbookSave as checkedSave, Save } from './save-identity';
import { cancelWorkbookSavePreparation } from './cancel-transport';
import { WorkbookSaveTerminalError, WorkbookSaveUnadmittedError, WorkbookSavePreparationCancelledError } from './save-terminal';
import { workbookEditPlanSchema } from '@open-design/contracts/runtime/workbook';
import { workbookHostRequest, WorkbookHostError } from './host-request';
import { prepareWorkbookJob, workbookPollDelay, checkedWorkbookJob, WorkbookPreparationGoneError, WorkbookPreparationTerminalError } from './preview-transport';

export interface WorkbookSaveAttempt {
  operationId: string; preparationId: string; projectId: string; fileName: string;
  plan: z.infer<typeof workbookEditPlanSchema>; renderId?: string;
}
export function newWorkbookSaveAttempt(projectId: string, fileName: string, plan: z.infer<typeof workbookEditPlanSchema>): WorkbookSaveAttempt {
  return { operationId: crypto.randomUUID(), preparationId: crypto.randomUUID(), projectId, fileName, plan: workbookEditPlanSchema.parse(plan) };
}
async function retireFailedPreparation(attempt: WorkbookSaveAttempt, job: ReturnType<typeof checkedWorkbookJob>, signal?: AbortSignal) {
  if (!['failed', 'cancelled'].includes(job.state)) throw new WorkbookHostError('The preparation is not terminal.');
  const raw = await workbookHostRequest(attempt.projectId, { action: 'remove-render', renderId: job.id }, signal);
  const removed = checkedWorkbookJob(raw ?? await workbookHostRequest(attempt.projectId, { action: 'read-render', renderId: job.id }, signal), attempt.projectId, attempt.fileName, 'xlsx');
  if (removed.id !== job.id || removed.state !== 'deleted') throw new WorkbookHostError('The failed preparation could not be retired safely.');
  try { return checkedSave(await workbookHostRequest(attempt.projectId, { action: 'read-save', saveId: attempt.operationId }, signal), attempt); }
  catch (error) {
    if (!(error instanceof WorkbookHostError) || error.status !== 404) throw error;
    throw new WorkbookSaveUnadmittedError(attempt.operationId, job.id, job.state as 'failed' | 'cancelled', job.error || 'The workbook preparation did not finish.');
  }
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
    if (previous.state === 'failed' || previous.state === 'cancelled') save = await retireFailedPreparation(attempt, previous, signal);
    else if (previous.state === 'deleted') {
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
        if (error instanceof WorkbookHostError && error.code === 'workbook_preparation_cancelled') {
          const proof = await cancelWorkbookSavePreparation(attempt, signal);
          if (proof.state === 'unadmitted') throw new WorkbookSavePreparationCancelledError(attempt.operationId, attempt.preparationId, proof.renderId);
          save = proof.save;
        } else if (error instanceof WorkbookPreparationTerminalError && ['failed', 'cancelled'].includes(error.job.state)) {
          const previous = checkedWorkbookJob(error.job, attempt.projectId, attempt.fileName, 'xlsx');
          attempt.renderId = previous.id;
          save = await retireFailedPreparation(attempt, previous, signal);
        } else {
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
    }
    if (!save) {
      if (!attempt.renderId) throw new WorkbookHostError('The workbook preparation identity is unavailable. Keep the draft and retry its status.');
      await beforeAdmission?.();
      save = checkedSave(await workbookHostRequest(attempt.projectId, { action: 'save', body: { operationId: attempt.operationId, renderId: attempt.renderId } }, signal), attempt);
    }
  }
  while (save.state === 'pending') {
    await workbookPollDelay(signal);
    save = checkedSave(await workbookHostRequest(attempt.projectId, { action: 'read-save', saveId: attempt.operationId }, signal), attempt);
  }
  if (save.state === 'conflict' || save.state === 'cancelled') throw new WorkbookSaveTerminalError(save.id, save.renderId, save.state);
  return save;
}

/** Shared strict identity check for explicit cancellation/reconciliation. */
export { checkedSave as checkedWorkbookSave };
