import { expect, it } from 'vitest';
import JSZip from 'jszip';
import { load } from 'cheerio';
import { documentHtml } from '@open-design/contracts/runtime/document';
import { documentReference, markdownSource, prepareDocument, documentPrintOptions } from '../src/embedded-render/documents.js';
it('preserves invalid metadata as ordinary content and accepts only validated font metadata', () => {
  expect(markdownSource('<!-- eve-document:!!! -->\n\n# Report').body).toContain('eve-document:!!!');
  const metadata = Buffer.from(JSON.stringify({ version: 1, fonts: { text: 'serif', headings: 'sans' }, ids: {} })).toString('base64');
  expect(markdownSource(`<!-- eve-document:${metadata} -->\n\n# Report`)).toEqual({ body: '# Report', fonts: { text: 'serif', headings: 'sans' } });
});
it('keeps ordinary applications on their render path and refuses active content in marked documents', async () => {
  expect(await prepareDocument('<script>app()</script>', 'index.html', 'App')).toBeNull();
  await expect(prepareDocument(documentHtml('Report', '<iframe src="file:///job/input.json"></iframe>'), 'report.html', 'Report')).rejects.toThrow('interactive');
  await expect(prepareDocument(documentHtml('Report', '<p onclick="app()">Text</p>'), 'report.html', 'Report')).rejects.toThrow('interactive');
});
it('writes independent editor fonts and type sizes into real Word reference styles', async () => {
  const zip = new JSZip();
  zip.file('word/styles.xml', '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Old"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:styleId="Normal"><w:rPr><w:rFonts w:ascii="Old"/></w:rPr></w:style><w:style w:styleId="Heading1"><w:rPr><w:sz w:val="10"/></w:rPr></w:style></w:styles>');
  const result = await JSZip.loadAsync(await documentReference(await zip.generateAsync({ type: 'nodebuffer' }), { text: 'sans', headings: 'serif' }));
  const $ = load(await result.file('word/styles.xml')!.async('string'), { xml: true });
  expect($('w\\:style[w\\:styleId="Normal"] w\\:rFonts').attr('w:ascii')).toBe('Arial');
  expect($('w\\:style[w\\:styleId="Heading1"] w\\:rFonts').attr('w:ascii')).toBe('Georgia');
  expect($('w\\:style[w\\:styleId="Heading1"] w\\:sz').attr('w:val')).toBe('32');
});

it('keeps a document title inert in the printable page header', () => {
  const options = documentPrintOptions('<script>not markup</script>')!;
  const $ = load(options.headerTemplate!);
  expect($('script')).toHaveLength(0);
  expect($('div').text()).toBe('<script>not markup</script>');
});
