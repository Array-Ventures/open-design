import { Save } from './save-identity';
import type { WorkbookRestoreIntent } from './restore-intent';
import { z } from 'zod';
import { workbookHostRequest, WorkbookHostError } from './host-request';
import { checkedWorkbookJob, workbookPollDelay, WorkbookPreparationGoneError, WorkbookPreparationTerminalError } from './preview-transport';
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const output = z.object({ file: z.literal('artifact.xlsx'), mime: z.literal('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'), bytes: z.number().int().positive().max(25 * 1024 * 1024), sha256: digest }).passthrough();
export interface WorkbookRestorePreparation { operationId: string; fileName: string; versionId: string; versionSha256: string; sourceSha256: string }
/** Retain this exact preparation identity across retries. This prepares a
 * checked candidate only; admission still uses the existing stable save ID. */
export async function prepareWorkbookRestore(projectId: string, body: WorkbookRestorePreparation, signal?: AbortSignal) {
  let job = checkedWorkbookJob(await workbookHostRequest(projectId, { action: 'prepare-restore', body }, signal), projectId, body.fileName, 'xlsx');
  const renderId = job.id;
  while (job.state === 'queued' || job.state === 'running') {
    await workbookPollDelay(signal);
    job = checkedWorkbookJob(await workbookHostRequest(projectId, { action: 'read-render', renderId }, signal), projectId, body.fileName, 'xlsx');
    if (job.id !== renderId) throw new WorkbookHostError('The workbook restore preparation identity changed.');
  }
  if (job.state === 'deleted') throw new WorkbookPreparationGoneError(job);
  if (job.state !== 'ready') throw new WorkbookPreparationTerminalError(job);
  const prepared = output.parse(job.output);
  if (prepared.sha256 !== body.versionSha256) throw new WorkbookHostError('The prepared restore does not match the selected workbook revision.');
  return job;
}

/** Every restore receipt must name the selected immutable revision, including
 * pending and rejected receipts. A transport failure or missing lineage never
 * authorizes clearing the protected local operation. */
export function checkedWorkbookRestoreReceipt(raw: unknown, intent: WorkbookRestoreIntent) {
  const save = Save.parse(raw);
  if (save.id !== intent.operationId || save.projectId !== intent.projectId || save.fileName !== intent.fileName
    || save.sourceSha256 !== intent.sourceSha256 || save.targetSha256 !== intent.versionSha256
    || save.restoreFromVersionId !== intent.versionId
    || intent.renderId && save.renderId !== intent.renderId
    || save.state === 'applied' && (!save.versionId || save.actualSha256 !== intent.versionSha256)
    || save.state !== 'applied' && (save.versionId !== null || ['pending', 'cancelled'].includes(save.state) && save.actualSha256 !== null)) throw new WorkbookHostError('The restore receipt does not match the selected revision.');
  return save;
}

/** Exact binary restore uses the same durable save receipt, never an edit-plan
 * reprepare. Retain both IDs until that receipt is authoritative. Setting
 * allowPrepare:false permits only receipt reads/polling, never preparation or
 * admission, including when the working file changed or disappeared. */
export async function restoreWorkbookVersion(intent: WorkbookRestoreIntent, protect: () => Promise<void>, signal?: AbortSignal, options: { allowPrepare?: boolean } = {}) {
  const check = (raw: unknown) => checkedWorkbookRestoreReceipt(raw, intent);
  const read = async () => {
    try { return check(await workbookHostRequest(intent.projectId, { action: 'read-save', saveId: intent.operationId }, signal)); }
    catch (error) { if (error instanceof WorkbookHostError && error.status === 404) return null; throw error; }
  };
  let save = await read();
  if (!save && options.allowPrepare === false) throw new WorkbookRestoreReceiptUnavailableError();
  if (!save) {
    try {
      const job = await prepareWorkbookRestore(intent.projectId, { operationId: intent.preparationId, fileName: intent.fileName,
        versionId: intent.versionId, versionSha256: intent.versionSha256, sourceSha256: intent.sourceSha256 }, signal);
      if (intent.renderId && intent.renderId !== job.id) throw new WorkbookHostError('The restore preparation identity changed.');
      intent.renderId = job.id; await protect();
    } catch (error) {
      if (!(error instanceof WorkbookPreparationGoneError || error instanceof WorkbookPreparationTerminalError)) throw error;
      const job = error.job;
      const raw = job.state === 'deleted' ? job : await workbookHostRequest(intent.projectId, { action: 'remove-render', renderId: job.id }, signal);
      const removed = checkedWorkbookJob(raw ?? await workbookHostRequest(intent.projectId, { action: 'read-render', renderId: job.id }, signal), intent.projectId, intent.fileName, 'xlsx');
      if (removed.id !== job.id || removed.state !== 'deleted') throw new WorkbookHostError('The restore preparation could not be retired safely.');
      save = await read();
      if (!save) throw new WorkbookRestoreFinishedError('unadmitted', 'This revision could not be prepared. No restore was admitted; select it again to retry.');
    }
    if (!save && !intent.renderId) throw new WorkbookHostError('The restore preparation has no immutable identity.');
    if (!save) save = check(await workbookHostRequest(intent.projectId, { action: 'save', body: { operationId: intent.operationId, renderId: intent.renderId! } }, signal));
  }
  while (save.state === 'pending') {
    await workbookPollDelay(signal);
    const next = await read(); if (!next) throw new WorkbookHostError('The restore receipt is temporarily unavailable. Check this same operation again.');
    save = next;
  }
  if (save.state !== 'applied') throw new WorkbookRestoreFinishedError(save.state,
    save.state === 'conflict' ? 'The current workbook changed. Nothing was overwritten; refresh history before choosing a revision again.' : 'The restore was cancelled. The current workbook was kept.');
  return save;
}
export class WorkbookRestoreFinishedError extends WorkbookHostError {
  constructor(readonly outcome: 'conflict' | 'cancelled' | 'unadmitted', message: string) { super(message); }
}

/** Absence is not proof of cancellation: an earlier admission may still land. */
export class WorkbookRestoreReceiptUnavailableError extends WorkbookHostError {
  constructor(message = 'The exact restore receipt is unavailable. Keep this operation protected and check its status again. No new save was submitted.') { super(message); }
}
