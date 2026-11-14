import { documentDocxImageAssets } from './document-image-assets.js';
import { projectDocumentDocxPage } from './document-docx-page.js';
import { documentExportProfile, cssPxToTwips, wordFontSize } from './document-export-profile.js';
import { documentDocxDividers, projectDocumentDocxDividers } from './document-docx-dividers.js';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { load } from 'cheerio';
import JSZip from 'jszip';
import { bundleStandaloneHtml } from '../artifacts/standalone-html.js';
import { documentHtml, documentMetadataDirective, documentMetadataSchema } from '@open-design/contracts/runtime/document';
import { documentDocxSourcePresentation, normalizedDocumentDocxHtml, resolvedDocumentDocxPresentationOwners } from './document-docx-source-colors.js';
import { projectDocumentDocxPresentation } from './document-docx-colors.js';
import { normalizeDocumentDocxPresentation } from './document-color-normalize.js';
import { documentMarkdownInput, restoreDocumentMarkdownOwners } from './document-markdown.js';

type Font = 'sans' | 'serif';
const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 50 * 1024 * 1024;
const markdownFile = (name: string) => /\.(md|markdown)$/i.test(name);

/** The converter runs only inside the existing network-disabled render worker. */
function pandoc(args: string[], input?: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = execFile('/usr/local/bin/pandoc', [...args, '+RTS', '-M512M', '-RTS'], { timeout: 30_000, maxBuffer: MAX_OUTPUT_BYTES, encoding: 'buffer' }, (error, stdout) => {
      if (error) reject(new Error('The document converter could not preserve this input.'));
      else resolve(stdout);
    });
    child.stdin?.on('error', () => {});
    child.stdin?.end(input);
  });
}

export function markdownSource(source: string): { body: string; fonts: { text: Font; headings: Font } } {
  const match = source.match(documentMetadataDirective);
  if (match) {
    try {
      const parsed = documentMetadataSchema.safeParse(JSON.parse(Buffer.from(match[1]!, 'base64').toString('utf8')));
      if (parsed.success) return { body: source.slice(match[0].length), fonts: parsed.data.fonts };
    } catch { /* Invalid metadata remains ordinary Markdown content. */ }
  }
  return { body: source, fonts: { text: 'sans', headings: 'serif' } };
}

/** Refuse application runtimes rather than flattening them into misleading documents. */
export async function prepareDocument(content: string, fileName: string, title: string): Promise<string | null> {
  if (Buffer.byteLength(content) > MAX_DOCUMENT_BYTES) {
    if (markdownFile(fileName)) throw new Error('This document exceeds its export byte limit.');
    return null;
  }
  let html = content;
  if (markdownFile(fileName)) {
    const source = markdownSource(content);
    // Browser GFM treats YAML-looking blocks as visible Markdown, not metadata.
    // Only markdownSource's validated Eve directive owns document metadata.
    const body = await pandoc(['--sandbox', '--from=gfm+raw_html-yaml_metadata_block', '--to=html', '--wrap=none', '--fail-if-warnings'], source.body);
    html = documentHtml(title, body.toString('utf8'), source.fonts.text, source.fonts.headings);
  }
  const $ = load(html);
  if ($('html').attr('data-eve-document') !== '1') return null;
  $('ul.task-list input[type="checkbox"]').attr('disabled', '');
  $('li[aria-checked]').each((_index, item) => {
    const li = $(item); li.parent('ul').addClass('task-list');
    if (!li.find('input').length) { li.wrapInner('<label></label>'); li.children('label').prepend(`<input type="checkbox" disabled${li.attr('aria-checked') === 'true' ? ' checked' : ''}>`); }
  });
  if ($('script,iframe,object,embed,form,button,video,audio,canvas').length || $('input').toArray().some(input => $(input).attr('type') !== 'checkbox' || !$(input).is('[disabled]') || !$(input).closest('li').length) || $('[srcdoc]').length || $('*').toArray().some(element => 'attribs' in element && Object.keys(element.attribs).some(name => /^on/i.test(name)))) throw new Error('This document contains interactive content. Export its application view instead.');
  return $.html();
}

/** Word styles use the same independent heading/body font choices as the editor. */
export async function documentReference(bytes: Buffer, fonts: { text: Font; headings: Font }): Promise<Buffer> {
  const zip = await JSZip.loadAsync(bytes);
  const file = zip.file('word/styles.xml');
  if (!file) throw new Error('The document style reference is unavailable.');
  const $ = load(await file.async('string'), { xml: true });
  const fontName = (font: Font) => documentExportProfile.fonts[font];
  const setFont = (properties: ReturnType<typeof $>, font: Font) => {
    properties.find('w\\:rFonts').remove();
    properties.prepend(`<w:rFonts w:ascii="${fontName(font)}" w:hAnsi="${fontName(font)}" w:eastAsia="${fontName(font)}" w:cs="${fontName(font)}"/>`);
  };
  const defaults = $('w\\:docDefaults w\\:rPrDefault w\\:rPr');
  setFont(defaults, fonts.text);
  defaults.find('w\\:sz,w\\:szCs').remove();
  const defaultSize = `<w:sz w:val="${wordFontSize(documentExportProfile.body.sizePx)}"/><w:szCs w:val="${wordFontSize(documentExportProfile.body.sizePx)}"/>`;
  const defaultLang = defaults.children('w\\:lang').first();
  if (defaultLang.length) defaultLang.before(defaultSize); else defaults.append(defaultSize);
  for (const style of $('w\\:style').toArray()) {
    const item = $(style); const id = item.attr('w:styleId') ?? '';
    if (!['Normal', 'BodyText', 'FirstParagraph', 'Compact'].includes(id) && !/^Heading[1-6]$/.test(id)) continue;
    if (!item.children('w\\:rPr').length) item.append('<w:rPr/>');
    const properties = item.children('w\\:rPr');
    const heading = /^Heading([1-6])$/.exec(id);
    setFont(properties, heading ? fonts.headings : fonts.text);
    properties.find('w\\:sz,w\\:szCs').remove();
    const geometry = heading ? documentExportProfile.headings[Number(heading[1])-1]! : { ...documentExportProfile.body, beforePx: 0, afterPx: id === 'Compact' ? 0 : documentExportProfile.body.afterPx };
    const size = wordFontSize(geometry.sizePx);
    if (!item.children('w\\:pPr').length) item.append('<w:pPr/>');
    const paragraph = item.children('w\\:pPr');
    paragraph.find('w\\:spacing').remove();
    const spacing = `<w:spacing w:before="${cssPxToTwips(geometry.beforePx)}" w:after="${cssPxToTwips(geometry.afterPx)}" w:line="${cssPxToTwips(geometry.linePx)}" w:lineRule="atLeast"/>`;
    const laterParagraphProperty = paragraph.children('w\\:ind,w\\:contextualSpacing,w\\:mirrorIndents,w\\:suppressOverlap,w\\:jc,w\\:textDirection,w\\:textAlignment,w\\:textboxTightWrap,w\\:outlineLvl,w\\:divId,w\\:cnfStyle,w\\:rPr,w\\:sectPr,w\\:pPrChange').first();
    if (laterParagraphProperty.length) laterParagraphProperty.before(spacing); else paragraph.append(spacing);
    // Pandoc's stock reference colors/italic heading defaults are not authored
    // canonical styles. Explicit source formatting remains native run data.
    if (heading) properties.find('w\\:color,w\\:b,w\\:bCs,w\\:i,w\\:iCs').remove();
    const sizes = `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>`;
    const laterRunProperty = properties.children('w\\:highlight,w\\:u,w\\:effect,w\\:bdr,w\\:shd,w\\:fitText,w\\:vertAlign,w\\:rtl,w\\:cs,w\\:em,w\\:lang,w\\:eastAsianLayout,w\\:specVanish,w\\:oMath,w\\:rPrChange').first();
    if (laterRunProperty.length) laterRunProperty.before(sizes); else properties.append(sizes);
  }
  zip.file('word/styles.xml', $.xml());
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

export async function exportDocument(html: string, original: string, fileName: string, format: 'docx' | 'markdown', title: string, readAsset: (name: string) => Promise<{ buffer: Buffer; size: number; mime: string } | null>): Promise<{ body: Buffer; file: string; mime: string }> {
  if (format === 'markdown') {
    let body: Buffer;
    if (markdownFile(fileName)) body = Buffer.from(markdownSource(original).body);
    else {
      const input = documentMarkdownInput(html);
      if (!input.rawSpans.size && !input.rawBlocks.size) body = await pandoc(['--sandbox', '--from=html+raw_html', '--to=gfm+raw_html', '--wrap=none', '--fail-if-warnings'], input.html);
      else {
        const ast = JSON.parse((await pandoc(['--sandbox', '--from=html+raw_html', '--to=json', '--fail-if-warnings'], input.html)).toString('utf8'));
        body = await pandoc(['--sandbox', '--from=json', '--to=gfm+raw_html', '--wrap=none', '--fail-if-warnings'], JSON.stringify(restoreDocumentMarkdownOwners(ast, input.rawSpans, input.rawBlocks)));
      }
    }
    return { body, file: 'artifact.md', mime: 'text/markdown' };
  }
  const directory = await mkdtemp(path.join(tmpdir(), 'document-export-'));
  try {
    const bundled = await bundleStandaloneHtml({ entryPath: fileName, html, readAsset });
    if (bundled.externalDependencies.length) throw new Error('Bundle document images and styles locally before exporting.');
    const $ = load(bundled.html);
    const font = $('html').attr('data-eve-document-font') === 'serif' ? 'serif' : 'sans';
    const headings = $('html').attr('data-eve-document-heading-font') ?? font;
    // HTML title is file metadata, not a second visible title before the document's H1.
    $('head title').remove();
    const reference = await documentReference(await pandoc(['--print-default-data-file=reference.docx']), { text: font, headings: headings === 'serif' ? 'serif' : 'sans' });
    const referencePath = path.join(directory, 'reference.docx');
    await writeFile(referencePath, reference, { flag: 'wx', mode: 0o600 });
    const source = documentDocxSourcePresentation($.html());
    const normalized = await normalizeDocumentDocxPresentation(source.html, source.requests, source.attributeName);
    const dividers = documentDocxDividers(normalizedDocumentDocxHtml(source, normalized), source, normalized);
    const ast = JSON.parse((await pandoc(['--sandbox', '--from=html+raw_html', '--to=json', '--fail-if-warnings'], dividers.html)).toString('utf8'));
    const textSource = { ...source, requests: source.requests.filter(request => request.kind !== 'divider') };
    const textIds = new Set(textSource.requests.map(request => request.id));
    const owners = resolvedDocumentDocxPresentationOwners(ast, textSource, new Map([...normalized].filter(([id]) => textIds.has(id))));
    const converted = await pandoc(['--sandbox', '--from=json', '--to=docx', `--reference-doc=${referencePath}`, '--fail-if-warnings'], JSON.stringify(ast));
    const zip = await JSZip.loadAsync(converted);
    const document = zip.file('word/document.xml');
    if (!document) throw new Error('The document converter did not produce editable Word content.');
    const imageAssets = owners.some(owner => owner.imageAssetSha256) ? await documentDocxImageAssets(zip) : undefined;
    zip.file('word/document.xml', projectDocumentDocxPage(projectDocumentDocxDividers(projectDocumentDocxPresentation(await document.async('string'), owners, imageAssets), dividers.owners)));
    const core = zip.file('docProps/core.xml');
    if (core) { const properties = load(await core.async('string'), { xml: true }); properties('dc\\:title').text(title); zip.file('docProps/core.xml', properties.xml()); }
    const body = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    if (body.length > MAX_OUTPUT_BYTES) throw new Error('The document export exceeds its byte limit.');
    return { body, file: 'artifact.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
  } finally { await rm(directory, { recursive: true, force: true }); }
}

/** Print geometry measured from the authorized document reference export. */
export { documentExportPrintCss as documentPrintCss } from './document-export-profile.js';
export function documentPrintOptions(title: string): Parameters<import('playwright-core').Page['pdf']>[0] {
  const header = load('<div></div>');
  header('div').attr('style', 'width:100%;font:9px Arial,sans-serif;color:Gray;padding:0 60px').text(title);
  return {
    format: 'Letter', printBackground: true, preferCSSPageSize: false,
    margin: { top: `${documentExportProfile.page.marginPt / 72}in`, right: `${documentExportProfile.page.marginPt / 72}in`, bottom: `${documentExportProfile.page.marginPt / 72}in`, left: `${documentExportProfile.page.marginPt / 72}in` },
    displayHeaderFooter: true, headerTemplate: header('div').toString(),
    footerTemplate: '<div style="width:100%;font:9px Arial,sans-serif;color:Gray;text-align:right;padding:0 60px">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
  };
}
