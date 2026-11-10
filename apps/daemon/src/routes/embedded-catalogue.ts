import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { Express } from 'express';
import { listSkills } from '../skills.js';
import { parseFrontmatter } from '../design-systems/frontmatter.js';
import { listDesignSystems } from '../design-systems/index.js';
import { DECK_FRAMEWORK_DIRECTIVE } from '@open-design/contracts';

type Kind = 'skill' | 'template' | 'design-system';
type Roots = { skills: string; templates: string; designSystems: string; noticeRoot?: string };
type Entry = { id: string; name: string; description: string; mode: string; root: string; body: string; kind: Kind; referenceOnly: boolean };
const sha256 = (body: string | Buffer) => createHash('sha256').update(body).digest('hex');

const repositoryNotices = "_repository-notices/";
const noticeName = /(?:^|[-_.])(?:licen[cs]es?|copying|notices?|ofl|copyright)(?=[-_.]|$)/i;

async function resourceBundle(entry: Entry, noticeRoot?: string) {
  const files = await bundleFiles(entry.root);
  if (files.some(file => file.path === repositoryNotices.slice(0, -1) || file.path.startsWith(repositoryNotices))) throw new Error('Reserved repository notice path');
  // Retain repository-wide notices alongside any more specific asset notices.
  if (noticeRoot) {
    const names = (await readdir(noticeRoot, { withFileTypes: true })).filter(item => item.isFile() && noticeName.test(item.name)).map(item => item.name).sort();
    if (!names.includes('LICENSE')) throw new Error('Repository license is missing');
    for (const name of names) {
      const body = await readBundleFile(noticeRoot, name);
      files.push({ path: repositoryNotices + name, size: body.length, sha256: sha256(body) });
    }
    files.sort((a, b) => a.path.localeCompare(b.path));
  }
  const licenseFiles = files.filter(file => file.path.split('/').some(part => noticeName.test(part)));
  if (licenseFiles.reduce((total, file) => total + file.size, 0) > 1024 * 1024) throw new Error('Resource notices exceed the response budget');
  const licenses = await Promise.all(licenseFiles.map(async file => ({ path: file.path, text: (await resourceFile(entry.root, file.path, noticeRoot)).toString('utf8') })));
  const restricted = licenses.some((file) => /(?:non[- ]commercial|creative commons.*?by.nc|CC.BY.NC)/i.test(file.text));
  const bundleDigest = sha256(JSON.stringify({ body: entry.body, files }));
  return { files, licenses, restricted, bundleDigest };
}

export function registerEmbeddedCatalogueRoutes(app: Express, roots: Roots): void {
  if (process.env.OD_EMBEDDED_STUDIO !== '1') return;
  async function entries(): Promise<Entry[]> {
    const [skills, templates, systems] = await Promise.all([listSkills(roots.skills), listSkills(roots.templates), listDesignSystems(roots.designSystems)]);
    // listSkills adds paths for the standalone runner. Embedded consumers stage
    // assets in their own sandbox, so retain the authored body, not that preamble.
    const bodies = new Map<string, Promise<string>>();
    const convert = (items: typeof skills, kind: Kind) => Promise.all(items.map(async (item) => {
      let body = bodies.get(item.dir);
      if (!body) {
        body = readBundleFile(item.dir, 'SKILL.md').then((bytes) => parseFrontmatter(bytes.toString('utf8')).body);
        bodies.set(item.dir, body);
      }
      const authored = await body;
      return { id: item.id, name: item.name, description: item.description, mode: item.mode, root: item.dir, body: authored, kind, referenceOnly: authored.includes('This catalogue entry advertises the skill in OpenDesign') };
    }));
    const [skillEntries, templateEntries] = await Promise.all([convert(skills, 'skill'), convert(templates, 'template')]);
    return [
      ...skillEntries, ...templateEntries,
      ...systems.map((item) => ({ id: item.id, name: item.title, description: item.summary, mode: 'design-system', root: path.join(roots.designSystems, item.id), body: '', kind: 'design-system' as const, referenceOnly: false })),
    ];
  }
  async function resolve(kind: string, id: string) { return (await entries()).find((entry) => entry.kind === kind && entry.id === id); }
  app.get('/api/embedded/catalogue', async (_req, res) => {
    try { res.json((await entries()).map(({ root: _root, body: _body, ...entry }) => entry)); }
    catch { res.status(503).json({ error: { code: 'CATALOGUE_UNAVAILABLE', message: 'Catalogue unavailable' } }); }
  });
  app.get(['/api/embedded/catalogue/:kind/:id', '/api/skills/:id', '/api/design-templates/:id'], async (req, res) => {
    try {
      const kind = req.params.kind ?? (req.path.startsWith('/api/skills/') ? 'skill' : 'template');
      if (typeof kind !== 'string' || typeof req.params.id !== 'string') return res.status(404).end();
      const entry = await resolve(kind, req.params.id);
      if (!entry) return res.status(404).end();
      const { files, licenses, restricted, bundleDigest } = await resourceBundle(entry, roots.noticeRoot);
      if (restricted) return res.status(403).json({ error: { code: 'RESTRICTED_CONTENT', message: 'This content needs a separate license review' } });
      const { root: _root, body, ...summary } = entry;
      const content = body || (files.some((file) => file.path === 'DESIGN.md') ? (await readBundleFile(entry.root, 'DESIGN.md')).toString('utf8') : '');
      return res.json({ ...summary, body: content, files, licenses, bundleDigest, hostContract: entry.mode === 'deck' ? DECK_FRAMEWORK_DIRECTIVE : null });
    } catch { return res.status(503).json({ error: { code: 'CATALOGUE_UNAVAILABLE', message: 'Resource unavailable' } }); }
  });
  app.get('/api/embedded/catalogue/:kind/:id/file/*file', async (req, res) => {
    try {
      const entry = await resolve(req.params.kind, req.params.id);
      if (!entry) return res.status(404).end();
      const components = req.params.file;
      const relative = Array.isArray(components) ? components.join('/') : String(components);
      // Match a registered file, never a model-supplied host path.
      const bundle = await resourceBundle(entry, roots.noticeRoot);
      if (bundle.restricted) return res.status(403).json({ error: { code: 'RESTRICTED_CONTENT', message: 'This content needs a separate license review' } });
      const file = bundle.files.find((file) => file.path === relative);
      if (!file) return res.status(404).end();
      const body = await resourceFile(entry.root, relative, roots.noticeRoot);
      if (sha256(body) !== file.sha256) return res.status(409).end();
      return res.type('application/octet-stream').send(body);
    } catch { return res.status(404).end(); }
  });
}

async function resourceFile(root: string, relative: string, noticeRoot?: string): Promise<Buffer> {
  if (relative.startsWith(repositoryNotices)) {
    const name = relative.slice(repositoryNotices.length);
    if (!noticeRoot || name.includes('/') || !noticeName.test(name)) throw new Error('Invalid repository notice');
    return readBundleFile(noticeRoot, name);
  }
  return readBundleFile(root, relative);
}
async function readBundleFile(root: string, relative: string): Promise<Buffer> {
  if (relative.split('/').some((part) => !part || part === '.' || part === '..' || /[\\\0]/.test(part))) throw new Error('Invalid bundle path');
  const canonicalRoot = await realpath(root);
  const target = await realpath(path.join(root, relative));
  if (!target.startsWith(canonicalRoot + path.sep) || (await stat(target)).size > 20 * 1024 * 1024) throw new Error('Invalid bundle file');
  return readFile(target);
}
async function bundleFiles(root: string): Promise<Array<{ path: string; size: number; sha256: string }>> {
  const files: Array<{ path: string; size: number; sha256: string }> = [];
  let bytes = 0;
  async function walk(relative: string) {
    for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.isSymbolicLink()) continue;
      const file = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile()) {
        if (files.length >= 1500) throw new Error('Bundle file limit exceeded');
        const body = await readBundleFile(root, file);
        bytes += body.length;
        if (bytes > 250 * 1024 * 1024) throw new Error('Bundle byte limit exceeded');
        files.push({ path: file, size: body.length, sha256: sha256(body) });
      }
    }
  }
  await walk('');
  return files.sort((a, b) => a.path.localeCompare(b.path));
}
