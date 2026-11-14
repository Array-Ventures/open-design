import { randomBytes } from 'node:crypto';
import { load } from 'cheerio';
import { documentDocxPresentationOwners } from './document-docx-colors.js';
import { validDocumentFontSize, validDocumentFontLineHeight, validDocumentHeadingImage, validDocumentHeadingMetadata, type DocumentPresentationRequest, type NormalizedDocumentPresentation } from '@open-design/document-style';

export type DocumentDocxColorRequest = DocumentPresentationRequest;
export interface DocumentDocxPresentationSource { html: string; attributeName: string; requests: DocumentPresentationRequest[] }
const fail = (): never => { throw new Error('The document converter could not preserve normalized presentation ownership.'); };

/** Temporary conversion-only data attributes preserve all authored IDs. Neutral
 * text wrappers allow the contained DOM adapter to resolve inherited ink and
 * actual nested backgrounds without reproducing CSS ownership rules here. */
export function documentDocxSourcePresentation(html: string): DocumentDocxPresentationSource {
  const $ = load(html), requests: DocumentPresentationRequest[] = [];
  let attributeName: string;
  do { attributeName = `data-eve-docx-color-${randomBytes(8).toString('hex')}`; }
  while ($(`[${attributeName}],[${attributeName.slice(5)}],[${attributeName}-image],[${attributeName.slice(5)}-image]`).length);
  const add = (kind: DocumentPresentationRequest['kind']) => { if (requests.length >= 20000) return fail(); const id = String(requests.length); requests.push({ id, kind }); return id; };
  const htmlNamespace = 'http://www.w3.org/1999/xhtml';
  // Foreign syntax (for example passive MathML) has a separate admission owner.
  // Never insert HTML spans/attributes into it or its embedded descendants.
  const foreign = (elements: ReturnType<typeof $>) => elements.toArray().some(parent => parent.type === 'tag' && Boolean(parent.namespace && parent.namespace !== htmlNamespace));
  $('h1,h2,h3,h4,h5,h6').each((_index, heading) => {
    if (foreign($(heading).add($(heading).parents()))) return;
    const id = add('heading');
    $(heading).attr(attributeName,id);
    const images = $(heading).find('img');
    if (images.length === 1) images.attr(`${attributeName}-image`,id);
  });
  $('hr').each((_index, rule) => { if (!foreign($(rule).add($(rule).parents()))) $(rule).attr(attributeName, add('divider')); });
  $('td,th').each((_index, cell) => { if (!foreign($(cell).add($(cell).parents()))) $(cell).attr(attributeName, add('cell')); });
  // Snapshot direct TextNodes before adding wrappers; never walk newly wrapped
  // children a second time or reinterpret source IDs as generated ownership.
  const structural = new Set(['body','main','div','table','thead','tbody','tfoot','tr','colgroup','ul','ol']);
  const text = $('body,body *').contents().toArray().filter(node => node.type === 'text' && (Boolean(node.data.trim()) || !structural.has(node.parent?.type === 'tag' ? node.parent.name : '')));
  for (const node of text) {
    if ($(node).parents('script,style').length || foreign($(node).parents())) continue;
    $(node).wrap(`<span ${attributeName}="${add('inline')}"></span>`);
  }
  return { html: $.html(), attributeName, requests };
}

/** Restore neutral conversion wrappers before parsing: even an uncolored
 * whitespace SPAN can turn collapsed block indentation into visible paragraphs.
 * Only generated wrappers with an explicitly empty normalized descriptor may
 * disappear; the DOM resolver owns visibility/paint admission. */
export function normalizedDocumentDocxHtml(source: DocumentDocxPresentationSource, resolved: ReadonlyMap<string, NormalizedDocumentPresentation>): string {
  const $ = load(source.html), expected = new Set(source.requests.map(request => request.id));
  if (resolved.size !== expected.size || [...resolved.keys()].some(id => !expected.has(id))) return fail();
  for (const request of source.requests) {
    const value = resolved.get(request.id) ?? fail();
    if (value.fontSizePt !== undefined || value.fontLineHeightPt !== undefined || value.fontSizeSource !== undefined) {
      if (request.kind !== 'inline' || value.fontSizeSource !== 'authored' || !validDocumentFontSize(value.fontSizePt) || !validDocumentFontLineHeight(value.fontLineHeightPt)) return fail();
    }
    if (Object.keys(value).some(key => key.startsWith('heading'))) {
      if (request.kind !== 'heading' || !validDocumentHeadingMetadata(value)) return fail();
    }
    if (Object.keys(value).some(key => key.startsWith('headingImage')) && (request.kind !== 'heading' || !validDocumentHeadingImage(value))) return fail();
    if (!value.headingImageSource) $(`[${source.attributeName}-image="${request.id}"]`).removeAttr(`${source.attributeName}-image`);
    for (const color of [value.foreground, value.background]) if (color !== undefined && !/^[A-Fa-f0-9]{6}$/.test(color)) return fail();
    if (request.kind !== 'inline' || value.foreground || value.background || value.fontSizePt !== undefined) continue;
    const wrapper = $(`[${source.attributeName}="${request.id}"]`);
    if (wrapper.length !== 1 || wrapper[0]?.type !== 'tag' || wrapper[0].name !== 'span' || wrapper.contents().toArray().some(node => node.type !== 'text')) return fail();
    wrapper.replaceWith(wrapper.contents());
  }
  return $.html();
}

/** Pandoc strips the HTML data- prefix. Remove only our generated attribute
 * before native conversion, and fail if any normalized colored owner vanished
 * (for example an unsupported code importer) rather than dropping its color. */
export function resolvedDocumentDocxPresentationOwners(ast: unknown, source: DocumentDocxPresentationSource, resolved: ReadonlyMap<string, NormalizedDocumentPresentation>) {
  const expected = new Map(source.requests.map(request => [request.id, request.kind])), seen = new Set<string>(), key = source.attributeName.slice(5);
  if (resolved.size !== expected.size || [...resolved.keys()].some(id => !expected.has(id))) return fail();
  const imageKey = `${key}-image`;
  const inspect = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(inspect); return; }
    const item = node as {t?:string;c?:unknown[]};
    if (item.t === 'Header' && Array.isArray(item.c)) {
      const attributes = item.c[1] as unknown[];
      const own = Array.isArray(attributes?.[2]) ? (attributes[2] as unknown[]).find(pair => Array.isArray(pair) && pair[0] === key) as string[] | undefined : undefined;
      const value = own && resolved.get(own[1]!);
      if (value?.headingImageSource) {
        if (!validDocumentHeadingImage(value) || item.c[0] !== value.headingLevel || !Array.isArray(item.c[2])) return fail();
        let count = 0;
        const imageOnly = (inlines: unknown[]): boolean => inlines.every(raw => {
          const inline = raw as {t?:string;c?:unknown[]};
          if (inline.t === 'Space' || inline.t === 'SoftBreak') return true;
          if (inline.t === 'Span' && Array.isArray(inline.c?.[1])) return imageOnly(inline.c[1]);
          if (inline.t !== 'Image' || !Array.isArray(inline.c?.[0])) return false;
          const attr = inline.c[0] as unknown[], pairs = attr[2];
          if (!Array.isArray(pairs)) return false;
          const matches = pairs.filter(pair => Array.isArray(pair) && pair[0] === imageKey);
          if (matches.length !== 1 || (matches[0] as string[])[1] !== own![1]) return false;
          attr[2] = pairs.filter(pair => pair !== matches[0]); count++; return true;
        });
        if (!imageOnly(item.c[2]) || count !== 1) return fail();
      }
    }
    if (item.t === 'Image' && Array.isArray(item.c?.[0])) {
      const pairs = (item.c[0] as unknown[])[2];
      if (Array.isArray(pairs) && pairs.some(pair => Array.isArray(pair) && pair[0] === imageKey)) return fail();
    }
    Object.values(item).forEach(inspect);
  };
  inspect(ast);
  const owners = documentDocxPresentationOwners(ast, (raw, kind) => {
    if (!Array.isArray(raw) || raw.length !== 3 || !Array.isArray(raw[2])) return fail();
    const attributes = raw[2] as unknown[], own = attributes.filter(pair => Array.isArray(pair) && pair[0] === key);
    if (!own.length) return {};
    if (own.length !== 1 || !Array.isArray(own[0]) || typeof own[0][1] !== 'string') return fail();
    const id = own[0][1]; if (expected.get(id) !== kind || seen.has(id)) return fail();
    seen.add(id); raw[2] = attributes.filter(pair => pair !== own[0]);
    const value = resolved.get(id) ?? fail();
    if (value.fontSizePt !== undefined || value.fontLineHeightPt !== undefined || value.fontSizeSource !== undefined) {
      if (kind !== 'inline' || value.fontSizeSource !== 'authored' || !validDocumentFontSize(value.fontSizePt) || !validDocumentFontLineHeight(value.fontLineHeightPt)) return fail();
    }
    if (Object.keys(value).some(key => key.startsWith('heading'))) {
      if (kind !== 'heading' || !validDocumentHeadingMetadata(value)) return fail();
    }
    const { foreground, background, fontSizePt, fontLineHeightPt, headingLevel, headingBeforePt, headingImageLineHeightPt, headingImageWidthPt, headingImageHeightPt, headingImageSource } = value;
    return { ...(foreground ? {foreground} : {}), ...(background ? {background} : {}), ...(fontSizePt !== undefined ? { fontSizePt, fontLineHeightPt: fontLineHeightPt! } : {}), ...(headingLevel !== undefined ? { headingLevel, ...(headingBeforePt !== undefined ? {headingBeforePt} : {}) } : {}), ...(headingImageSource ? {headingImageLineHeightPt,headingImageWidthPt,headingImageHeightPt,headingImageSource} : {}) };
  });
  for (const [id, value] of resolved) if (Object.keys(value).length && !seen.has(id)) return fail();
  return owners;
}

export type DocumentDocxColorSource = DocumentDocxPresentationSource;
export const documentDocxSourceColors = documentDocxSourcePresentation;
export const resolvedDocumentDocxColorOwners = resolvedDocumentDocxPresentationOwners;
