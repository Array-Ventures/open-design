import { expect, it } from 'vitest';
import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';
import { buildScreenshotPptx } from '../src/deck-export.js';
const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
it.each(['fade', 'push'] as const)('retains canonical %s in actual PptxGenJS slide metadata', async transition => {
  const bytes = await buildScreenshotPptx([{ buffer: pixel, jpeg: false }, { buffer: pixel, jpeg: false }], { title: 'Transition fixture', transition } as Parameters<typeof buildScreenshotPptx>[1] & { transition: string });
  const zip = await JSZip.loadAsync(bytes);
  for (const index of [1, 2]) {
    const slide = new DOMParser().parseFromString(await zip.file(`ppt/slides/slide${index}.xml`)!.async('string'), 'application/xml');
    expect(slide.getElementsByTagNameNS(P, 'transition').length).toBe(1);
    expect(slide.getElementsByTagNameNS(P, transition).length).toBe(1);
    expect(slide.getElementsByTagNameNS(P, 'pic').length).toBe(1);
  }
});

import * as PptxGenJSModule from 'pptxgenjs';
import { resolvePptxConstructor } from '../src/deck-export.js';
import { withPptxDeckTransition } from '../src/embedded-render/pptx-transitions.js';
import { deckSourcePptxTransition } from '../src/embedded-render/deck-source.js';
const xml = (text: string) => new DOMParser().parseFromString(text, 'application/xml');
async function nativeFixture() {
  const pptx = new (resolvePptxConstructor(PptxGenJSModule))();
  pptx.title = 'Retained title'; pptx.author = 'Retained author';
  pptx.theme = { headFontFace: 'Georgia', bodyFontFace: 'Arial' };
  for (const text of ['First retained', 'Second retained']) {
    const slide = pptx.addSlide();
    slide.addText(text, { x: 1, y: 1, w: 5, h: 1, fontFace: 'Georgia', fontSize: 24, bold: true, color: '123456' });
    slide.addNotes('Retained notes ' + text);
  }
  return Buffer.from(await pptx.write({ outputType: 'nodebuffer' }) as Buffer);
}
it.each(['fade', 'push'] as const)('preserves all editable objects, typography, notes, theme and unrelated ZIP payloads for %s', async mode => {
  const original = await nativeFixture(), before = await JSZip.loadAsync(original);
  const after = await JSZip.loadAsync(await withPptxDeckTransition(original, mode, 2));
  expect(Object.keys(after.files).sort()).toEqual(Object.keys(before.files).sort());
  for (const [name, file] of Object.entries(before.files)) {
    if (file.dir) continue;
    if (!/^ppt\/slides\/slide[0-9]+\.xml$/.test(name)) {
      expect(await after.file(name)!.async('nodebuffer'), name).toEqual(await file.async('nodebuffer')); continue;
    }
    const source = xml(await file.async('string')), result = xml(await after.file(name)!.async('string'));
    const transition = result.getElementsByTagNameNS(P, 'transition')[0]!;
    expect(transition.getAttributeNS('http://schemas.microsoft.com/office/powerpoint/2010/main', 'dur')).toBe('350');
    if (mode === 'push') expect(result.getElementsByTagNameNS(P, 'push')[0]!.getAttribute('dir')).toBe('l');
    transition.parentNode!.removeChild(transition); expect(result.toString()).toBe(source.toString());
    const rPr = result.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/main', 'rPr')[0]!;
    expect(rPr.getAttribute('sz')).toBe('2400'); expect(rPr.getAttribute('b')).toBe('1');
    expect(rPr.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/main', 'latin')[0]!.getAttribute('typeface')).toBe('Georgia');
  }
  expect(original).toEqual(await withPptxDeckTransition(original, 'none', 2));
});
it('refuses unsupported Magic Move instead of silently substituting a different transition', async () => {
  await expect(withPptxDeckTransition(await nativeFixture(), 'magic-move', 2)).rejects.toThrow('object matching');
});
it('refuses mismatched counts, external/duplicate relationships and pre-existing transition metadata', async () => {
  const original = await nativeFixture();
  await expect(withPptxDeckTransition(original, 'fade', 1)).rejects.toThrow('counts differ');
  await expect(withPptxDeckTransition(await withPptxDeckTransition(original, 'fade', 2), 'push', 2)).rejects.toThrow('Ambiguous');
  for (const mutation of ['external', 'duplicate', 'path', 'alternate'] as const) {
    const zip = await JSZip.loadAsync(original), part = 'ppt/_rels/presentation.xml.rels';
    const relationships = xml(await zip.file(part)!.async('string'));
    const rel = Array.from(relationships.getElementsByTagName('Relationship')).find(n => n.getAttribute('Type')?.endsWith('/slide'))!;
    if (mutation === 'external') rel.setAttribute('TargetMode', 'External');
    if (mutation === 'duplicate') relationships.documentElement!.appendChild(rel.cloneNode(true));
    if (mutation === 'path') rel.setAttribute('Target', '../../outside.xml');
    if (mutation === 'alternate') {
      const name = 'ppt/slides/slide1.xml', slide = xml(await zip.file(name)!.async('string'));
      slide.documentElement!.appendChild(slide.createElementNS('http://schemas.openxmlformats.org/markup-compatibility/2006', 'mc:AlternateContent')); zip.file(name, slide.toString());
    }
    zip.file(part, relationships.toString());
    await expect(withPptxDeckTransition(await zip.generateAsync({ type: 'nodebuffer' }), 'fade', 2), mutation).rejects.toThrow();
  }
});
it('uses canonical source-stage metadata and refuses ambiguous runtime/source projections', () => {
  const html = '<deck-stage transition="push"><section class="slide">A</section><section class="slide">B</section></deck-stage>';
  expect(deckSourcePptxTransition(html, 2)).toBe('push');
  expect(deckSourcePptxTransition('<section class="slide">Legacy</section>', 1)).toBe('none');
  expect(() => deckSourcePptxTransition(html, 1)).toThrow('counts differ');
  expect(() => deckSourcePptxTransition(html + html, 4)).toThrow('one canonical');
  expect(() => deckSourcePptxTransition(html.replace('push', 'unknown'), 2)).toThrow('Unsupported');
});
