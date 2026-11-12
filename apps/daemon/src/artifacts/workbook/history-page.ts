import { z } from 'zod';
const position = z.object({ version: z.number().int().positive(), id: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/) }).strict();
const cursorSchema = z.object({ version: z.literal(1), projectId: z.string(), fileName: z.string().max(500), upper: position, after: position }).strict();
interface Position { id: string; version: number }
const compare = (a: Position, b: Position) => b.version - a.version || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
const invalid = () => Object.assign(new Error('The workbook history cursor is invalid for this artifact.'), { code: 'EINVAL' });
/** Stable newest-first cursor; versions created after the first page are left
 * for an explicit refresh. Reads never change the history manifest/head. */
export function workbookHistoryPage<T extends Position>(versions: T[], scope: { projectId: string; fileName: string; limit: number; cursor?: string }) {
  if (!Number.isSafeInteger(scope.limit) || scope.limit < 1 || scope.limit > 100) throw invalid();
  let cursor: z.infer<typeof cursorSchema> | undefined;
  if (scope.cursor) {
    try {
      if (!/^[A-Za-z0-9_-]{1,2048}$/.test(scope.cursor)) throw invalid();
      cursor = cursorSchema.parse(JSON.parse(Buffer.from(scope.cursor, 'base64url').toString('utf8')));
      if (cursor.projectId !== scope.projectId || cursor.fileName !== scope.fileName || compare(cursor.after, cursor.upper) < 0) throw invalid();
    } catch { throw invalid(); }
  }
  const ordered = [...versions].sort(compare), upper = cursor?.upper ?? ordered[0];
  const remaining = ordered.filter(item => (!upper || compare(item, upper) >= 0) && (!cursor || compare(item, cursor.after) > 0));
  const page = remaining.slice(0, scope.limit), last = page.at(-1);
  const nextCursor = remaining.length > scope.limit && upper && last ? Buffer.from(JSON.stringify({ version: 1, projectId: scope.projectId, fileName: scope.fileName, upper: { id: upper.id, version: upper.version }, after: { id: last.id, version: last.version } })).toString('base64url') : null;
  return { versions: page, nextCursor };
}
