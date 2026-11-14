import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import JSZip from 'jszip';
import { load } from 'cheerio';
import { documentReference, documentPrintCss, documentPrintOptions } from '../src/embedded-render/documents.js';
import { projectDocumentDocxPage } from '../src/embedded-render/document-docx-page.js';
import { documentExportProfile, wordFontSize } from '../src/embedded-render/document-export-profile.js';

it('uses the browser print defaults for native body and heading reference styles', async () => {
  const zip = new JSZip();
  zip.file('word/styles.xml', '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:lang w:val="en-US"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:styleId="Normal"><w:rPr><w:lang w:val="en-US"/></w:rPr></w:style><w:style w:styleId="Heading3"><w:pPr><w:keepNext/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:i/><w:color w:val="0000FF"/><w:lang w:val="fr-FR"/></w:rPr></w:style></w:styles>');
  const result = await JSZip.loadAsync(await documentReference(await zip.generateAsync({ type: 'nodebuffer' }), { text: 'sans', headings: 'serif' }));
  const $ = load(await result.file('word/styles.xml')!.async('string'), { xml: true });
  const normal = $('w\\:style[w\\:styleId="Normal"]');
  expect(normal.find('w\\:sz').attr('w:val')).toBe('30');
  expect(normal.find('w\\:rFonts').attr('w:ascii')).toBe('DejaVu Sans');
  expect(normal.find('w\\:spacing').attr('w:line')).toBe('450');
  expect(normal.find('w\\:spacing').attr('w:lineRule')).toBe('atLeast');
  expect(normal.find('w\\:spacing').attr('w:after')).toBe('300');
  expect(normal.find('w\\:rPr').children().toArray().map(node => node.tagName)).toEqual(['w:rFonts','w:sz','w:szCs','w:lang']);
  const heading = $('w\\:style[w\\:styleId="Heading3"]');
  expect(heading.find('w\\:sz').attr('w:val')).toBe('18.75pt');
  expect(heading.find('w\\:rFonts').attr('w:ascii')).toBe('DejaVu Serif');
  expect(heading.find('w\\:i,w\\:color')).toHaveLength(0);
  expect(heading.find('w\\:lang').attr('w:val')).toBe('fr-FR');
  expect(heading.find('w\\:pPr').children().toArray().map(node => node.tagName)).toEqual(['w:keepNext','w:spacing','w:outlineLvl']);
  expect(heading.find('w\\:keepNext')).toHaveLength(1);
  expect(documentPrintCss).toContain('font-size:20px!important;line-height:1.5!important');
  expect(documentPrintOptions('Title')!.margin).toEqual({ top:'0.75in',right:'0.75in',bottom:'0.75in',left:'0.75in' });
  expect(wordFontSize(documentExportProfile.headings[2].sizePx)).toBe('18.75pt');
});

const prefix = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Unchanged</w:t></w:r></w:p>';
it('writes explicit Letter/54pt page geometry in sequence order while retaining other section properties', () => {
  const xml = prefix + '<w:sectPr><w:footnotePr/><w:cols w:space="720"/><w:docGrid w:linePitch="360"/></w:sectPr></w:body></w:document>';
  const $ = load(projectDocumentDocxPage(xml), { xml: true });
  expect($('w\\:sectPr').children().toArray().map(node => node.tagName)).toEqual(['w:footnotePr','w:pgSz','w:pgMar','w:cols','w:docGrid']);
  expect($('w\\:pgSz').attr('w:w')).toBe('12240');
  expect($('w\\:pgSz').attr('w:h')).toBe('15840');
  expect($('w\\:pgMar').attr('w:left')).toBe('1080');
  expect($('w\\:pgMar').attr('w:right')).toBe('1080');
  expect($('w\\:cols').attr('w:space')).toBe('720');
  expect($('w\\:docGrid').attr('w:linePitch')).toBe('360');
  expect($('w\\:t').text()).toBe('Unchanged');
});
it('refuses duplicate and non-final section ownership rather than rewriting arbitrary layouts', () => {
  const suffix = '</w:body></w:document>';
  for (const middle of ['', '<w:sectPr/><w:sectPr/>', '<w:sectPr/><w:p/>', '<w:p><w:pPr><w:sectPr/></w:pPr></w:p>', '<w:sectPr><w:pgMar/><w:pgMar/></w:sectPr>']) {
    expect(() => projectDocumentDocxPage(prefix + middle + suffix)).toThrow();
  }
});

it('keeps the established browser print CSS byte-for-byte instead of changing authority to match Word', async () => {
  const original = await readFile(new URL('./fixtures/documents/canonical-print-profile.css',import.meta.url),'utf8');
  expect(documentPrintCss).toBe(original);
  expect(documentExportProfile.headings[1].linePx).toBe(39);
  expect(documentExportProfile.headings[2].linePx).toBe(35);
  const captured = JSON.parse(await readFile(new URL('./fixtures/documents/canonical-print-computed.json',import.meta.url),'utf8')) as Record<string,{fontSize:string;lineHeight:string;marginTop:string;marginBottom:string}>;
  for (const level of [4,5,6]) {
    const actual = captured[`h${level}`]!;
    expect(documentExportProfile.headings[level-1]).toEqual({sizePx:Number.parseFloat(actual.fontSize),linePx:Number.parseFloat(actual.lineHeight),beforePx:Number.parseFloat(actual.marginTop),afterPx:Number.parseFloat(actual.marginBottom)});
  }
});
