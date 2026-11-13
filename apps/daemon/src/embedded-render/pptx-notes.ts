import path from 'node:path';
import JSZip from 'jszip';
import { DOMParser, XMLSerializer, type Document } from '@xmldom/xmldom';

const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const RELS = 'http://schemas.openxmlformats.org/package/2006/relationships';

function xml(text: string): Document {
  return new DOMParser({ onError: () => { throw new Error('Invalid PowerPoint notes XML.'); } }).parseFromString(text, 'application/xml');
}

/** Add authored notes to the converter's existing notes placeholders. Resolve
 * package relationships rather than assuming notes filenames or slide numbers.
 * Drawing, layout, font and relationship parts are never changed. */
export async function withPptxSpeakerNotes(bytes: Buffer, notes: readonly string[]): Promise<Buffer> {
  if (!notes.some(note => note.trim())) return bytes;
  const zip = await JSZip.loadAsync(bytes);
  async function read(name: string) {
    const file = zip.file(name);
    if (!file) throw new Error('PowerPoint export is missing a speaker-notes part.');
    return xml(await file.async('string'));
  }
  async function related(owner: string, id?: string, type = 'notesSlide') {
    const relationships = path.posix.join(path.posix.dirname(owner), '_rels', path.posix.basename(owner) + '.rels');
    const document = await read(relationships);
    const relation = Array.from(document.getElementsByTagNameNS(RELS, 'Relationship')).find(node =>
      node.getAttribute('Type') === R + '/' + type && (id === undefined || node.getAttribute('Id') === id));
    if (!relation || relation.getAttribute('TargetMode') === 'External') throw new Error('PowerPoint export is missing a speaker-notes relationship.');
    const target = relation.getAttribute('Target') ?? '';
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(owner), target));
    if (!target || !resolved.startsWith('ppt/') || target.includes('\\')) throw new Error('Invalid PowerPoint notes relationship.');
    return resolved;
  }
  const presentation = await read('ppt/presentation.xml');
  const slides = Array.from(presentation.getElementsByTagNameNS(P, 'sldId'));
  if (notes.slice(slides.length).some(note => note.trim())) throw new Error('Speaker notes do not match the exported slide count.');
  for (let index = 0; index < slides.length; index++) {
    const note = notes[index] ?? '';
    if (!note.trim()) continue;
    // XML 1.0 cannot represent these controls; report rather than silently lose text.
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(note)) throw new Error('Speaker notes contain unsupported control characters.');
    const slide = await related('ppt/presentation.xml', slides[index]!.getAttributeNS(R, 'id') ?? '', 'slide');
    const name = await related(slide), document = await read(name);
    const body = Array.from(document.getElementsByTagNameNS(P, 'sp')).find(shape =>
      Array.from(shape.getElementsByTagNameNS(P, 'ph')).some(placeholder => placeholder.getAttribute('type') === 'body'))
      ?.getElementsByTagNameNS(P, 'txBody').item(0);
    if (!body) throw new Error('PowerPoint export is missing a speaker-notes placeholder.');
    for (const paragraph of Array.from(body.childNodes)) if (paragraph.namespaceURI === A && paragraph.localName === 'p') body.removeChild(paragraph);
    for (const line of note.replace(/\r\n?/g, '\n').split('\n')) {
      const paragraph = document.createElementNS(A, 'a:p'), run = document.createElementNS(A, 'a:r'), text = document.createElementNS(A, 'a:t');
      text.setAttribute('xml:space', 'preserve'); text.appendChild(document.createTextNode(line));
      run.appendChild(text); paragraph.appendChild(run); body.appendChild(paragraph);
    }
    zip.file(name, new XMLSerializer().serializeToString(document));
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
