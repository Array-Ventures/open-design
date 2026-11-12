import { z } from 'zod';
import { WorkbookHostError } from './host-request';
import type { WorkbookSaveAttempt } from './save-transport';
const digest = z.string().regex(/^[0-9a-f]{64}$/);
export const Save = z.object({ id: z.string().uuid(), projectId: z.string().uuid(), renderId: z.string().uuid(), fileName: z.string(),
  state: z.enum(['pending', 'applied', 'conflict', 'cancelled']), sourceSha256: digest, targetSha256: digest, actualSha256: digest.nullable(),
  restoreFromVersionId: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/).optional(),
  versionId: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/).nullable() }).passthrough();
export function checkedWorkbookSave(raw: unknown, attempt: WorkbookSaveAttempt) {
  const save = Save.parse(raw);
  if (save.id !== attempt.operationId || save.projectId !== attempt.projectId || save.fileName !== attempt.fileName
    || save.sourceSha256 !== attempt.plan.sourceSha256 || attempt.renderId && save.renderId !== attempt.renderId
    || save.state === 'applied' && (!save.versionId || save.actualSha256 !== save.targetSha256)
    || save.state !== 'applied' && (save.versionId !== null || ['pending', 'cancelled'].includes(save.state) && save.actualSha256 !== null)) throw new WorkbookHostError('The workbook save identity could not be validated.');
  // Status is authoritative when admission succeeded but its response was lost.
  attempt.renderId = save.renderId;
  return save;
}
