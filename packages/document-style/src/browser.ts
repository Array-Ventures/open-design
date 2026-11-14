import { documentFontSizePattern, validDocumentFontSize, validDocumentFontLineHeight, normalizeDocumentFontPoints, validDocumentHeadingLevel } from './presentation.js';
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

const inline = new Set(['span','strong','b','em','i','u','s','del','code','a','sub','sup','small','mark','abbr','cite','q']);
const tags = new Set(['html','body','main','div','p','h1','h2','h3','h4','h5','h6','blockquote','ul','ol','li','table','thead','tbody','tfoot','tr','td','th','span','strong','b','em','i','u','s','del','code','pre','a','img','br','colgroup','col','sub','sup','small','mark','abbr','cite','q','label','input','dl','dt','dd','caption','figure','figcaption','section','hr']);
const presentation = new Set(['color','background-color','background','font-size','font-family','font-weight','font-style','text-decoration','text-align','vertical-align','white-space','width','height','aspect-ratio','padding-inline-start']);
const htmlNamespace = 'http://www.w3.org/1999/xhtml';
const mathNamespace = 'http://www.w3.org/1998/Math/MathML';
const passiveMathTags = new Set(['math','semantics','mrow','msup','mi','mn','mo','msub','annotation','mfrac','munderover','msqrt','mroot','msubsup','mtext','mspace','mover','munder','mphantom','mtable','mtr','mtd','mstyle','menclose']);
/** Passive Pandoc math stays native; no links, foreign markup or paint owners. */
function passiveDocumentMath(element: Element): boolean {
  const tag = element.localName;
  if (!passiveMathTags.has(tag)) return false;
  if (tag === 'math') {
    if (element.parentElement?.namespaceURI !== htmlNamespace) return false;
    // Math is not a text-color owner in Word. Never silently lose an authored
    // surrounding fill/ink, including cell backgrounds and background shorthand.
    for (let ancestor: HTMLElement | null = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
      const style = (ancestor as HTMLElement).style;
      if (style?.getPropertyValue('color') || style?.getPropertyValue('background') || style?.getPropertyValue('background-color')) return false;
    }
  } else if (element.parentElement?.namespaceURI !== mathNamespace) return false;
  if (tag === 'annotation' && element.children.length) return false;
  const minimum = element.getAttribute('minsize'), maximum = element.getAttribute('maxsize');
  if ((minimum !== null || maximum !== null) && (tag !== 'mo' || minimum !== maximum || !/^[1-9]\d{0,2}%$/.test(minimum ?? '') || element.getAttribute('stretchy') !== 'true')) return false;
  for (const attribute of Array.from(element.attributes)) {
    const { name, value } = attribute;
    if (name === 'xmlns' && tag === 'math' && value === mathNamespace) continue;
    if (attribute.namespaceURI) return false;
    if (name === 'display' && tag === 'math' && /^(inline|block)$/.test(value)) continue;
    if (name === 'mathvariant' && ['mi','mn','mo','mtext'].includes(tag) && ['normal','bold','bold-italic','italic','double-struck','script','fraktur','sans-serif','monospace','bold-sans-serif','sans-serif-bold-italic','bold-script','bold-fraktur','sans-serif-italic'].includes(value)) continue;
    if (tag === 'mo' && ((name === 'accent' && /^(true|false)$/.test(value)) || (name === 'stretchy' && /^(true|false)$/.test(value)) || (name === 'form' && /^(prefix|postfix|infix)$/.test(value)))) continue;
    if (tag === 'mo' && ['minsize','maxsize'].includes(name)) continue;
    if (tag === 'mstyle' && name === 'displaystyle' && /^(true|false)$/.test(value)) continue;
    if (tag === 'menclose' && name === 'notation' && ['box','updiagonalstrike','downdiagonalstrike','updiagonalstrike downdiagonalstrike'].includes(value)) continue;
    if (tag === 'annotation' && name === 'encoding' && value === 'application/x-tex') continue;
    if (tag === 'mfrac' && name === 'linethickness' && value === '0') continue;
    if (tag === 'mspace' && name === 'width' && /^-?(?:0|[1-9]\d?)(?:\.\d{1,3})?em$/.test(value)) continue;
    if (tag === 'mtd' && ((name === 'columnalign' && /^(left|center|right)$/.test(value)) || (name === 'style' && /^(?:text-align:\s*center;?|text-align:\s*left(?:;\s*padding-left:\s*0)?;?|text-align:\s*right(?:;\s*padding-right:\s*0)?;?)$/.test(value)))) continue;
    return false;
  }
  return true;
}


/** Unknown selectors/layout stay authored: adding wrappers must not restyle them. */
export function documentColorLayoutQualified(document: Document, ownedStyles: readonly string[]): boolean {
  if (document.documentElement.getAttribute('data-eve-document') !== '1' || document.querySelector('link[rel~="stylesheet"]')) return false;
  if (Array.from(document.querySelectorAll('style')).some(style => !ownedStyles.includes(style.textContent ?? ''))) return false;
  for (const element of [document.documentElement, document.body, ...Array.from(document.body.querySelectorAll('*'))]) {
    if (element.namespaceURI === mathNamespace) { if (!passiveDocumentMath(element)) return false; continue; }
    if (element.namespaceURI !== htmlNamespace || element.parentElement?.namespaceURI === mathNamespace || !tags.has(element.tagName.toLowerCase())) return false;
    if (element.tagName === 'HR') {
      if (Array.from(element.attributes).some(attribute => !['id','data-od-id','style'].includes(attribute.name) && !/^data-eve-docx-color-[a-f0-9]{16}$/.test(attribute.name))) return false;
      const rule = element as HTMLElement;
      for (const declaration of (rule.getAttribute('style') ?? '').split(';').filter(value => value.trim())) {
        const colon = declaration.indexOf(':');
        const name = declaration.slice(0,colon).trim().toLowerCase(), value = declaration.slice(colon+1).trim();
        if (colon < 1 || !['width','color','background-color'].includes(name)) return false;
        if (name === 'width' && (!/^(?:[1-9][0-9]{0,3}(?:\.[0-9]+)?px|(?:[1-9][0-9]?|100)(?:\.[0-9]+)?%)$/.test(value) || (value.endsWith('%') && Number.parseFloat(value) > 100))) return false;
      }
    }
    const owner = element as HTMLElement;
    if (owner.tagName === 'INPUT' && ((owner as HTMLInputElement).type !== 'checkbox' || !owner.hasAttribute('disabled'))) return false;
    for (const declaration of (owner.getAttribute('style') ?? '').split(';').filter(value => value.trim())) {
      const colon = declaration.indexOf(':'); if (colon < 1) return false;
      const name = declaration.slice(0,colon).trim().toLowerCase(), value = declaration.slice(colon+1).trim();
      if (!presentation.has(name) && !/^border(?:-(?:top|right|bottom|left))?(?:-(?:width|style|color))?$/.test(name) && !/^border-image-(?:source|slice|width|outset|repeat)$/.test(name)) return false;
      if (name === 'font-size' && (!inline.has(owner.tagName.toLowerCase()) || !documentFontSizePattern.test(value.replace(/!important\s*$/i,'')))) return false;
      if (name === 'padding-inline-start' && !['P','H1','H2','H3','H4','H5','H6','BLOCKQUOTE'].includes(owner.tagName)) return false;
      if (/var\(/i.test(value) || !owner.style.getPropertyValue(name)) return false;
      if ((name === 'background' || name === 'background-color') && (!inline.has(owner.tagName.toLowerCase()) && !['td','th','hr'].includes(owner.tagName.toLowerCase()))) return false;
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
/** Pandoc preserves concrete HTML image dimensions, but can ignore authored
 * CSS sizing. Do not turn that older fidelity gap into a new export refusal. */
function explicitImageDimension(image: HTMLImageElement, name: 'width'|'height'): number | undefined {
  const raw = image.getAttribute(name);
  if (!raw || !/^\d+$/.test(raw)) return undefined;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}
/** A one-line, baseline-aligned image fits the actual heading strut. Tall,
 * mixed, multi-image and repositioned content keep their existing behavior. */
function headingImagePresentation(owner: HTMLElement, attributeName: string, id: string, contentWidthPx?: number, physicalImages = false): Partial<import('./presentation.js').NormalizedDocumentPresentation> {
  if (!Number.isFinite(contentWidthPx) || contentWidthPx! <= 0) return {};
  const images = owner.querySelectorAll('img');
  if (images.length !== 1 || /[^\t\n\f\r ]/.test(owner.textContent ?? '')) return {};
  const image = images[0]!;
  // A responsive candidate has a separate asset-selection owner; do not bind
  // the source SRC while the browser may actually paint SRCSET instead.
  if (image.hasAttribute('srcset') || image.hasAttribute('sizes')) return {};
  if (image.getAttribute(`${attributeName}-image`) !== id) return {};
  const width = explicitImageDimension(image,'width'), height = explicitImageDimension(image,'height');
  if (image.style.getPropertyValue('aspect-ratio')) return {};
  if (physicalImages) {
    const main = owner.parentElement;
    if (!image.complete || image.naturalWidth <= 0 || image.naturalHeight <= 0 || image.currentSrc !== image.src) return {};
    if (!main || Math.abs(main.getBoundingClientRect().width-contentWidthPx!) > 1/64
      || owner.ownerDocument.defaultView!.innerWidth !== contentWidthPx
      || [owner.ownerDocument.documentElement,owner.ownerDocument.body,main].some(container => container.hasAttribute('hidden') || container.style.cssText.trim())) return {};
  } else if (width === undefined || height === undefined) return {};
  for (const property of ['width','height']) {
    const value = image.style.getPropertyValue(property);
    // Percentage width is measured against the proved physical MAIN. Viewport
    // units, expressions and relative height need their own print-context proof.
    const syntax = physicalImages && property === 'width' ? /^(?:auto|\d+(?:\.\d+)?(?:px|pt|%))$/ : /^(?:auto|\d+(?:\.\d+)?(?:px|pt))$/;
    if (value && !syntax.test(value)) return {};
  }
  for (let ancestor = image.parentElement; ancestor; ancestor = ancestor.parentElement) {
    if (['width','height','aspect-ratio'].some(property => ancestor.style.getPropertyValue(property))) return {};
    if (ancestor === owner.ownerDocument.body) break;
  }
  if (Array.from(owner.querySelectorAll('*')).some(element => !['IMG','SPAN'].includes(element.tagName))) return {};
  const view = owner.ownerDocument.defaultView!;
  // Only DOM-proved collapsed HTML whitespace may disappear before Pandoc.
  // NBSP and positive-width spaces remain authored content, not line metadata.
  const walker = owner.ownerDocument.createTreeWalker(owner,4);
  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    const range = owner.ownerDocument.createRange(); range.selectNodeContents(text);
    if (Array.from(range.getClientRects()).some(rect => rect.width > 0 && rect.height > 0)) return {};
  }
  const block = view.getComputedStyle(owner), line = Number.parseFloat(block.lineHeight);
  const box = owner.getBoundingClientRect(), imageBox = image.getBoundingClientRect();
  if (!physicalImages && (Math.abs(imageBox.width-width!) > 1/64 || Math.abs(imageBox.height-height!) > 1/64)) return {};
  if (!/^\d+(?:\.\d+)?px$/.test(block.lineHeight) || !Number.isFinite(line) || line <= 0
    // Chromium rounds layout boxes to 1/64 CSS px; a second quantum is drift.
    || Math.abs(box.height-line) > 1/64 || imageBox.height <= 0 || imageBox.width <= 0
    || imageBox.height > line || imageBox.width > Math.min(box.width,contentWidthPx!) || Math.abs(imageBox.x-box.x) > .01) return {};
  for (const element of Array.from(owner.querySelectorAll('*'))) {
    const style = view.getComputedStyle(element);
    if ((element as HTMLElement).style.getPropertyValue('background') || (element as HTMLElement).style.getPropertyValue('background-color')) return {};
    if (['borderTopWidth','borderBottomWidth','borderLeftWidth','borderRightWidth','paddingTop','paddingBottom','paddingLeft','paddingRight'].some(key => !['','0px'].includes(style[key as keyof CSSStyleDeclaration] as string))
      || ['boxShadow','textShadow'].some(key => !['','none'].includes(style[key as keyof CSSStyleDeclaration] as string))
      || (element.tagName === 'SPAN' && (element as HTMLElement).style.getPropertyValue('text-decoration'))) return {};
    if (style.display !== 'inline' || style.verticalAlign !== 'baseline' || !['','static'].includes(style.position)
      || !['','none'].includes(style.cssFloat) || !['','none'].includes(style.transform)
      || ['marginTop','marginBottom','marginLeft','marginRight'].some(key => !['','0px'].includes(style[key as keyof CSSStyleDeclaration] as string))) return {};
    if (['fontSize','lineHeight','fontFamily','fontWeight','fontStyle'].some(key => style[key as keyof CSSStyleDeclaration] !== block[key as keyof CSSStyleDeclaration])) return {};
  }
  if (block.whiteSpace !== 'normal' && block.whiteSpace !== '') return {};
  const result = { headingImageLineHeightPt: line*.75, headingImageWidthPt: imageBox.width*.75,
    headingImageHeightPt: imageBox.height*.75, headingImageSource: 'single-baseline-image' as const };
  return Object.values(result).some(value => typeof value === 'number' && (!Number.isFinite(value) || value <= 0 || value > 3277)) ? {} : result;
}
export function normalizeDocumentPresentationOwners(document: Document, requests: readonly import('./presentation.js').DocumentPresentationRequest[], attributeName: string, ownedStyles: readonly string[], read: DocumentColorReader = documentColorReader(document), contentWidthPx?: number, physicalImages = false): Array<{ id: string; presentation: import('./presentation.js').NormalizedDocumentPresentation }> {
  const fail = (): never => { throw new Error('The document color ownership or authored presentation is not representable.'); };
  if (!/^data-eve-docx-[a-z0-9-]{1,80}$/.test(attributeName) || requests.length > 20000 || !documentColorLayoutQualified(document, ownedStyles)) return fail();
  if (requests.some(request => !/^[A-Za-z0-9_-]{1,100}$/.test(request.id) || !['cell','inline','divider','heading'].includes(request.kind))) return fail();
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
    if (request.kind === 'cell' ? !['TD','TH'].includes(owner.tagName) : request.kind === 'divider' ? owner.tagName !== 'HR' : request.kind === 'heading' ? !/^H[1-6]$/.test(owner.tagName) : owner.tagName !== 'SPAN') return fail();
    const presentation: import('./presentation.js').NormalizedDocumentPresentation = {};
    if (request.kind === 'heading') {
      const main = owner.parentElement, level = Number(owner.tagName.slice(1));
      const canonicalFrame = document.body.children.length === 1 && main?.tagName === 'MAIN'
        && main.parentElement === document.body && document.querySelectorAll('main').length === 1;
      if (canonicalFrame && main.firstElementChild === owner && document.defaultView!.getComputedStyle(owner).marginTop === '0px') {
        if (!validDocumentHeadingLevel(level)) return fail();
        presentation.headingLevel = level; presentation.headingBeforePt = 0; presentation.headingSource = 'canonical-first-block';
      }
      if (canonicalFrame) {
        const image = headingImagePresentation(owner, attributeName, request.id, contentWidthPx, physicalImages);
        if (image.headingImageSource) { presentation.headingLevel = level as 1|2|3|4|5|6; Object.assign(presentation,image); }
      }
      return { id: request.id, presentation };
    }
    if (request.kind === 'inline') {
      let authoredSize = false;
      for (let ancestor: HTMLElement | null = owner; ancestor; ancestor = ancestor.parentElement) {
        if (ancestor.style.getPropertyValue('font-size')) { authoredSize = true; break; }
      }
      if (authoredSize) {
        const view = document.defaultView!, computed = view.getComputedStyle(owner);
        const px = (value: string): number => /^\d+(?:\.\d+)?px$/.test(value) ? Number.parseFloat(value) : NaN;
        let block: HTMLElement | null = owner.parentElement;
        while (block && !['P','H1','H2','H3','H4','H5','H6','LI','PRE','TD','TH','BLOCKQUOTE','MAIN','BODY'].includes(block.tagName)) block = block.parentElement;
        if (!block) return fail();
        const size = normalizeDocumentFontPoints(px(computed.fontSize) * .75);
        const line = Math.max(px(computed.lineHeight), px(view.getComputedStyle(block).lineHeight)) * .75;
        if (!validDocumentFontSize(size) || !validDocumentFontLineHeight(line)) return fail();
        presentation.fontSizePt = size; presentation.fontLineHeightPt = line; presentation.fontSizeSource = 'authored';
      }
    }
    if (request.kind === 'divider') {
      const background = documentEffectiveBackground(owner, read, canvas); if (!background) return fail();
      for (const [property, key] of [['color','foreground'], ['background-color','background']] as const) {
        if (property === 'background-color' && !owner.style.getPropertyValue(property)) continue;
        const value = read(document.defaultView!.getComputedStyle(owner).getPropertyValue(property));
        if (!value) return fail();
        presentation[key] = opaqueDocumentColorHex(key === 'background' ? background : compositeDocumentColor(value, background));
        if (key === 'foreground') presentation.foregroundSource = authoredForeground(owner) ? 'authored' : 'inherited';
      }
      return { id: request.id, presentation };
    }
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
        return { id: request.id, presentation };
      }
    }
    const background = documentEffectiveBackground(owner, read, canvas); if (!background) return fail();
    if (request.kind === 'cell') {
      // Never put automatic inherited foreground on a parent cell.
      if (owner.style.getPropertyValue('background-color')) presentation.background = opaqueDocumentColorHex(background);
    } else {
      if (inlineBackground(owner)) presentation.background = opaqueDocumentColorHex(background);
      if (authoredForeground(owner)) {
        const ink = read(document.defaultView!.getComputedStyle(owner).color); if (!ink) return fail();
        presentation.foreground = opaqueDocumentColorHex(compositeDocumentColor(ink, background)); presentation.foregroundSource = 'authored';
      } else {
        const correction = documentTextInk(owner, read, canvas);
        if (correction) { const ink = read(correction); if (!ink) return fail(); presentation.foreground = opaqueDocumentColorHex(ink); presentation.foregroundSource = 'inherited'; }
      }
    }
    return { id: request.id, presentation };
  });
}
/** Source compatibility alias; there is only one normalized presentation payload. */
export const normalizeDocumentColorOwners = normalizeDocumentPresentationOwners;
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
