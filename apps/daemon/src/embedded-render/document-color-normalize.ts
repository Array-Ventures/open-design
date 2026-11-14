import { validDocumentFontSize, validDocumentFontLineHeight } from '@open-design/document-style';
import { documentExportProfile, documentExportPrintCss } from './document-export-profile.js';
import { readFile } from 'node:fs/promises';
import { chromium, type Page } from 'playwright-core';
import { load } from 'cheerio';
import { MAX_STANDALONE_OUTPUT_BYTES } from '../artifacts/standalone-html.js';
import { documentHtml } from '@open-design/contracts/runtime/document';
import type { DocumentPresentationRequest, NormalizedDocumentPresentation } from '@open-design/document-style';

const browserScript = '/opt/render/document-color.iife.js';
const fail = (): never => { throw new Error('The document converter could not preserve normalized presentation ownership.'); };
function ownedStyles(html: string): string[] {
  const $ = load(html), root = $('html');
  const canonical = load(documentHtml('', '', root.attr('data-eve-document-font') === 'serif' ? 'serif' : 'sans', root.attr('data-eve-document-heading-font') === 'sans' ? 'sans' : 'serif'));
  return [canonical('style').text()];
}
/** Operates only on a transient contained page; never returns modified source. */
export async function normalizeDocumentDocxPresentation(html: string, requests: readonly DocumentPresentationRequest[], attributeName: string): Promise<ReadonlyMap<string, NormalizedDocumentPresentation>> {
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
    await page.addStyleTag({ content: documentExportPrintCss });
    await page.evaluate('Promise.all([document.fonts.ready,...Array.from(document.images).map(image=>image.decode().catch(()=>{}))])');
    if (unavailable) return fail();
    await page.addScriptTag({ content: await readFile(browserScript, 'utf8') });
    const result: unknown = await page.evaluate(`globalThis.odDocumentColor.normalizeDocumentPresentationOwners(document,${JSON.stringify(requests)},${JSON.stringify(attributeName)},${JSON.stringify([...ownedStyles(html), documentExportPrintCss])})`);
    if (!Array.isArray(result) || result.length !== requests.length) return fail();
    const expected = new Map(requests.map(request => [request.id, request.kind])), presentations = new Map<string, NormalizedDocumentPresentation>();
    for (const entry of result) {
      if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string' || !expected.has(entry.id) || presentations.has(entry.id) || !entry.presentation || typeof entry.presentation !== 'object' || Array.isArray(entry.presentation)) return fail();
      for (const [key, value] of Object.entries(entry.presentation)) {
        if (key === 'foregroundSource') { if (typeof value !== 'string' || !['authored','inherited'].includes(value)) return fail(); }
        else if (key === 'fontSizeSource') { if (value !== 'authored') return fail(); }
        else if (key === 'fontSizePt') { if (!validDocumentFontSize(value)) return fail(); }
        else if (key === 'fontLineHeightPt') { if (!validDocumentFontLineHeight(value)) return fail(); }
        else if (!['foreground','background'].includes(key) || typeof value !== 'string' || !/^[A-F0-9]{6}$/.test(value)) return fail();
      }
      if (Object.hasOwn(entry.presentation, 'foreground') !== Object.hasOwn(entry.presentation, 'foregroundSource') || (expected.get(entry.id) === 'cell' && (Object.hasOwn(entry.presentation, 'foreground') || Object.hasOwn(entry.presentation, 'foregroundSource')))) return fail();
      const fontFields = ['fontSizePt','fontLineHeightPt','fontSizeSource'].filter(key => Object.hasOwn(entry.presentation, key));
      if (fontFields.length && (fontFields.length !== 3 || expected.get(entry.id) !== 'inline')) return fail();
      presentations.set(entry.id, entry.presentation);
    }
    if (unavailable) return fail(); return presentations;
  } finally { await browser.close(); }
}
export const documentDividerPrintCss = `@media print{hr{border:0;border-block-start:${documentExportProfile.rule.borderPx}px solid currentColor;margin-block:${documentExportProfile.rule.marginPx}px}}`;
export async function repairDocumentPdfColors(page: Page, html: string, printStyles: readonly string[]): Promise<void> {
  await page.emulateMedia({ media: 'print' });
  await page.evaluate('Promise.all([document.fonts.ready,...Array.from(document.images).map(image=>image.decode().catch(()=>{}))])');
  await page.addScriptTag({ content: await readFile(browserScript, 'utf8') });
  // This conversion-only rule matches the editor's border-only divider. Apply
  // it only after the original DOM/styles pass the shared bounded policy.
  const styles = [...ownedStyles(html), ...printStyles];
  const qualified = await page.evaluate(`globalThis.odDocumentColor.documentColorLayoutQualified(document,${JSON.stringify(styles)})`);
  if (qualified === true) { await page.addStyleTag({ content: documentDividerPrintCss }); styles.push(documentDividerPrintCss); }
  // Unknown authored selectors decline correction; PDF keeps that exact layout.
  await page.evaluate(`globalThis.odDocumentColor.repairDocumentPrintInk(document,${JSON.stringify(styles)})`);
}

export const normalizeDocumentDocxColors = normalizeDocumentDocxPresentation;
