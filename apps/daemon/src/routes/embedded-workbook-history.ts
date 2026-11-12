import { createHash } from 'node:crypto';
import { withEmbeddedProject } from '../embedded-files/pinned-project.js';
import { z } from 'zod';
import type { Express, RequestHandler } from 'express';
import type Database from 'better-sqlite3';
import { workbookCommitRequestSchema } from '@open-design/contracts/runtime/workbook';
import { workbookHistoryPage } from '../artifacts/workbook/history-page.js';
import { getProject } from '../db.js';
import { listProjectFileVersions, readProjectFileVersionBytes } from '../project-file-versions.js';

const query = z.object({ fileName: z.string().min(1).max(500).refine(value => workbookCommitRequestSchema.shape.fileName.safeParse(value).success && value.split('/').every(part => !['node_modules', '.git', '.eve', '.file-versions'].includes(part) && !/^\.env(?:\.|$)/.test(part))) }).strict();
const listQuery = query.extend({ limit: z.coerce.number().int().min(1).max(100).default(50), cursor: z.string().regex(/^[A-Za-z0-9_-]{1,2048}$/).optional() }).strict();
const versionId = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);
/** Service-only passive reads. Never bootstrap a revision or change its head. */
export function registerEmbeddedWorkbookHistoryRoutes(app: Express, db: Database.Database, root: string): void {
  if (process.env.OD_EMBEDDED_STUDIO !== '1') return;
  const serve = (metadataOnly: boolean): RequestHandler => async (req, res) => {
    const selected = typeof req.params.versionId === 'string' ? req.params.versionId : undefined;
    const parsed = (selected ? query : listQuery).safeParse(req.query);
    const projectId = typeof req.params.projectId === 'string' ? req.params.projectId : '';
    if (!parsed.success || selected !== undefined && !versionId.safeParse(selected).success) return res.status(400).json({ error: { code: 'INVALID_WORKBOOK_HISTORY', message: 'Choose an ordinary XLSX file and saved version.' } });
    const project = getProject(db, projectId);
    if (!project || project.metadata?.embeddedHost !== 'evebot') return res.status(404).json({ error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found.' } });
    try {
      res.set('Cache-Control', 'no-store'); res.set('X-Content-Type-Options', 'nosniff');
      if (selected !== undefined && !metadataOnly) {
        const saved = await readProjectFileVersionBytes(root, project.id, parsed.data.fileName, selected, project.metadata);
        return res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(saved.content);
      }
      let currentSha256: string | null = null;
      try { currentSha256 = createHash('sha256').update(await withEmbeddedProject(project.id, project.metadata ?? {}, async pinned => (await pinned.read(parsed.data.fileName, 25 * 1024 * 1024)).buffer)).digest('hex'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      const versions = await listProjectFileVersions(root, project.id, parsed.data.fileName, project.metadata);
      const summary = (item: typeof versions[number]) => ({ id: item.id, fileName: item.fileName, version: item.version, label: item.label.length > 4000 ? item.label.slice(0, 3999).replace(/[\uD800-\uDBFF]$/, '') + '…' : item.label, ...(item.label.length > 4000 ? { labelTruncated: true } : {}), createdAt: item.createdAt,
        source: item.source, size: item.size, current: item.current && item.contentDigest === currentSha256, contentDigest: item.contentDigest,
        ...(item.parentVersionId ? { parentVersionId: item.parentVersionId } : {}), ...(item.restoreFromVersionId ? { restoreFromVersionId: item.restoreFromVersionId } : {}) });
      if (selected !== undefined) {
        const version = versions.find(item => item.id === selected);
        if (!version) throw Object.assign(Error('missing'), { code: 'ENOENT' });
        return res.json({ projectId: project.id, fileName: parsed.data.fileName, version: summary(version) });
      }
      const page = listQuery.parse(req.query);
      return res.json({ projectId: project.id, fileName: page.fileName, currentSha256, ...workbookHistoryPage(versions.map(summary), { projectId: project.id, fileName: page.fileName, limit: page.limit, currentSha256, ...(page.cursor ? { cursor: page.cursor } : {}) }) });
    } catch (error) {
      const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
      if ((error as NodeJS.ErrnoException).code === 'ESTALE') return res.status(409).json({ error: { code: 'WORKBOOK_HISTORY_CHANGED', message: 'The current workbook changed. Refresh history before restoring.' } });
      if ((error as NodeJS.ErrnoException).code === 'EINVAL') return res.status(400).json({ error: { code: 'INVALID_WORKBOOK_HISTORY', message: 'The history cursor is invalid. Refresh workbook history.' } });
      return res.status(missing ? 404 : 409).json({ error: { code: missing ? 'WORKBOOK_VERSION_NOT_FOUND' : 'WORKBOOK_HISTORY_UNAVAILABLE', message: 'The retained workbook history could not be verified.' } });
    }
  };
  app.get('/api/embedded/projects/:projectId/workbook-history{/:versionId}', serve(false));
  app.get('/api/embedded/projects/:projectId/workbook-history/:versionId/metadata', serve(true));
}

