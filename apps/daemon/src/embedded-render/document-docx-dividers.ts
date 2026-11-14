import { documentExportProfile, cssPxToTwips, cssPxToPoints } from './document-export-profile.js';
import { createDocumentRuleDrawing, documentRuleWordWidth } from './document-rule-drawing.js';
import { randomBytes } from 'node:crypto';
import { load } from 'cheerio';
import { DOMParser, XMLSerializer, type Element } from '@xmldom/xmldom';
import type { DocumentDocxColorSource } from './document-docx-source-colors.js';
import type { DocumentDocxColors } from './document-docx-colors.js';

interface DividerOwner { name: string; width?: string; colors: DocumentDocxColors; sourceBlock?: 'canonical-main' }
const fail = (): never => { throw new Error('The document converter could not preserve divider presentation.'); };
const w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const v = 'urn:schemas-microsoft-com:vml';
const o = 'urn:schemas-microsoft-com:office:office';

/** Preserve source identity in a conversion-only wrapper; Pandoc turns its ID
 * into bookmarks around the native horizontal-rule paragraph. Never match text
 * or the ordinal position of an unrelated rule. */
export function documentDocxDividers(html: string, source: DocumentDocxColorSource, normalized: ReadonlyMap<string, DocumentDocxColors>) {
  const $ = load(html), owners: DividerOwner[] = [];
  let prefix: string;
  do { prefix = `EveRule${randomBytes(8).toString('hex')}`; } while (html.includes(prefix));
  for (const request of source.requests.filter(request => request.kind === 'divider')) {
    const element = $(`hr[${source.attributeName}="${request.id}"]`);
    if (element.length !== 1) return fail();
    const colors = normalized.get(request.id); if (!colors) return fail();
    if (Object.keys(colors).some(key => !['foreground','background','foregroundSource'].includes(key))) return fail();
    for (const color of [colors.foreground, colors.background]) if (color !== undefined && !/^[A-F0-9]{6}$/.test(color)) return fail();
    const declarations = (element.attr('style') ?? '').split(';').filter(value => value.trim());
    let width: string | undefined;
    for (const declaration of declarations) {
      const [name, ...parts] = declaration.split(':');
      if (name!.trim().toLowerCase() === 'width') width = parts.join(':').trim();
    }
    const geometry = documentRuleWordWidth(width);
    const main = $('body > main');
    // exportDocument has already required the exact owned canonical/print
    // stylesheet closure in normalizeDocumentDocxPresentation. The marker
    // alone is not stylesheet authority. Decline additional container geometry
    // here; hidden/root-sized documents keep the prior VML conversion path.
    const containers = $('html, body, body > main');
    const canonicalMain = $('html').attr('data-eve-document') === '1' && main.length === 1 && $('main').length === 1
      && containers.toArray().every(node => !$(node).attr('style')?.trim() && !$(node).is('[hidden]'))
      && $('body').contents().toArray().every(node => node === main[0] || (node.type === 'text' && !/[^\t\n\f\r ]/.test(node.data)));
    const modern = canonicalMain && element.parent()[0] === main[0]
      && geometry.widthPt <= documentExportProfile.page.widthPt - 2*documentExportProfile.page.marginPt;
    const name = `${prefix}_${owners.length}`;
    owners.push({ name: `_${name}`, ...(width ? { width } : {}), colors, ...(modern ? {sourceBlock:'canonical-main' as const} : {}) });
    element.removeAttr(source.attributeName).wrap(`<div id="${name}"></div>`);
  }
  return { html: $.html(), owners };
}

/** Only the exactly paired generated bookmark's one native HR may be changed.
 * Existing paragraph properties/bookmarks and unrelated native content survive. */
export function projectDocumentDocxDividers(xml: string, owners: readonly DividerOwner[]): string {
  if (!owners.length) return xml;
  const document = new DOMParser({ onError: fail }).parseFromString(xml, 'application/xml');
  const starts = Array.from(document.getElementsByTagNameNS(w, 'bookmarkStart'));
  const ends = Array.from(document.getElementsByTagNameNS(w, 'bookmarkEnd'));
  const names = new Set<string>(), ids = new Set<string>();
  const drawing = owners.some(owner => owner.sourceBlock === 'canonical-main') ? createDocumentRuleDrawing(document) : undefined;
  for (const owner of owners) {
    if (owner.sourceBlock !== undefined && owner.sourceBlock !== 'canonical-main') return fail();
    if (names.has(owner.name)) return fail(); names.add(owner.name);
    const matches = starts.filter(node => node.getAttributeNS(w, 'name') === owner.name);
    if (matches.length !== 1) return fail();
    const start = matches[0]!, id = start.getAttributeNS(w, 'id');
    if (!id || ids.has(id) || starts.filter(node => node.getAttributeNS(w, 'id') === id).length !== 1) return fail(); ids.add(id);
    const matchingEnds = ends.filter(node => node.getAttributeNS(w, 'id') === id);
    if (matchingEnds.length !== 1) return fail();
    const end = matchingEnds[0]!; if (start.parentNode !== end.parentNode) return fail();
    const between: Element[] = [];
    let node = start.nextSibling;
    for (; node && node !== end; node = node.nextSibling) {
      if (node.nodeType === 3 && !node.textContent?.trim()) continue;
      if (node.nodeType !== 1) return fail(); between.push(node as Element);
    }
    if (node !== end || between.length !== 1 || between[0]!.namespaceURI !== w || between[0]!.localName !== 'p') return fail();
    const paragraph = between[0]!;
    for (const element of Array.from(paragraph.getElementsByTagName('*'))) {
      if (element.namespaceURI === w && ['pPr','r','pict'].includes(element.localName ?? '')) continue;
      if (element.namespaceURI === w && element.parentNode?.localName === 'pPr') continue;
      if (element.namespaceURI === v && element.localName === 'rect' && element.parentNode?.localName === 'pict') continue;
      return fail();
    }
    const rects = Array.from(paragraph.getElementsByTagNameNS(v, 'rect'));
    if (rects.length !== 1 || paragraph.getElementsByTagNameNS(w, 't').length || paragraph.getElementsByTagNameNS(w, 'bookmarkStart').length || paragraph.getElementsByTagNameNS(w, 'bookmarkEnd').length) return fail();
    const rect = rects[0]!; if (rect.getAttributeNS(o, 'hr') !== 't') return fail();
    let properties = Array.from(paragraph.childNodes).find(node => node.nodeType === 1 && (node as Element).namespaceURI === w && (node as Element).localName === 'pPr') as Element | undefined;
    if (!properties) { properties = document.createElementNS(w, 'w:pPr'); paragraph.insertBefore(properties, paragraph.firstChild); }
    const spacingMatches = Array.from(properties.childNodes).filter(node => node.nodeType === 1 && (node as Element).namespaceURI === w && (node as Element).localName === 'spacing') as Element[];
    if (spacingMatches.length > 1) return fail();
    const spacing = spacingMatches[0] ?? document.createElementNS(w, 'w:spacing');
    spacing.setAttributeNS(w, 'w:before', String(cssPxToTwips(documentExportProfile.rule.marginPx)));
    spacing.setAttributeNS(w, 'w:after', String(cssPxToTwips(documentExportProfile.rule.marginPx)));
    spacing.setAttributeNS(w, 'w:line', String(cssPxToTwips(documentExportProfile.rule.borderPx)));
    spacing.setAttributeNS(w, 'w:lineRule', 'exact');
    if (!spacing.parentNode) {
      const later = new Set(['ind','contextualSpacing','mirrorIndents','suppressOverlap','jc','textDirection','textAlignment','textboxTightWrap','outlineLvl','divId','cnfStyle','rPr','sectPr','pPrChange']);
      const successor = Array.from(properties.childNodes).find(node => node.nodeType === 1 && (node as Element).namespaceURI === w && later.has((node as Element).localName ?? ''));
      properties.insertBefore(spacing, successor ?? null);
    }
    const justification = Array.from(properties.childNodes).filter(node => node.nodeType === 1 && (node as Element).namespaceURI === w && (node as Element).localName === 'jc');
    if (justification.length > 1) return fail();
    const jc = justification[0] as Element | undefined ?? document.createElementNS(w, 'w:jc');
    jc.setAttributeNS(w, 'w:val', 'center');
    if (!jc.parentNode) {
      const later = new Set(['textDirection','textAlignment','textboxTightWrap','outlineLvl','divId','cnfStyle','rPr','sectPr','pPrChange']);
      const successor = Array.from(properties.childNodes).find(node => node.nodeType === 1 && (node as Element).namespaceURI === w && later.has((node as Element).localName ?? ''));
      properties.insertBefore(jc, successor ?? null);
    }
    rect.setAttribute('style', 'width:0;height:0pt');
    rect.setAttribute('strokeweight', `${cssPxToPoints(documentExportProfile.rule.borderPx)}pt`);
    if (owner.width?.endsWith('%')) rect.setAttributeNS(o, 'o:hrpct', String(Math.round(Number.parseFloat(owner.width) * 10)));
    else if (owner.width) {
      rect.removeAttributeNS(o, 'hrpct');
      rect.setAttribute('style', `width:${Number.parseFloat(owner.width) * .75}pt;height:0pt`);
    }
    if (owner.colors.foreground || owner.colors.background) {
      rect.removeAttributeNS(o, 'hrstd');
      if (owner.colors.background) rect.setAttribute('fillcolor', `#${owner.colors.background}`);
      if (owner.colors.foreground) rect.setAttribute('strokecolor', `#${owner.colors.foreground}`);
    }
    if (owner.sourceBlock === 'canonical-main') {
      const body = document.getElementsByTagNameNS(w,'body');
      const picture = rect.parentNode as Element, run = picture.parentNode as Element;
      if (body.length !== 1 || paragraph.parentNode !== body[0] || picture.namespaceURI !== w || picture.localName !== 'pict'
        || run.namespaceURI !== w || run.localName !== 'r' || run.parentNode !== paragraph || !drawing) return fail();
      run.replaceChild(drawing(picture,owner.width,owner.colors.foreground,owner.colors.background),picture);
    }
    start.parentNode!.removeChild(start); end.parentNode!.removeChild(end);
  }
  return new XMLSerializer().serializeToString(document);
}
