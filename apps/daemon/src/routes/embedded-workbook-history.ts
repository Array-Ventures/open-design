import { z } from 'zod';
import type { Express } from 'express';
import type Database from 'better-sqlite3';
import { workbookCommitRequestSchema } from '@open-design/contracts/runtime/workbook';
import { getProject } from '../db.js';
import { listProjectFileVersions, readProjectFileVersionBytes } from '../project-file-versions.js';

const query = z.object({ fileName: z.string().min(1).max(500).refine(value => workbookCommitRequestSchema.shape.fileName.safeParse(value).success && value.split('/').every(part => !['node_modules', '.git', '.eve', '.file-versions'].includes(part) && !/^\.env(?:\.|$)/.test(part))) }).strict();
const versionId = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);
/** Service-only passive reads. Never bootstrap a revision or change its head. */
export function registerEmbeddedWorkbookHistoryRoutes(app: Express, db: Database.Database, root: string): void {
  if (process.env.OD_EMBEDDED_STUDIO !== '1') return;
  app.get('/api/embedded/projects/:projectId/workbook-history{/:versionId}', async (req, res) => {
    const parsed = query.safeParse(req.query);
    const selected = req.params.versionId;
    if (!parsed.success || selected !== undefined && !versionId.safeParse(selected).success) return res.status(400).json({ error: { code: 'INVALID_WORKBOOK_HISTORY', message: 'Choose an ordinary XLSX file and saved version.' } });
    const project = getProject(db, req.params.projectId);
    if (!project || project.metadata?.embeddedHost !== 'evebot') return res.status(404).json({ error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found.' } });
    try {
      res.set('Cache-Control', 'no-store'); res.set('X-Content-Type-Options', 'nosniff');
      if (selected !== undefined) {
        const saved = await readProjectFileVersionBytes(root, project.id, parsed.data.fileName, selected, project.metadata);
        return res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(saved.content);
      }
      const versions = await listProjectFileVersions(root, project.id, parsed.data.fileName, project.metadata);
      return res.json({ projectId: project.id, fileName: parsed.data.fileName, versions: versions.map(item => ({
        id: item.id, fileName: item.fileName, version: item.version, label: item.label, createdAt: item.createdAt,
        source: item.source, size: item.size, current: item.current, contentDigest: item.contentDigest,
        ...(item.parentVersionId ? { parentVersionId: item.parentVersionId } : {}),
        ...(item.restoreFromVersionId ? { restoreFromVersionId: item.restoreFromVersionId } : {}),
      })) });
    } catch (error) {
      const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
      return res.status(missing ? 404 : 409).json({ error: { code: missing ? 'WORKBOOK_VERSION_NOT_FOUND' : 'WORKBOOK_HISTORY_UNAVAILABLE', message: 'The retained workbook history could not be verified.' } });
    }
  });
}
