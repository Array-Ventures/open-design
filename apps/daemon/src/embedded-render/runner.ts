import { extractSpeakerNotesFromHtml } from '@open-design/contracts/runtime/speaker-notes';
import { withPptxSpeakerNotes } from './pptx-notes.js';
import { editablePptx } from './editable-pptx.js';
import { renderHtmlTemplateV1 } from '../live-artifacts/render.js';
import { validateBoundedJsonObject } from '../live-artifacts/schema.js';
import { captureHyperFrames } from './hyperframes.js';
import { hyperFramesCompositionMetrics, injectHyperFramesFrameBridge } from '../media/hyperframes-frame-bridge.js';
import { prepareHyperFramesAudio, type HyperFramesAudioTrack } from '../media/hyperframes-audio.js';
import { injectMotionSourcePlayer } from '@open-design/contracts/runtime/motion-source-player';
import { isMediaExport, renderMedia } from './media.js';
import { createServer } from 'node:http';
import { readFile, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { injectDeckStageFallback } from '@open-design/contracts/runtime/deck-stage-fallback';
import { bundleStandaloneHtml } from '../artifacts/standalone-html.js';
import { buildScreenshotPdf, buildScreenshotPptx, type SlideImage } from '../deck-export.js';
import { prepareDocument, exportDocument, documentPrintCss, documentPrintOptions } from './documents.js';
import { RenderInput } from './input.js';
import { renderWorkbook } from './workbooks.js';

const MIME: Record<string, string> = { '.html': 'text/html', '.htm': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };
const mime = (name: string) => MIME[path.extname(name).toLowerCase()] ?? 'application/octet-stream';
const slideSelector = '.slide, [data-screen-label], .deck-slide, .ppt-slide';
const realSlideSelector = `:is(${slideSelector}):not(.mini-slide *, .overview *, .notes-overlay *, .thumb *)`;

/** Runs ONLY in the host's disposable, network-disabled render container. */
export async function renderSnapshot(source: string, output: string, value: unknown) {
  const input = RenderInput.parse(value);
  if (isMediaExport(input.format)) return renderMedia(source, output, input.fileName, input.format);
  const root = await realpath(source);
  async function asset(name: string) {
    if (name.split('/').some((part) => !part || part === '.' || part === '..' || /[\\\0]/.test(part))) throw new Error('Invalid asset path');
    const file = await realpath(path.join(root, name));
    if (!file.startsWith(root + path.sep)) throw new Error('Asset outside snapshot');
    const info = await stat(file);
    if (!info.isFile() || info.size > 50 * 1024 * 1024) throw new Error('Asset size limit');
    return readFile(file);
  }
  if (input.format === 'workbook' || input.format === 'xlsx' || input.format === 'csv') return renderWorkbook(output, { fileName: input.fileName, format: input.format, ...(input.sheetId ? { sheetId: input.sheetId, workbookSourceSha256: input.workbookSourceSha256! } : {}), ...(input.dataFile ? { dataFile: input.dataFile } : {}), ...(input.restore ? { restore: input.restore } : {}) }, asset);
  const original = (await asset(input.fileName)).toString('utf8');
  let html = original;
  const document = !input.deck && !input.dataFile ? await prepareDocument(html, input.fileName, input.title) : null;
  if (['docx', 'markdown'].includes(input.format)) {
    if (!document) throw new Error('Choose a document artifact for this export.');
    const result = await exportDocument(document, original, input.fileName, input.format as 'docx' | 'markdown', input.title, async name => {
      try { const buffer = await asset(name); return { buffer, size: buffer.length, mime: mime(name) }; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
    });
    await writeFile(path.join(output, result.file), result.body, { flag: 'wx', mode: 0o600 });
    return { file: result.file, mime: result.mime };
  }
  if (document) html = document;
  if (input.dataFile) {
    const bytes = await asset(input.dataFile);
    if (bytes.length > 1024 * 1024 || Buffer.byteLength(html) > 2 * 1024 * 1024) throw new Error('Dashboard source exceeds its JSON/template byte limit.');
    const data = validateBoundedJsonObject(JSON.parse(bytes.toString('utf8')));
    if (!data.ok) throw new Error(data.error);
    html = renderHtmlTemplateV1({ templateHtml: html, dataJson: data.value, maxOutputBytes: 10 * 1024 * 1024 }).html;
    if (Buffer.byteLength(html) > 10 * 1024 * 1024) throw new Error('Rendered dashboard exceeds its byte limit.');
  }
  let composition: ReturnType<typeof hyperFramesCompositionMetrics> | undefined;
  let audioTracks: HyperFramesAudioTrack[] = [];
  if (input.format === 'hyperframes') {
    html = injectMotionSourcePlayer(html);
    composition = hyperFramesCompositionMetrics(html);
    if (composition.width > 3840 || composition.height > 2160 || composition.fps > 60) throw new Error('HyperFrames export exceeds 3840×2160 or 60 fps.');
    const audio = await prepareHyperFramesAudio(html, path.dirname(path.join(root, input.fileName)));
    audioTracks = audio.tracks;
    html = injectHyperFramesFrameBridge(audio.html, await readFile('/opt/render/hyperframe.runtime.iife.js', 'utf8'));
  }
  if (input.format === 'html') {
    const result = await bundleStandaloneHtml({ entryPath: input.fileName, html, readAsset: async (name) => {
      try { const buffer = await asset(name); return { buffer, size: buffer.length, mime: mime(name) }; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
    } });
    await writeFile(path.join(output, 'artifact.html'), result.html, { flag: 'wx', mode: 0o600 });
    return { file: 'artifact.html', mime: 'text/html', externalDependencies: result.externalDependencies };
  }
  const deck = input.deck || input.format === 'pptx';
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const name = decodeURIComponent(url.pathname.slice(1));
      const buffer = name === input.fileName ? Buffer.from(deck ? injectDeckStageFallback(html) : html) : await asset(name);
      res.writeHead(200, { 'content-type': name === input.fileName && document ? 'text/html' : mime(name), 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' }).end(buffer);
    } catch { res.writeHead(404).end(); }
  });
  server.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Render server unavailable');
  const origin = `http://127.0.0.1:${address.port}`;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    // The containing worker has no network, credentials, host namespaces or
    // writable mounts beyond its bounded output. It is not a bot browser.
    browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--disable-dev-shm-usage'] });
    const page = await browser.newPage({ viewport: { width: composition?.width ?? input.width ?? (deck ? 1920 : 1440), height: composition?.height ?? input.height ?? (deck ? 1080 : 900) }, serviceWorkers: 'block' });
    const unavailable = new Set<string>();
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === origin || ['data:', 'blob:'].includes(url.protocol)) await route.continue();
      else { unavailable.add(url.origin); await route.abort('blockedbyclient'); }
    });
    page.on('response', (response) => { if (response.status() >= 400) unavailable.add(new URL(response.url()).pathname); });
    page.on('dialog', (dialog) => { void dialog.dismiss(); });
    page.on('popup', (popup) => { void popup.close(); });
    await page.goto(`${origin}/${input.fileName.split('/').map(encodeURIComponent).join('/')}`, { waitUntil: 'networkidle', timeout: 30_000 });
    await page.evaluate('Promise.all([document.fonts.ready,...Array.from(document.images).map(i=>i.decode().catch(()=>{}))])');
    if (input.format === 'hyperframes') {
      if (unavailable.size) throw new Error('Bundle all HyperFrames resources locally before exporting.');
      const captured = await captureHyperFrames(page, output, audioTracks);
      if (unavailable.size) throw new Error('Bundle all HyperFrames resources locally before exporting.');
      return captured;
    }
    await page.addStyleTag({ content: '*,*::before,*::after{animation-play-state:paused!important;transition:none!important;caret-color:transparent!important}' });
    if (unavailable.size) throw new Error('Required resources are unavailable. Bundle remote fonts, scripts and assets into the project before exporting.');
    if (document && input.format === 'pdf') await page.addStyleTag({ content: documentPrintCss });
    const images: SlideImage[] = [];
    if (deck) {
      // The live preview scales a logical deck to its panel. An export captures
      // the authored slide size rather than that transient panel transform.
      await page.evaluate("document.querySelectorAll('deck-stage').forEach(stage=>stage.setAttribute('noscale',''))");
      await page.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
      const slides = page.locator(realSlideSelector);
      // Filter out presenter clones by ancestors, matching the shared host convention.
      const count = await slides.count();
      if (typeof count !== 'number' || count < 1 || count > 200) throw new Error('A deck must contain between 1 and 200 slides.');
      if (input.format === 'pptx' && input.editable) {
        const body = await withPptxSpeakerNotes(await editablePptx(page, realSlideSelector), extractSpeakerNotesFromHtml(html));
        if (unavailable.size) throw new Error('Bundle all editable deck resources locally before exporting.');
        if (body.length > 250 * 1024 * 1024) throw new Error('Export exceeds its byte limit.');
        await writeFile(path.join(output, 'artifact.pptx'), body, { flag: 'wx', mode: 0o600 });
        return { file: 'artifact.pptx', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', pages: count };
      }
      const start = input.format === 'image' ? input.index ?? 0 : 0;
      const end = input.format === 'image' ? start + 1 : count;
      if (start >= count) throw new Error('Slide index is outside this deck.');
      await page.addStyleTag({ content: '.progress-bar,.notes-overlay,aside.notes,.speaker-notes,.deck-nav,.deck-hint,.deck-counter{visibility:hidden!important}' });
      for (let index = start; index < end; index++) {
        await page.evaluate(`window.postMessage({type:'od:slide',action:'go',index:${index}},'*')`);
        await page.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
        // Select the same non-clone ordinal used for the count above.
        const selected = slides.filter({ visible: true });
        const visible = await selected.count();
        const target = visible === 1 ? selected.first() : slides.nth(index);
        const type = input.format === 'image' ? input.imageFormat : 'png';
        images.push({ buffer: await target.screenshot({ type, timeout: 10_000 }), jpeg: type === 'jpeg' });
      }
    } else if (input.format === 'image') {
      const height = await page.evaluate('Math.max(document.documentElement.scrollHeight,document.body.scrollHeight)');
      if (typeof height !== 'number' || height > 20_000) throw new Error('Page image exceeds the 20,000 pixel export limit.');
      images.push({ buffer: await page.screenshot({ fullPage: true, type: input.imageFormat, timeout: 15_000 }), jpeg: input.imageFormat === 'jpeg' });
    }
    const extension = input.format === 'image' ? images[0]?.jpeg ? 'jpg' : 'png' : input.format;
    const file = `artifact.${extension}`;
    const body = input.format === 'pptx' ? await withPptxSpeakerNotes(await buildScreenshotPptx(images, { title: input.title, aspect: (input.width ?? 1920) / (input.height ?? 1080) }), extractSpeakerNotesFromHtml(html))
      : input.format === 'pdf' ? deck ? await buildScreenshotPdf(images) : await page.pdf(document ? documentPrintOptions(input.title) : { printBackground: true, preferCSSPageSize: true, format: 'A4' })
      : images[0]!.buffer;
    if (body.length > 250 * 1024 * 1024) throw new Error('Export exceeds its byte limit.');
    await writeFile(path.join(output, file), body, { flag: 'wx', mode: 0o600 });
    return { file, mime: extension === 'pptx' ? 'application/vnd.openxmlformats-officedocument.presentationml.presentation' : extension === 'pdf' ? 'application/pdf' : extension === 'jpg' ? 'image/jpeg' : 'image/png', pages: images.length || 1 };
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
