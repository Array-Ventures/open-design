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
