import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir, userInfo } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url)), image = process.argv[2], sourcePath = process.argv[3];
if (!image || !/^sha256:[a-f0-9]{64}$/.test(image) || !sourcePath) throw Error('Pass an existing local renderer image digest and an owned Date HTML fixture.');
const baseline = process.argv.includes('--baseline'), exec = promisify(execFile), require = createRequire(path.join(root, 'apps/daemon/package.json'));
const JSZip = require('jszip'), { load } = require('cheerio');
const scratch = await mkdtemp(path.join(tmpdir(), 'od-date-export-spacing-')), source = path.join(scratch, 'source'), worker = path.join(scratch, 'worker.mjs');
await mkdir(source);
const original = await readFile(sourcePath), sourceSha256 = createHash('sha256').update(original).digest('hex');
assert.ok(original.includes(Buffer.from('data-eve-document-date="1"')), 'Use a Date fixture, not arbitrary content.');
await writeFile(path.join(source, 'date.html'), original);
if (!baseline) await exec('corepack', ['pnpm', '--filter', '@open-design/daemon', 'exec', 'esbuild', 'src/embedded-render/main.ts', '--bundle', '--platform=node', '--format=esm', '--target=node24', '--external:playwright-core', '--banner:js=import {createRequire as __dateRequire} from "node:module"; const require=__dateRequire(import.meta.url);', `--outfile=${worker}`], { cwd: root });
const actor = userInfo(), receipts: object[] = [];
async function render(name: string, fileName: string, format: string, ok = true) {
  const output = path.join(scratch, name), job = path.join(scratch, `${name}-job`), container = `od-date-spacing-${randomUUID()}`;
  await mkdir(output); await mkdir(job);
  await writeFile(path.join(job, 'input.json'), JSON.stringify({ fileName, format }));
  const mounts = ['--mount', `type=bind,src=${source},dst=/source,readonly`, '--mount', `type=bind,src=${job},dst=/job,readonly`, '--mount', `type=bind,src=${output},dst=/output`];
  if (!baseline) mounts.push('--mount', `type=bind,src=${worker},dst=/opt/render/worker.mjs,readonly`);
  try {
    let status = 0;
    try { await exec('docker', ['run', '--pull', 'never', '--name', container, '--label', 'od.date-spacing-test=true', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--pids-limit', '256', '--memory', '1g', '--cpus', '1', '--shm-size', '128m', '--tmpfs', '/tmp:rw,nosuid,nodev,size=256m', '--user', `${actor.uid}:${actor.gid}`, ...mounts, image!], { timeout: 90_000, maxBuffer: 128 * 1024 }); }
    catch (error) { status = Number((error as { code?: unknown }).code) || 1; if (ok) throw error; }
    const result = JSON.parse(await readFile(path.join(output, 'result.json'), 'utf8')) as { ok: boolean; file?: string; error?: string };
    receipts.push({ name, status, result }); assert.equal(result.ok, ok);
    if (!ok) assert.match(result.error ?? '', /Resolve document suggestions/);
    return result.file ? path.join(output, result.file) : null;
  } finally { await exec('docker', ['rm', '-f', container]).catch(() => {}); }
}
try {
  const docx = (await render('word', 'date.html', 'docx'))!, pdf = (await render('pdf', 'date.html', 'pdf'))!, markdown = (await render('markdown', 'date.html', 'markdown'))!;
  const office = path.join(scratch, 'office'); await mkdir(office);
  await exec('/usr/bin/libreoffice', [`-env:UserInstallation=${pathToFileURL(path.join(scratch, 'office-profile')).href}`, '--headless', '--convert-to', 'pdf', '--outdir', office, docx], { timeout: 60_000, maxBuffer: 128 * 1024 });
  const wordPdf = path.join(office, 'artifact.pdf');
  const wordText = (await exec('/usr/bin/pdftotext', ['-layout', wordPdf, '-'])).stdout, pdfText = (await exec('/usr/bin/pdftotext', ['-layout', pdf, '-'])).stdout;
  await writeFile(path.join(scratch, 'word-text.txt'), wordText); await writeFile(path.join(scratch, 'pdf-text.txt'), pdfText);
  for (const [name, file] of [['word', wordPdf], ['pdf', pdf]]) await exec('/usr/bin/pdftoppm', ['-png', '-singlefile', '-scale-to', '1200', file!, path.join(scratch, name!)]);
  const zip = await JSZip.loadAsync(await readFile(docx)); const xml = await zip.file('word/document.xml').async('string');
  await writeFile(path.join(scratch, 'word-document.xml'), xml);
  assert.doesNotMatch(xml, /<w:(?:fldChar|instrText|sdt)\b/, 'Export labels are ordinary Word text, not fabricated date controls.');
  for (const [name, text] of [['Word through LibreOffice', wordText], ['native PDF', pdfText]]) {
    assert.match(text!, /baseline\.\s+Nov 16, 2026\s+Nov 17, 2026/, `${name} must separate the adjacent persisted Date labels from surrounding text`);
  }
  const md = await readFile(markdown, 'utf8'), originalDates = load(original.toString())('time').toArray().map((element: object) => load(original.toString()).html(element));
  for (const date of originalDates) assert.ok(md.includes(date), 'Markdown must retain exact semantic Date metadata and labels.');
  assert.ok(!md.includes('\u2005'), 'Word presentation spacing must not enter Markdown.');
  if (!baseline) {
    const context = load(original.toString()), dates = context('time').toArray().map((element: object) => context.html(element));
    assert.equal(dates.length, 2);
    context('main').html(`<p>Paren(${dates[0]}),${dates[1]}.</p><p><span style="white-space: pre-wrap;">Whitespace  kept</span> ${dates[0]} tail.</p><p><strong>Bold</strong><a href="https://example.invalid">${dates[0]}</a><em>tail</em></p><p>Wrap: ${'wrapping text '.repeat(30)}${dates[0]}${dates[1]} end.</p>`);
    await writeFile(path.join(source, 'contexts.html'), context.html());
    const contextDocx = (await render('context-word', 'contexts.html', 'docx'))!, contextPdf = (await render('context-pdf', 'contexts.html', 'pdf'))!;
    const contextOffice = path.join(scratch, 'context-office'); await mkdir(contextOffice);
    await exec('/usr/bin/libreoffice', [`-env:UserInstallation=${pathToFileURL(path.join(scratch, 'context-office-profile')).href}`, '--headless', '--convert-to', 'pdf', '--outdir', contextOffice, contextDocx], { timeout: 60_000, maxBuffer: 128 * 1024 });
    for (const [name, file] of [['context-word', path.join(contextOffice, 'artifact.pdf')], ['context-pdf', contextPdf]]) {
      const text = (await exec('/usr/bin/pdftotext', ['-layout', file!, '-'])).stdout;
      await writeFile(path.join(scratch, `${name}-text.txt`), text);
      assert.match(text, /Paren\(\s+Nov 16, 2026\s+\),\s+Nov 17, 2026/);
      assert.match(text, /Bold\s+Nov 16, 2026\s+tail/);
      assert.doesNotMatch(text, /2026Nov|BoldNov|2026tail/);
      await exec('/usr/bin/pdftoppm', ['-png', '-singlefile', '-scale-to', '1200', file!, path.join(scratch, name!)]);
    }
    const contextZip = await JSZip.loadAsync(await readFile(contextDocx));
    const contextXml = await contextZip.file('word/document.xml').async('string');
    assert.match(contextXml, /<w:b\/>/); assert.match(contextXml, /<w:hyperlink\b/);
    context('main').html(`<p><ins data-eve-suggestion="1" data-eve-suggestion-id="11111111-1111-4111-8111-111111111111" data-eve-suggestion-operation="insert">${dates[0]}</ins></p>`);
    await writeFile(path.join(source, 'pending.html'), context.html());
    for (const format of ['docx', 'pdf', 'markdown']) await render(`pending-${format}`, 'pending.html', format, false);
  }
  assert.deepEqual(await readFile(path.join(source, 'date.html')), original); assert.deepEqual(await readFile(sourcePath), original);
  process.stdout.write(JSON.stringify({ ok: true, scratch, baseline, sourceSha256, formats: ['docx', 'pdf', 'markdown'] }) + '\n');
} finally {
  await writeFile(path.join(scratch, 'receipt.json'), JSON.stringify({ baseline, image, sourcePath, sourceSha256, receipts }, null, 2));
  process.stdout.write(`Retained Date export evidence: ${scratch}\n`);
}
