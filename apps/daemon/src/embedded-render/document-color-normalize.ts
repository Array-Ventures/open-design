import { readFile } from 'node:fs/promises';
import { chromium, type Page } from 'playwright-core';
import { load } from 'cheerio';
import { MAX_STANDALONE_OUTPUT_BYTES } from '../artifacts/standalone-html.js';
import { documentHtml } from '@open-design/contracts/runtime/document';
import type { DocumentColorRequest, NormalizedDocumentColors } from '@open-design/document-style/color';

const browserScript = '/opt/render/document-color.iife.js';
const fail = (): never => { throw new Error('The document converter could not preserve normalized color ownership.'); };
function ownedStyles(html: string): string[] {
  const $ = load(html), root = $('html');
  const canonical = load(documentHtml('', '', root.attr('data-eve-document-font') === 'serif' ? 'serif' : 'sans', root.attr('data-eve-document-heading-font') === 'sans' ? 'sans' : 'serif'));
  return [canonical('style').text()];
}
/** Operates only on a transient contained page; never returns modified source. */
export async function normalizeDocumentDocxColors(html: string, requests: readonly DocumentColorRequest[], attributeName: string): Promise<ReadonlyMap<string, NormalizedDocumentColors>> {
  if (Buffer.byteLength(html) > MAX_STANDALONE_OUTPUT_BYTES) throw new Error('The bundled document exceeds its standalone export byte limit.');
  const $ = load(html);
  // This private browser boundary also refuses executable source if called
  // independently of prepareDocument's ordinary static-document admission.
  if ($('script,iframe,object,embed,form,button,video,audio,canvas,[srcdoc]').length || $('*').toArray().some(element => 'attribs' in element && Object.keys(element.attribs).some(name => /^on/i.test(name)))) return fail();
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--disable-dev-shm-usage'] });
  try {
    const page = await browser.newPage({ serviceWorkers: 'block' });
    let unavailable = false;
    await page.route('**/*', async route => { if (['data:', 'blob:'].includes(new URL(route.request().url()).protocol)) await route.continue(); else { unavailable = true; await route.abort('blockedbyclient'); } });
    page.on('dialog', dialog => { void dialog.dismiss(); }); page.on('popup', popup => { void popup.close(); });
    await page.emulateMedia({ media: 'print' });
    await page.setContent(html, { waitUntil: 'networkidle', timeout: 30_000 });
    await page.evaluate('Promise.all([document.fonts.ready,...Array.from(document.images).map(image=>image.decode().catch(()=>{}))])');
    if (unavailable) return fail();
    await page.addScriptTag({ content: await readFile(browserScript, 'utf8') });
    const result: unknown = await page.evaluate(`globalThis.odDocumentColor.normalizeDocumentColorOwners(document,${JSON.stringify(requests)},${JSON.stringify(attributeName)},${JSON.stringify(ownedStyles(html))})`);
    if (!Array.isArray(result) || result.length !== requests.length) return fail();
    const expected = new Map(requests.map(request => [request.id, request.kind])), colors = new Map<string, NormalizedDocumentColors>();
    for (const entry of result) {
      if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string' || !expected.has(entry.id) || colors.has(entry.id) || !entry.colors || typeof entry.colors !== 'object' || Array.isArray(entry.colors)) return fail();
      for (const [key, value] of Object.entries(entry.colors)) {
        if (key === 'foregroundSource' ? typeof value !== 'string' || !['authored','inherited'].includes(value) : !['foreground','background'].includes(key) || typeof value !== 'string' || !/^[A-F0-9]{6}$/.test(value)) return fail();
      }
      if (Object.hasOwn(entry.colors, 'foreground') !== Object.hasOwn(entry.colors, 'foregroundSource') || (expected.get(entry.id) === 'cell' && (Object.hasOwn(entry.colors, 'foreground') || Object.hasOwn(entry.colors, 'foregroundSource')))) return fail();
      colors.set(entry.id, entry.colors);
    }
    if (unavailable) return fail(); return colors;
  } finally { await browser.close(); }
}
export async function repairDocumentPdfColors(page: Page, html: string, printStyles: readonly string[]): Promise<void> {
  await page.emulateMedia({ media: 'print' });
  await page.evaluate('Promise.all([document.fonts.ready,...Array.from(document.images).map(image=>image.decode().catch(()=>{}))])');
  await page.addScriptTag({ content: await readFile(browserScript, 'utf8') });
  // Unknown authored selectors decline correction; PDF keeps that exact layout.
  await page.evaluate(`globalThis.odDocumentColor.repairDocumentPrintInk(document,${JSON.stringify([...ownedStyles(html), ...printStyles])})`);
}
