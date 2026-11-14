import { DOMParser, XMLSerializer, type Element } from '@xmldom/xmldom';
import { documentExportProfile } from './document-export-profile.js';

const w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const fail = (): never => { throw new Error('The document converter could not preserve its print page geometry.'); };
/** Only the single final native document section is ours. Never reinterpret
 * authored section layouts, tables, headers or unrelated properties. */
export function projectDocumentDocxPage(xml: string): string {
  const document = new DOMParser({ onError: fail }).parseFromString(xml, 'application/xml');
  const bodies = Array.from(document.getElementsByTagNameNS(w, 'body'));
  if (!document.documentElement || document.documentElement.namespaceURI !== w || document.documentElement.localName !== 'document' || bodies.length !== 1 || bodies[0]!.parentNode !== document.documentElement) return fail();
  const sections = Array.from(document.getElementsByTagNameNS(w, 'sectPr'));
  if (sections.length !== 1 || sections[0]!.parentNode !== bodies[0]) return fail();
  const section = sections[0]!;
  if (Array.from(bodies[0]!.childNodes).filter(node => node.nodeType === 1).at(-1) !== section) return fail();
  const set = (name: string, attributes: Record<string, number>, later: readonly string[]) => {
    const matches = Array.from(section.childNodes).filter(node => node.nodeType === 1 && (node as Element).namespaceURI === w && (node as Element).localName === name) as Element[];
    if (matches.length > 1) return fail();
    const element = matches[0] ?? document.createElementNS(w, `w:${name}`);
    for (const [key, value] of Object.entries(attributes)) element.setAttributeNS(w, `w:${key}`, String(value));
    if (!element.parentNode) {
      const successor = Array.from(section.childNodes).find(node => node.nodeType === 1 && (node as Element).namespaceURI === w && later.includes((node as Element).localName ?? ''));
      section.insertBefore(element, successor ?? null);
    }
    return element;
  };
  const { widthPt, heightPt, marginPt } = documentExportProfile.page;
  const afterMargins = ['paperSrc','pgBorders','lnNumType','pgNumType','cols','formProt','vAlign','noEndnote','titlePg','textDirection','bidi','rtlGutter','docGrid','printerSettings','sectPrChange'];
  const size = set('pgSz', { w: widthPt * 20, h: heightPt * 20 }, ['pgMar', ...afterMargins]);
  size.removeAttributeNS(w, 'orient');
  // Header/footer distances remain converter-owned: this does not invent a
  // Word header/footer to imitate browser-only page furniture.
  set('pgMar', { top: marginPt * 20, right: marginPt * 20, bottom: marginPt * 20, left: marginPt * 20, gutter: 0 }, afterMargins);
  return new XMLSerializer().serializeToString(document);
}
