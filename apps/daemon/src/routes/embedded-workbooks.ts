import { parseDelimitedText } from '@open-design/contracts/runtime/delimited-text';
import { createHash } from 'node:crypto';
import express, { type Express } from 'express';
import type Database from 'better-sqlite3';
import { workbookCommitRequestSchema } from '@open-design/contracts/runtime/workbook';
import { getProject } from '../db.js';
import { commitEmbeddedWorkbook } from '../artifacts/workbook/contained-commit.js';
import { WORKBOOK_HISTORY_BYTES } from '../artifacts/workbook/history-storage.js';
import { WorkbookWriteError } from '../storage/workbook-writes.js';

/** Native host protocol only: the embedded service boundary authenticates this
 * path. It is never included in the browser-facing project gateway allowlist.
 * The host derives actor/mode from its durable intent and current authority. */
export function registerEmbeddedWorkbookRoutes(app: Express, db: Database.Database, projectsRoot: string): void {
  if (process.env.OD_EMBEDDED_STUDIO !== '1') return;
  const serve = (restoring: boolean): express.RequestHandler => async (req, res) => {
    const parsed = workbookCommitRequestSchema.safeParse({ operationId: req.params.operationId, sourceSha256: req.get('x-od-workbook-source'), targetSha256: req.get('x-od-workbook-target'),
      actor: req.get('x-od-workbook-actor'), mode: req.get('x-od-workbook-mode'), fileName: req.query.fileName, ...(restoring ? { restore: { versionId: req.get('x-od-workbook-restore-version'), contentDigest: req.get('x-od-workbook-target') } } : {}) });
    // Empty octet-stream is a valid CSV candidate. Express can omit req.body
    // for content-length:0; never reinterpret JSON or an untyped body as empty.
    const body = Buffer.isBuffer(req.body) ? req.body : req.body === undefined && req.is('application/octet-stream') && req.get('content-length') === '0' ? Buffer.alloc(0) : null;
    if (!parsed.success || body === null) return res.status(400).json({ error: { code: 'INVALID_WORKBOOK_WRITE', message: 'Use prepared table bytes and valid host save metadata.' } });
    const input = parsed.data;
    if (/\.csv$/i.test(input.fileName)) {
      try {
        // Defensive bounded literal validation only. Typed model preparation
        // and calculations remain in the existing isolated render worker.
        parseDelimitedText(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(body), ',', true);
      } catch { return res.status(400).json({ error: { code: 'INVALID_WORKBOOK_WRITE', message: 'Use bounded, valid UTF-8 CSV bytes.' } }); }
    } else if (body.length < 4 || !body.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) return res.status(400).json({ error: { code: 'INVALID_WORKBOOK_WRITE', message: 'Use prepared XLSX bytes.' } });
    if (!restoring && req.get('x-od-workbook-restore-version')) return res.status(400).json({ error: { code: 'INVALID_WORKBOOK_WRITE', message: 'Use the dedicated workbook restore protocol.' } });
    if (createHash('sha256').update(body).digest('hex') !== input.targetSha256) return res.status(400).json({ error: { code: 'WORKBOOK_TARGET_MISMATCH', message: 'Prepared workbook bytes do not match their identity.' } });
    const projectId = typeof req.params.projectId === 'string' ? req.params.projectId : '';
    const project = getProject(db, projectId);
    if (!project) return res.status(404).json({ error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found.' } });
    const authorize = async () => {
      const current = getProject(db, projectId);
      if (!current || current.metadata?.embeddedHost !== 'evebot' || current.metadata.baseDir !== project.metadata?.baseDir) throw new Error('The registered project changed.');
    };
    try {
      const { restore, ...request } = input;
      const receipt = await commitEmbeddedWorkbook(db, projectsRoot, { projectId: project.id, ...request, bytes: body, ...(restore ? { restore } : {}) }, project.metadata ?? {}, authorize, input.mode);
      return res.json({ receipt });
    } catch (error) {
      const code = error instanceof WorkbookWriteError ? error.code : 'WORKBOOK_SAVE_UNCERTAIN';
      return res.status(error instanceof WorkbookWriteError ? 409 : 503).json({ error: { code, message: 'The save has not settled. Retry the same operation.' } });
    }
  };
  const bytes = () => express.raw({ type: 'application/octet-stream', limit: WORKBOOK_HISTORY_BYTES, inflate: false });
  app.post('/api/embedded/projects/:projectId/workbook-writes/:operationId', bytes(), serve(false));
  app.post('/api/embedded/projects/:projectId/workbook-restores/:operationId', bytes(), serve(true));
}
