import path from 'node:path';
import JSZip from 'jszip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import type { DeckTransition } from '@open-design/contracts/runtime/deck-stage-fallback';
const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const P14 = 'http://schemas.microsoft.com/office/powerpoint/2010/main';
/** Conversion-copy metadata only; browser Magic Move object matching is not
 * established in this converter. Refuse rather than silently replacing it. */
export async function withPptxDeckTransition(bytes: Buffer, mode: DeckTransition, expectedSlides: number): Promise<Buffer> {
  if (!['none', 'fade', 'push', 'magic-move'].includes(mode)) throw Error('Unsupported deck transition.');
  if (mode === 'magic-move') throw Error('Magic Move object matching is not yet supported in PowerPoint export.');
  if (mode === 'none') return bytes;
  if (!Number.isSafeInteger(expectedSlides) || expectedSlides < 1 || expectedSlides > 200) throw Error('Invalid transition slide count.');
  const zip = await JSZip.loadAsync(bytes);
  const read = async (name: string) => {
    const file = zip.file(name); if (!file) throw Error('PowerPoint transition part is missing.');
    return new DOMParser({ onError: () => { throw Error('Invalid PowerPoint transition XML.'); } }).parseFromString(await file.async('string'), 'application/xml');
  };
  const presentation = await read('ppt/presentation.xml');
  const ids = Array.from(presentation.getElementsByTagNameNS(P, 'sldId'));
  if (ids.length !== expectedSlides) throw Error('Transition source and exported slide counts differ.');
  const relationships = await read('ppt/_rels/presentation.xml.rels'), seen = new Set<string>();
  for (const id of ids) {
    const matches = Array.from(relationships.getElementsByTagNameNS(REL, 'Relationship')).filter(node => node.getAttribute('Id') === id.getAttributeNS(R, 'id'));
    const relation = matches[0];
    if (matches.length !== 1 || !relation || relation.getAttribute('Type') !== R + '/slide' || relation.getAttribute('TargetMode') === 'External') throw Error('Invalid PowerPoint slide relationship.');
    const target = relation.getAttribute('Target') ?? '', name = path.posix.normalize(path.posix.join('ppt', target));
    if (!target || target.includes('\\') || !name.startsWith('ppt/slides/') || !name.endsWith('.xml') || seen.has(name)) throw Error('Invalid PowerPoint transition target.');
    seen.add(name);
    const document = await read(name), root = document.documentElement;
    if (!root || root.namespaceURI !== P || root.localName !== 'sld' || document.getElementsByTagNameNS(P, 'transition').length) throw Error('Ambiguous PowerPoint transition metadata.');
    if (Array.from(root.childNodes).some(node => node.namespaceURI === MC && node.localName === 'AlternateContent')) throw Error('Ambiguous PowerPoint transition metadata.');
    const transition = document.createElementNS(P, 'p:transition');
    transition.setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns:p14', P14);
    transition.setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns:mc', MC);
    transition.setAttributeNS(MC, 'mc:Ignorable', 'p14');
    // Same 350ms duration as the canonical browser deck transition contract.
    transition.setAttributeNS(P14, 'p14:dur', '350'); transition.setAttribute('spd', 'fast');
    const effect = document.createElementNS(P, 'p:' + mode);
    if (mode === 'push') effect.setAttribute('dir', 'l');
    transition.appendChild(effect);
    const before = Array.from(root.childNodes).find(node => node.namespaceURI === P && ['timing', 'extLst'].includes(node.localName ?? ''));
    root.insertBefore(transition, before ?? null);
    zip.file(name, new XMLSerializer().serializeToString(document));
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
