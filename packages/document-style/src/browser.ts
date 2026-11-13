import { compositeDocumentColor, documentContrast, opaqueDocumentColorHex, type DocumentColor } from './color.js';
export type { DocumentColor } from './color.js';
export { documentContrast } from './color.js';
export type DocumentColorReader = (value: string) => DocumentColor | null;
export const DOCUMENT_TEXT_INK = '--eve-document-text-ink';

/** Canvas resolves valid computed colors, including oklch/color(), into sRGB. */
export function documentColorReader(document: Document): DocumentColorReader {
  let context: CanvasRenderingContext2D | null;
  try { context = document.createElement('canvas').getContext('2d', { willReadFrequently: true }); }
  catch { return () => null; }
  const colors = new Map<string, DocumentColor | null>();
  return value => {
    if (colors.has(value)) return colors.get(value)!;
    try {
      if (!context || !document.defaultView?.CSS?.supports('color', value)) return null;
      context.clearRect(0, 0, 1, 1); context.fillStyle = value; context.fillRect(0, 0, 1, 1);
      const pixel = context.getImageData(0, 0, 1, 1).data;
      const color: DocumentColor = [pixel[0]!, pixel[1]!, pixel[2]!, pixel[3]! / 255];
      colors.set(value, color); return color;
    } catch { colors.set(value, null); return null; }
  };
}
export function documentEffectiveBackground(owner: HTMLElement, read: DocumentColorReader, canvas?: DocumentColor): DocumentColor | null {
  const view = owner.ownerDocument.defaultView;
  if (!view) return null;
  let background: DocumentColor = [0, 0, 0, 0];
  for (let current: HTMLElement | null = owner; current; current = current.parentElement) {
    const color = read(view.getComputedStyle(current).backgroundColor);
    if (!color) return null;
    background = compositeDocumentColor(background, color);
    if (background[3] >= 1) break;
  }
  if (background[3] < 1 && canvas) background = compositeDocumentColor(background, canvas);
  return background[3] === 1 ? background : null;
}
/** Adjust inherited ink only. Authored descendant foreground styles still win. */
export function documentTextInk(owner: HTMLElement, read: DocumentColorReader, canvas?: DocumentColor): string | null {
  const view = owner.ownerDocument.defaultView;
  if (!view) return null;
  const ink = read(view.getComputedStyle(owner).color);
  const background = documentEffectiveBackground(owner, read, canvas);
  // Do not guess an unknown canvas/background or replace adequate inherited ink.
  if (!ink || !background || documentContrast(compositeDocumentColor(ink, background), background) >= 4.5) return null;
  return documentContrast([0, 0, 0, 1], background) >= documentContrast([255, 255, 255, 1], background) ? 'black' : 'white';
}

const inline = new Set(['span','strong','b','em','i','u','s','code','a','sub','sup','small','mark','abbr','cite','q']);
const tags = new Set(['html','body','main','div','p','h1','h2','h3','h4','h5','h6','blockquote','ul','ol','li','table','thead','tbody','tfoot','tr','td','th','span','strong','b','em','i','u','s','code','pre','a','img','br','colgroup','col','sub','sup','small','mark','abbr','cite','q','label','input','dl','dt','dd','caption','figure','figcaption']);
const presentation = new Set(['color','background-color','background','font-size','font-family','font-weight','font-style','text-decoration','text-align','vertical-align','white-space','width','height','aspect-ratio','padding-inline-start']);
const htmlNamespace = 'http://www.w3.org/1999/xhtml';

/** Unknown selectors/layout stay authored: adding wrappers must not restyle them. */
export function documentColorLayoutQualified(document: Document, ownedStyles: readonly string[]): boolean {
  if (document.documentElement.getAttribute('data-eve-document') !== '1' || document.querySelector('link[rel~="stylesheet"]')) return false;
  if (Array.from(document.querySelectorAll('style')).some(style => !ownedStyles.includes(style.textContent ?? ''))) return false;
  for (const element of [document.documentElement, document.body, ...Array.from(document.body.querySelectorAll('*'))]) {
    if (element.namespaceURI !== htmlNamespace || !tags.has(element.tagName.toLowerCase())) return false;
    const owner = element as HTMLElement;
    if (owner.tagName === 'INPUT' && ((owner as HTMLInputElement).type !== 'checkbox' || !owner.hasAttribute('disabled'))) return false;
    for (const declaration of (owner.getAttribute('style') ?? '').split(';').filter(value => value.trim())) {
      const colon = declaration.indexOf(':'); if (colon < 1) return false;
      const name = declaration.slice(0,colon).trim().toLowerCase(), value = declaration.slice(colon+1).trim();
      if (!presentation.has(name) && !/^border(?:-(?:top|right|bottom|left))?(?:-(?:width|style|color))?$/.test(name) && !/^border-image-(?:source|slice|width|outset|repeat)$/.test(name)) return false;
      if (name === 'padding-inline-start' && !['P','H1','H2','H3','H4','H5','H6','BLOCKQUOTE'].includes(owner.tagName)) return false;
      if (/var\(/i.test(value) || !owner.style.getPropertyValue(name)) return false;
      if ((name === 'background' || name === 'background-color') && (!inline.has(owner.tagName.toLowerCase()) && !['td','th'].includes(owner.tagName.toLowerCase()))) return false;
      if (name === 'background' && !document.defaultView?.CSS?.supports('color', value.replace(/!important\s*$/i,''))) return false;
    }
  }
  return true;
}
function authoredForeground(owner: HTMLElement): boolean {
  for (let current: HTMLElement | null = owner; current; current = current.parentElement) if (current.style.getPropertyValue('color')) return true;
  return false;
}
function inlineBackground(owner: HTMLElement): boolean {
  for (let current: HTMLElement | null = owner; current && inline.has(current.tagName.toLowerCase()); current = current.parentElement) if (current.style.getPropertyValue('background-color')) return true;
  return false;
}
/** Resolve the actual print canvas after print media/color-scheme is installed. */
export function documentCanvasColor(document: Document, read: DocumentColorReader): DocumentColor | null {
  const probe = document.createElement('span'); probe.style.cssText = 'display:none;background-color:Canvas';
  document.body.appendChild(probe);
  try { return read(document.defaultView!.getComputedStyle(probe).backgroundColor); }
  finally { probe.remove(); }
}
export function normalizeDocumentColorOwners(document: Document, requests: readonly import('./color.js').DocumentColorRequest[], attributeName: string, ownedStyles: readonly string[], read: DocumentColorReader = documentColorReader(document)): Array<{ id: string; colors: import('./color.js').NormalizedDocumentColors }> {
  const fail = (): never => { throw new Error('The document color ownership or authored presentation is not representable.'); };
  if (!/^data-eve-docx-[a-z0-9-]{1,80}$/.test(attributeName) || requests.length > 20000 || !documentColorLayoutQualified(document, ownedStyles)) return fail();
  if (requests.some(request => !/^[A-Za-z0-9_-]{1,100}$/.test(request.id) || !['cell','inline'].includes(request.kind))) return fail();
  const expected = new Map(requests.map(request => [request.id, request.kind])); if (expected.size !== requests.length) return fail();
  const elements = new Map<string, HTMLElement>();
  for (const element of Array.from(document.body.querySelectorAll(`[${attributeName}]`))) {
    const id = element.getAttribute(attributeName)!;
    if (element.namespaceURI !== htmlNamespace || !expected.has(id) || elements.has(id)) return fail(); elements.set(id, element as HTMLElement);
  }
  if (elements.size !== expected.size) return fail();
  const canvas = documentCanvasColor(document, read);
  if (!canvas || canvas[3] !== 1) return fail();
  return requests.map(request => {
    const owner = elements.get(request.id)!;
    if (request.kind === 'cell' ? !['TD','TH'].includes(owner.tagName) : owner.tagName !== 'SPAN') return fail();
    const colors: import('./color.js').NormalizedDocumentColors = {};
    if (request.kind === 'inline' && !owner.textContent?.trim()) {
      const range = document.createRange(); range.selectNodeContents(owner);
      if (!Array.from(range.getClientRects()).some(rect => rect.width > 0 && rect.height > 0)) {
        // Collapsed indentation has no glyph ink. An authored inline background
        // may still paint padding/boxes, so never discard such an owner by guess.
        for (let current: HTMLElement | null = owner; current && inline.has(current.tagName.toLowerCase()); current = current.parentElement) {
          if (!current.style.getPropertyValue('background-color')) continue;
          const color = read(document.defaultView!.getComputedStyle(current).backgroundColor), box = current.getBoundingClientRect();
          if (!color || (color[3] > 0 && box.width > 0 && box.height > 0)) return fail();
        }
        return { id: request.id, colors };
      }
    }
    const background = documentEffectiveBackground(owner, read, canvas); if (!background) return fail();
    if (request.kind === 'cell') {
      // Never put automatic inherited foreground on a parent cell.
      if (owner.style.getPropertyValue('background-color')) colors.background = opaqueDocumentColorHex(background);
    } else {
      if (inlineBackground(owner)) colors.background = opaqueDocumentColorHex(background);
      if (authoredForeground(owner)) {
        const ink = read(document.defaultView!.getComputedStyle(owner).color); if (!ink) return fail();
        colors.foreground = opaqueDocumentColorHex(compositeDocumentColor(ink, background)); colors.foregroundSource = 'authored';
      } else {
        const correction = documentTextInk(owner, read, canvas);
        if (correction) { const ink = read(correction); if (!ink) return fail(); colors.foreground = opaqueDocumentColorHex(ink); colors.foregroundSource = 'inherited'; }
      }
    }
    return { id: request.id, colors };
  });
}
/** Transient print DOM only. Working HTML and authored foregrounds never change. */
export function repairDocumentPrintInk(document: Document, ownedStyles: readonly string[], read: DocumentColorReader = documentColorReader(document)): { applied: number; qualified: boolean } {
  if (!documentColorLayoutQualified(document, ownedStyles)) return { applied: 0, qualified: false };
  const canvas = documentCanvasColor(document, read);
  if (!canvas || canvas[3] !== 1) return { applied: 0, qualified: false };
  const text: Text[] = [], walker = document.createTreeWalker(document.body, 4);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) if (node.textContent?.trim()) text.push(node as Text);
  // Snapshot all text and measurements before adding any neutral inline wrapper.
  const changes: Array<{ node: Text; ink: string }> = [];
  for (const node of text) {
    const owner = node.parentElement;
    if (!owner || owner.namespaceURI !== htmlNamespace || authoredForeground(owner)) continue;
    const ink = documentTextInk(owner, read, canvas); if (ink) changes.push({ node, ink });
  }
  for (const { node, ink } of changes) { const span = document.createElement('span'); span.style.color = ink; node.replaceWith(span); span.appendChild(node); }
  return { applied: changes.length, qualified: true };
}
