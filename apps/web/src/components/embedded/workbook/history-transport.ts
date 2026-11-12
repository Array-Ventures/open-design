import { z } from 'zod';
import { workbookHostRequest, WorkbookHostError } from './host-request';
const id = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);
const Version = z.object({ id, fileName: z.string(), version: z.number().int().positive(), label: z.string().max(4000), createdAt: z.number().int().nonnegative(), source: z.enum(['manual', 'ai', 'restore']),
  size: z.number().int().min(0).max(25 * 1024 * 1024), current: z.boolean(), contentDigest: z.string().regex(/^[a-f0-9]{64}$/), parentVersionId: id.optional(), restoreFromVersionId: id.optional() }).strict();
const History = z.object({ projectId: z.string().uuid(), fileName: z.string(), versions: z.array(Version).max(10_000) }).strict();
export type WorkbookHistoryVersion = z.infer<typeof Version>;
/** Native owns access and retrieves immutable binary history. This passive
 * action neither snapshots the working file nor restores a selected revision. */
export async function listWorkbookHistory(projectId: string, fileName: string, signal?: AbortSignal): Promise<WorkbookHistoryVersion[]> {
  const result = History.parse(await workbookHostRequest(projectId, { action: 'list-history', fileName }, signal));
  if (result.projectId !== projectId || result.fileName !== fileName || result.versions.some(version => version.fileName !== fileName)
    || new Set(result.versions.map(version => version.id)).size !== result.versions.length || result.versions.filter(version => version.current).length > 1) throw new WorkbookHostError('The workbook history identity could not be verified.');
  return result.versions;
}
