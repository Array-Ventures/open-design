import { z } from 'zod';
import { workbookPreviewSchema } from '@open-design/contracts/runtime/workbook';
import { workbookHostRequest, WorkbookHostError } from './host-request';

const Job = z.object({ id: z.string().uuid(), projectId: z.string().uuid(), input: z.object({ fileName: z.string(), format: z.string() }).passthrough(),
  state: z.enum(['queued', 'running', 'ready', 'failed', 'cancelled', 'deleted']), error: z.string().nullable() }).passthrough();
export function checkedWorkbookJob(raw: unknown, projectId: string, fileName: string, format: 'workbook' | 'xlsx' | 'csv') {
  const job = Job.parse(raw);
  if (job.projectId !== projectId || job.input.fileName !== fileName || job.input.format !== format) throw new WorkbookHostError('The workbook preparation identity does not match this preview.');
  return job;
}
/** A checked terminal job is evidence to reconcile, not proof that no save
 * was admitted. Only the save transport's tombstone/status fence proves that. */
export class WorkbookPreparationTerminalError extends WorkbookHostError {
  constructor(readonly job: ReturnType<typeof checkedWorkbookJob>) {
    super(job.error || (job.state === 'deleted' ? 'This workbook preparation has expired.' : 'The workbook could not be prepared.'), job.state === 'deleted' ? 410 : 422);
    if (!['failed', 'cancelled', 'deleted'].includes(job.state)) throw new WorkbookHostError('The preparation is not terminal.');
  }
}
/** Exact deleted-job identity returned by idempotent preparation replay. */
export class WorkbookPreparationGoneError extends WorkbookPreparationTerminalError {
  constructor(job: ReturnType<typeof checkedWorkbookJob>) {
    super(job);
    if (job.state !== 'deleted') throw new WorkbookHostError('The preparation has not expired.');
  }
}
export function workbookPollDelay(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
    const abort = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, 1000);
    signal?.addEventListener('abort', abort, { once: true });
  });
}
export async function prepareWorkbookJob(projectId: string, fileName: string, format: 'workbook' | 'xlsx' | 'csv', operationId: string, signal?: AbortSignal, workbookEditPlan?: string) {
  let job = checkedWorkbookJob(await workbookHostRequest(projectId, { action: 'prepare', body: { operationId, fileName, format, ...(workbookEditPlan === undefined ? {} : { workbookEditPlan }) } }, signal), projectId, fileName, format);
  const id = job.id;
  try {
  while (job.state === 'queued' || job.state === 'running') {
    await workbookPollDelay(signal);
    job = checkedWorkbookJob(await workbookHostRequest(projectId, { action: 'read-render', renderId: id }, signal), projectId, fileName, format);
    if (job.id !== id) throw new WorkbookHostError('The workbook preparation identity changed.');
  }
  if (job.state === 'deleted') throw new WorkbookPreparationGoneError(job);
  if (job.state !== 'ready') throw new WorkbookPreparationTerminalError(job);
  return job;
  } catch (error) {
    if (signal?.aborted && format === 'workbook') {
      void workbookHostRequest(projectId, { action: 'cancel-render', renderId: id }).then(() => workbookHostRequest(projectId, { action: 'remove-render', renderId: id })).catch(() => {});
    }
    throw error;
  }
}
export async function loadWorkbookPreview(projectId: string, fileName: string, operationId: string, signal?: AbortSignal) {
  const job = await prepareWorkbookJob(projectId, fileName, 'workbook', operationId, signal);
  const raw = await workbookHostRequest(projectId, { action: 'read-preview', renderId: job.id }, signal);
  const parsed = workbookPreviewSchema.safeParse(raw);
  if (!parsed.success) throw new WorkbookHostError('The workbook preview could not be validated.', 422);
  if (/\.csv$/i.test(fileName) !== (parsed.data.model.sourceFormat === 'csv')) throw new WorkbookHostError('The table preview format does not match its source.', 422);
  // Retain a ready preview after a failed/uncertain read so the same intent
  // can recover it. Only a validated result is consumed; expiry is bounded.
  void workbookHostRequest(projectId, { action: 'remove-render', renderId: job.id }).catch(() => {});
  return parsed.data;
}
