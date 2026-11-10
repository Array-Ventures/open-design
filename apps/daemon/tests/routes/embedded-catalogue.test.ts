import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { Server } from 'node:http';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerEmbeddedCatalogueRoutes } from '../../src/routes/embedded-catalogue.js';

let scratch: string; let server: Server; let origin: string; let bundle: string;
beforeEach(async () => {
  scratch = await mkdtemp(path.join(tmpdir(), 'od-catalogue-'));
  const roots = { skills: path.join(scratch, 'skills'), templates: path.join(scratch, 'templates'), designSystems: path.join(scratch, 'systems'), noticeRoot: path.join(scratch, 'repository') };
  for (const root of Object.values(roots)) await mkdir(root);
  await writeFile(path.join(roots.noticeRoot, 'LICENSE'), 'Apache inherited repository fixture license');
  await writeFile(path.join(roots.noticeRoot, 'NOTICE'), 'Repository attribution fixture');
  bundle = path.join(roots.skills, 'fixture'); await mkdir(bundle);
  await writeFile(path.join(bundle, 'SKILL.md'), '---\nname: fixture\ndescription: Test creative workflow\nmode: utility\n---\nUse the fixture asset.\n');
  await writeFile(path.join(bundle, 'asset.svg'), '<svg>fixture</svg>');
  await writeFile(path.join(bundle, 'LICENSE'), 'Apache License, Version 2.0');
  vi.stubEnv('OD_EMBEDDED_STUDIO', '1');
  const app = express(); registerEmbeddedCatalogueRoutes(app, roots);
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No listener');
  origin = `http://127.0.0.1:${address.port}/api/embedded/catalogue/skill/fixture`;
});
afterEach(async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); await rm(scratch, { recursive: true, force: true }); vi.unstubAllEnvs(); });
type Detail = { bundleDigest: string; body: string; files: Array<{ path: string; size: number; sha256: string }>; licenses: Array<{ path: string; text: string }> };
describe('embedded creative resource provenance', () => {
  it('shares detail provenance and restriction checks with legacy skill/template aliases', async () => {
    const template = path.join(scratch, 'templates', 'fixture');
    await mkdir(template);
    await writeFile(path.join(template, 'SKILL.md'), '---\nname: fixture\ndescription: Template fixture\nmode: utility\n---\nAuthored template body.\n');
    await writeFile(path.join(template, 'LICENSE'), 'Apache License, Version 2.0');
    const base = new URL(origin).origin;
    for (const [area, directory, body] of [
      ['skills', bundle, 'Use the fixture asset.\n'],
      ['design-templates', template, 'Authored template body.\n'],
    ]) {
      const alias = `${base}/api/${area}/fixture`;
      const response = await fetch(alias);
      expect(response.status).toBe(200);
      const detail = await response.json() as Detail;
      expect(detail.body).toBe(body);
      expect(detail.licenses).toContainEqual({ path: '_repository-notices/NOTICE', text: 'Repository attribution fixture' });
      expect(detail.bundleDigest).toMatch(/^[0-9a-f]{64}$/);
      await writeFile(path.join(directory!, 'LICENSE'), 'For non-commercial use only.');
      const restricted = await fetch(alias);
      expect(restricted.status).toBe(403);
      expect(await restricted.json()).toMatchObject({ error: { code: 'RESTRICTED_CONTENT' } });
    }
  });

  it('hashes supporting bytes and changes the bundle identity when an asset changes', async () => {
    const first = await (await fetch(origin)).json() as Detail;
    const file = first.files.find((item) => item.path === 'asset.svg')!;
    expect(file.sha256).toBe(createHash('sha256').update('<svg>fixture</svg>').digest('hex'));
    expect(first.licenses[0]?.text).toContain('Apache');
    expect(first.body).toBe('Use the fixture asset.\n');
    expect(first.body).not.toContain(scratch);
    expect(first.body).not.toContain('.od-skills/');
    expect(first.bundleDigest).toBe(createHash('sha256').update(JSON.stringify({ body: first.body, files: first.files })).digest('hex'));
    const asset = await fetch(origin + '/file/asset.svg'); expect(await asset.text()).toBe('<svg>fixture</svg>');
    await writeFile(path.join(bundle, 'asset.svg'), '<svg>changed</svg>');
    const second = await (await fetch(origin)).json() as Detail;
    expect(second.bundleDigest).not.toBe(first.bundleDigest);
  });
  it('delivers inherited repository notices as hashed supporting files', async () => {
    const first = await (await fetch(origin)).json() as Detail;
    expect(first.licenses).toContainEqual({ path: '_repository-notices/NOTICE', text: 'Repository attribution fixture' });
    expect(await (await fetch(origin + '/file/_repository-notices/LICENSE')).text()).toBe('Apache inherited repository fixture license');
    await writeFile(path.join(scratch, 'repository', 'NOTICE'), 'Updated repository attribution');
    const next = await (await fetch(origin)).json() as Detail;
    expect(next.bundleDigest).not.toBe(first.bundleDigest);
    expect((await fetch(origin + '/file/_repository-notices/%2e%2e%2fasset.svg')).status).toBe(404);
  });
  it('fails closed if a configured repository license is missing or reserved paths collide', async () => {
    await rm(path.join(scratch, 'repository', 'LICENSE'));
    expect((await fetch(origin)).status).toBe(503);
    expect((await fetch(origin + '/file/asset.svg')).status).toBe(404);
    await writeFile(path.join(scratch, 'repository', 'LICENSE'), 'Apache fixture');
    await mkdir(path.join(bundle, '_repository-notices'));
    await writeFile(path.join(bundle, '_repository-notices', 'LICENSE'), 'Spoofed');
    expect((await fetch(origin)).status).toBe(503);
    await rm(path.join(bundle, '_repository-notices'), { recursive: true });
    await writeFile(path.join(bundle, '_repository-notices'), 'File blocks notice directory');
    expect((await fetch(origin)).status).toBe(503);
  });
  it('enforces the license gate on direct file downloads as well as detail reads', async () => {
    await writeFile(path.join(bundle, 'LICENSE'), 'For non-commercial use only.');
    expect((await fetch(origin)).status).toBe(403);
    expect((await fetch(origin + '/file/asset.svg')).status).toBe(403);
  });
  it('retains font OFL and prefixed third-party notices with their exact hashed bytes', async () => {
    await mkdir(path.join(bundle, 'fonts'));
    const notices = {
      'fonts/inter-OFL.txt': 'SIL OPEN FONT LICENSE Version 1.1 — fixture notice',
      'THIRD_PARTY_NOTICES.md': 'Third-party attribution fixture',
      'LICENSE-MIT': 'MIT permission notice fixture',
    };
    for (const [name, text] of Object.entries(notices)) await writeFile(path.join(bundle, name), text);
    const response = await fetch(origin);
    expect(response.status).toBe(200);
    const detail = await response.json() as Detail;
    for (const [name, text] of Object.entries(notices)) {
      expect(detail.licenses).toContainEqual({ path: name, text });
      expect(detail.files.find(file => file.path === name)?.sha256).toBe(createHash('sha256').update(text).digest('hex'));
      expect(await (await fetch(origin + '/file/' + name)).text()).toBe(text);
    }
  });
  it('applies a restriction in a prefixed notice to both guidance and direct asset delivery', async () => {
    await writeFile(path.join(bundle, 'font-LICENSE.txt'), 'For non-commercial use only.');
    expect((await fetch(origin)).status).toBe(403);
    expect((await fetch(origin + '/file/asset.svg')).status).toBe(403);
  });
  it('refuses unregistered files and does not expose another bundle root', async () => {
    expect((await fetch(origin + '/file/not-here.svg')).status).toBe(404);
    expect((await fetch(origin + '/file/%2e%2e%2fLICENSE')).status).toBe(404);
  });
});
