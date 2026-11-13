import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';
import { withPptxSpeakerNotes } from '../src/embedded-render/pptx-notes.js';

const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const relationships = (body: string) => `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${body}</Relationships>`;
async function fixture() {
  const zip = new JSZip();
  zip.file('ppt/presentation.xml', `<p:presentation xmlns:p="${P}" xmlns:r="${R}"><p:sldIdLst><p:sldId id="1" r:id="second"/><p:sldId id="2" r:id="first"/></p:sldIdLst></p:presentation>`);
  zip.file('ppt/_rels/presentation.xml.rels', relationships(`<Relationship Id="first" Type="${R}/slide" Target="slides/slide1.xml"/><Relationship Id="second" Type="${R}/slide" Target="slides/slide2.xml"/>`));
  for (const index of [1, 2]) {
    zip.file(`ppt/slides/slide${index}.xml`, `<slide>Editable slide ${index}</slide>`);
    zip.file(`ppt/slides/_rels/slide${index}.xml.rels`, relationships(`<Relationship Id="notes" Type="${R}/notesSlide" Target="../notesSlides/note${index + 5}.xml"/>`));
    zip.file(`ppt/notesSlides/note${index + 5}.xml`, `<p:notes xmlns:p="${P}" xmlns:a="${A}"><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Old note</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:nvSpPr><p:nvPr><p:ph type="sldNum"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>${index}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:notes>`);
  }
  zip.file('ppt/media/image.png', Buffer.from([1, 2, 3]));
  return zip;
}
const bytes = (zip: JSZip) => zip.generateAsync({ type: 'nodebuffer' });

describe('PowerPoint authored speaker notes', () => {
  it('uses slide order and relationships, preserves Unicode/lines and all unrelated parts', async () => {
    const original = await fixture(), note = '  Opening < & > "\n\n日本語 😀\tend';
    const output = await JSZip.loadAsync(await withPptxSpeakerNotes(await bytes(original), [note, 'Second note']));
    for (const [name, file] of Object.entries(original.files)) if (!file.dir && !name.includes('/notesSlides/')) {
      expect(await output.file(name)!.async('nodebuffer')).toEqual(await file.async('nodebuffer'));
    }
    const xml = await output.file('ppt/notesSlides/note7.xml')!.async('string');
    const document = new DOMParser().parseFromString(xml, 'application/xml');
    const text = Array.from(document.getElementsByTagNameNS(A, 't')).map(node => node.textContent);
    expect(text).toEqual(['  Opening < & > "', '', '日本語 😀\tend', '2']);
    expect(await output.file('ppt/notesSlides/note6.xml')!.async('string')).toContain('Second note');
  });
  it('keeps bytes unchanged when there are no authored notes', async () => {
    const input = await bytes(await fixture());
    expect(await withPptxSpeakerNotes(input, ['', ' '])).toBe(input);
  });
  it('does not replace an unauthored slide note', async () => {
    const original = await fixture();
    const output = await JSZip.loadAsync(await withPptxSpeakerNotes(await bytes(original), ['Opening', '']));
    expect(await output.file('ppt/notesSlides/note6.xml')!.async('string')).toBe(await original.file('ppt/notesSlides/note6.xml')!.async('string'));
  });
  it('reports missing parts, placeholders and external relationships instead of losing notes', async () => {
    const missing = await fixture(); missing.remove('ppt/notesSlides/note7.xml');
    await expect(withPptxSpeakerNotes(await bytes(missing), ['Note'])).rejects.toThrow('missing a speaker-notes part');
    const noBody = await fixture(); noBody.file('ppt/notesSlides/note7.xml', `<p:notes xmlns:p="${P}"/>`);
    await expect(withPptxSpeakerNotes(await bytes(noBody), ['Note'])).rejects.toThrow('missing a speaker-notes placeholder');
    const external = await fixture(); external.file('ppt/slides/_rels/slide2.xml.rels', relationships(`<Relationship Id="notes" Type="${R}/notesSlide" Target="https://fixture.test/notes.xml" TargetMode="External"/>`));
    await expect(withPptxSpeakerNotes(await bytes(external), ['Note'])).rejects.toThrow('missing a speaker-notes relationship');
  });
  it('reports unsupported controls and notes beyond the exported slide count', async () => {
    const input = await bytes(await fixture());
    await expect(withPptxSpeakerNotes(input, ['bad\u0000note'])).rejects.toThrow('unsupported control');
    await expect(withPptxSpeakerNotes(input, ['A', 'B', 'C'])).rejects.toThrow('slide count');
  });
});
