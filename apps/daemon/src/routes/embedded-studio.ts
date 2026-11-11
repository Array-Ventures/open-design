import { timingSafeEqual } from 'node:crypto';
import { realpath, lstat } from 'node:fs/promises';
import path from 'node:path';
import type { Express, Request, Response } from 'express';
import { getProject, insertProject, insertConversation } from '../db.js';
import { EmbeddedWriteGate } from '../embedded-files/write-gate.js';

type Database = Parameters<typeof getProject>[0];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS = new Set(['prototype','deck','document','image','video','audio','hyperframes','dashboard','other']);
const gates = new WeakMap<Express, EmbeddedWriteGate>();
const equal = (left: string, right: string) => {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};

/** The embedded daemon is a companion service, never a general host-agent API. */
export function installEmbeddedStudioBoundary(app: Express): void {
  if (process.env.OD_EMBEDDED_STUDIO !== '1') return;
  const token = process.env.OD_EMBEDDED_TOKEN;
  if (!token || token.length < 24) throw new Error('Embedded Studio requires a service credential.');
  const gate = new EmbeddedWriteGate();
  gates.set(app, gate);
  app.use('/api', (req, res, next) => {
    if (req.path === '/health' && req.method === 'GET') return next();
    if (!equal(req.get('authorization') ?? '', `Bearer ${token}`)) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Studio gateway required' } });
    if (!embeddedOperationAllowed(req.method, req.path)) return res.status(403).json({ error: { code: 'EMBEDDED_OPERATION_DENIED', message: 'This operation belongs to the host application' } });
    const control = ['/embedded/maintenance', '/embedded/runtime'].includes(req.path);
    // Several upstream GETs bootstrap version history or cache metadata. Treat
    // bounded reads as potential writers too. Event streams are terminated by
    // the subsequent process shutdown rather than blocking the HTTP drain.
    const eventStream = req.method === 'GET' && /^\/projects\/[0-9a-f-]+\/events\/?$/i.test(req.path);
    if (!control) {
      if (eventStream) {
        const leaseProbe = gate.enterWrite();
        if (!leaseProbe) return res.status(503).set('Retry-After', '5').json({ error: { code: 'STUDIO_MAINTENANCE', message: 'Studio requests are paused for maintenance' } });
        leaseProbe();
        return next();
      }
      const complete = gate.enterWrite();
      if (!complete) return res.status(503).set('Retry-After', '5').json({ error: { code: 'STUDIO_MAINTENANCE', message: 'Studio requests are paused for maintenance' } });
      // An aborted response is not proof its asynchronous mutation finished.
      // Keep that request outstanding: a coordinator must stop the process,
      // rather than certify an uncertain write as drained.
      res.once('finish', () => { if (!res.destroyed) complete(); });
    }
    next();
  });
}

export function embeddedOperationAllowed(method: string, pathname: string): boolean {
  if (pathname === '/embedded/runtime') return method === 'GET';
  if (pathname === '/embedded/maintenance') return ['POST', 'DELETE'].includes(method);
  if (pathname === '/embedded/catalogue' || pathname.startsWith('/embedded/catalogue/')) return method === 'GET';
  if (pathname === '/embedded/projects') return method === 'POST';
  if (method === 'GET' && /^\/(health|version|app-version)$/.test(pathname)) return true;
  if (method === 'GET' && /^\/(skills|design-templates|design-systems)(\/|$)/.test(pathname)) return true;
  // No conversation, run, terminal, login, generic imports, settings or cloud deployment routes.
  const project = /^\/projects\/([0-9a-f-]+)(?:\/(.*))?$/.exec(pathname);
  if (!project || !UUID.test(project[1]!)) return false;
  const suffix = project[2] ?? '';
  const replies = new RegExp(`^conversations/${project[1]}/comments/[^/]+/replies(?:/([^/]+))?$`).exec(suffix);
  if (replies) return (replies[1] ? ['PATCH', 'DELETE'] : ['GET', 'POST']).includes(method);
  const comments = new RegExp(`^conversations/${project[1]}/comments(?:/[^/]+(?:/reorder)?)?$`);
  if (comments.test(suffix)) return ['GET', 'POST', 'PATCH', 'DELETE'].includes(method);
  if (method === 'GET' && !suffix) return true;
  if (method === 'POST' && suffix === 'upload') return true;
  if (/^(files(?:\/|$)|folders$|raw\/|preview\/|text-preview\/|preview-url$|events$|tabs$|comments(?:\/|$))/.test(suffix)) {
    return ['GET','POST','PUT','PATCH','DELETE','HEAD'].includes(method);
  }
  return method === 'POST' && /^(?:export\/(?:html|pdf|pdf-image|image|pptx)|preview\/[^/]+\/renew)$/.test(suffix);
}

export function registerEmbeddedStudioRoutes(app: Express, db: Database): void {
  if (process.env.OD_EMBEDDED_STUDIO !== '1') return;
  const gate = gates.get(app);
  if (!gate) throw new Error('Install the embedded boundary before its routes.');
  app.get('/api/embedded/runtime', (_req, res) => {
    const nonce = process.env.OD_EMBEDDED_RUNTIME_NONCE;
    const buildId = process.env.OD_EMBEDDED_RUNTIME_BUILD;
    if (!nonce || !UUID.test(nonce) || !buildId || !/^[0-9a-f]{64}$/.test(buildId)) return res.status(503).json({ error: { code: 'RUNTIME_UNMANAGED', message: 'No supervised runtime identity' } });
    return res.json({ version: 1, nonce, buildId, pid: process.pid });
  });
  app.post('/api/embedded/maintenance', (req, res) => {
    const { owner, epoch } = req.body ?? {};
    if (typeof owner !== 'string' || !UUID.test(owner) || epoch !== undefined && (!Number.isSafeInteger(epoch) || epoch < 1)) return res.status(400).json({ error: { code: 'INVALID_LEASE', message: 'Use a backup UUID and optional current fence' } });
    const lease = gate.acquire(owner, epoch);
    if (!lease) return res.status(409).json({ error: { code: 'LEASE_CONFLICT', message: 'Maintenance lease is owned elsewhere or expired' } });
    return res.json(lease);
  });
  app.delete('/api/embedded/maintenance', (req, res) => {
    const { owner, epoch } = req.body ?? {};
    if (typeof owner !== 'string' || !UUID.test(owner) || !Number.isSafeInteger(epoch) || epoch < 1) return res.status(400).json({ error: { code: 'INVALID_LEASE', message: 'Use the current maintenance fence' } });
    if (!gate.release(owner, epoch)) return res.status(409).json({ error: { code: 'LEASE_CONFLICT', message: 'Maintenance lease is owned elsewhere or expired' } });
    return res.sendStatus(204);
  });
  app.post('/api/embedded/projects', async (req: Request, res: Response) => {
    const { id, name, kind, directory } = req.body ?? {};
    if (typeof id !== 'string' || !UUID.test(id) || typeof name !== 'string' || !name.trim() || name.length > 160 || !KINDS.has(kind) || typeof directory !== 'string') {
      return res.status(400).json({ error: { code: 'INVALID_PROJECT', message: 'Invalid project registration' } });
    }
    try {
      const root = process.env.OD_EMBEDDED_WORKSPACE_ROOT;
      if (!root || !path.isAbsolute(root)) throw new Error('Workspace root is not configured');
      const canonicalRoot = await realpath(root);
      if (canonicalRoot !== path.normalize(root)) throw new Error('Workspace root is not canonical');
      const canonical = await realpath(directory);
      if (canonical !== path.normalize(directory) || !(await lstat(canonical)).isDirectory()) throw new Error('Project directory is not canonical');
      const relative = path.relative(canonicalRoot, canonical).split(path.sep).join('/');
      if (!new RegExp(`^(?:bots/[0-9a-f]{64}/files|groups/[0-9a-f]{64}|team)/projects/${id}$`).test(relative)) throw new Error('Project directory is outside its persistent workspace');
      const existing = getProject(db, id);
      if (existing) {
        if (existing.metadata?.baseDir !== canonical || existing.metadata?.embeddedHost !== 'evebot') return res.status(409).json({ error: { code: 'PROJECT_CONFLICT', message: 'Project identity is already bound' } });
        return res.json({ id });
      }
      const now = Date.now();
      db.transaction(() => {
        insertProject(db, { id, name: name.trim(), metadata: { kind, baseDir: canonical, importedFrom: 'folder', embeddedHost: 'evebot' }, createdAt: now, updatedAt: now });
        // The upstream comment store uses a conversation container. No messages or agent runs are created.
        insertConversation(db, { id, projectId: id, title: null, createdAt: now, updatedAt: now });
      })();
      return res.status(201).json({ id });
    } catch {
      return res.status(400).json({ error: { code: 'INVALID_DIRECTORY', message: 'Project directory is not an authorized workspace' } });
    }
  });
}
