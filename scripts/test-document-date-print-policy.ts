import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { tmpdir, userInfo } from 'node:os';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url)), image = process.argv[2];
if (!image || !/^sha256:[a-f0-9]{64}$/.test(image)) throw Error('Pass an existing local Date renderer image digest.');
const exec = promisify(execFile), require = createRequire(path.join(root, 'apps/daemon/package.json'));
const { documentHtml } = require('@open-design/contracts/runtime/document'), { load } = require('cheerio');
const { PNG } = createRequire(path.join(root, 'e2e/package.json'))('pngjs');
const scratch = await mkdtemp(path.join(tmpdir(), 'od-date-print-policy-')), worker = path.join(scratch, 'worker.mjs'), actor = userInfo();
await exec('corepack', ['pnpm', '--filter', '@open-design/daemon', 'exec', 'esbuild', 'src/embedded-render/main.ts', '--bundle', '--platform=node', '--format=esm', '--target=node24', '--external:playwright-core', '--banner:js=import {createRequire as __policyRequire} from "node:module"; const require=__policyRequire(import.meta.url);', `--outfile=${worker}`], { cwd: root });
const color = path.join(scratch, 'document-color.iife.js');
await exec('corepack', ['pnpm', '--filter', '@open-design/daemon', 'exec', 'esbuild', '../../packages/document-style/src/browser.ts', '--bundle', '--platform=browser', '--format=iife', '--global-name=odDocumentColor', '--target=chrome130', `--outfile=${color}`], { cwd: root });
const measurements: Array<{ name: string; brightInkPixels: number; redPixels: number }> = [];
try {
  for (const [name, date, unknown] of [['no-date', false, false], ['with-date', true, false], ['unknown-authored-css', true, true], ['legacy-time', false, false]] as const) {
    const directory = path.join(scratch, name), source = path.join(directory, 'source'), output = path.join(directory, 'output'), job = path.join(directory, 'job');
    await mkdir(source, { recursive: true }); await mkdir(output); await mkdir(job);
    let html = documentHtml('Print policy', `<table><tr><td style="background-color:#181828">InheritedInk</td></tr></table><hr style="width:40%;color:#c00000"><p>After divider${date ? '<time data-eve-document-date="1" datetime="2026-11-16" data-eve-date-locale="en">Nov 16, 2026</time>' : ''}</p>`);
    if (unknown) html = html.replace('</head>', '<style>.unowned { color: red }</style></head>');
    if (name === 'legacy-time') html = html.replace('</main>', '<p><time datetime="2026-11-16">Legacy TIME</time></p></main>');
    await writeFile(path.join(source, 'policy.html'), html); await writeFile(path.join(job, 'input.json'), JSON.stringify({ fileName: 'policy.html', format: 'pdf' }));
    const container = `od-date-policy-${randomUUID()}`;
    try {
      await exec('docker', ['run', '--pull', 'never', '--name', container, '--label', 'od.date-policy-test=true', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--pids-limit', '256', '--memory', '1g', '--cpus', '1', '--shm-size', '128m', '--tmpfs', '/tmp:rw,nosuid,nodev,size=256m', '--user', `${actor.uid}:${actor.gid}`, '--mount', `type=bind,src=${worker},dst=/opt/render/worker.mjs,readonly`, '--mount', `type=bind,src=${color},dst=/opt/render/document-color.iife.js,readonly`, '--mount', `type=bind,src=${source},dst=/source,readonly`, '--mount', `type=bind,src=${job},dst=/job,readonly`, '--mount', `type=bind,src=${output},dst=/output`, image], { timeout: 90_000, maxBuffer: 128 * 1024 });
    } finally { await exec('docker', ['rm', '-f', container]).catch(() => {}); }
    const result = JSON.parse(await readFile(path.join(output, 'result.json'), 'utf8')); assert.equal(result.ok, true);
    const pdf = path.join(output, result.file);
    await exec('/usr/bin/pdftoppm', ['-r', '96', '-png', '-singlefile', pdf, path.join(directory, 'paint')]);
    const bbox = (await exec('/usr/bin/pdftotext', ['-bbox', pdf, '-'])).stdout; await writeFile(path.join(directory, 'bbox.xml'), bbox);
    const $ = load(bbox, { xml: true }), box = $('word').toArray().find((node: object) => $(node).text() === 'InheritedInk'); assert.ok(box);
    const png = PNG.sync.read(await readFile(path.join(directory, 'paint.png'))), scale = png.width / Number($('page').first().attr('width'));
    let brightInkPixels = 0, redPixels = 0;
    const x0 = Math.floor(Number($(box).attr('xMin')) * scale), x1 = Math.ceil(Number($(box).attr('xMax')) * scale), y0 = Math.floor(Number($(box).attr('yMin')) * scale), y1 = Math.ceil(Number($(box).attr('yMax')) * scale);
    for (let y = 0; y < png.height; y++) for (let x = 0; x < png.width; x++) {
      const offset = (y * png.width + x) * 4, r = png.data[offset], g = png.data[offset + 1], b = png.data[offset + 2];
      if (r > 120 && g < 40 && b < 40) redPixels++;
      if (x >= x0 && x < x1 && y >= y0 && y < y1 && r > 230 && g > 230 && b > 230) brightInkPixels++;
    }
    measurements.push({ name, brightInkPixels, redPixels }); assert.equal(await readFile(path.join(source, 'policy.html'), 'utf8'), html);
  }
  for (const item of measurements.slice(0, 2)) { assert.ok(item.brightInkPixels > 20, `${item.name}: inherited ink repair must stay active`); assert.ok(item.redPixels > 20, `${item.name}: owned divider repair must stay active`); }
  for (const item of measurements.slice(2)) {
    assert.equal(item.brightInkPixels, 0, `${item.name} must still decline automatic ink correction.`);
    assert.equal(item.redPixels, 0, `${item.name} must still decline automatic divider correction.`);
  }
  process.stdout.write(JSON.stringify({ ok: true, scratch, measurements }) + '\n');
} finally {
  await writeFile(path.join(scratch, 'receipt.json'), JSON.stringify({ image, measurements }, null, 2));
  process.stdout.write(`Retained print policy evidence: ${scratch}\n`);
}
