import { createRequire } from 'node:module';
const { JSDOM } = createRequire(import.meta.url)('jsdom');
import { expect, it } from 'vitest';
import { documentHtml } from '@open-design/contracts/runtime/document';
import { documentColorLayoutQualified } from '@open-design/document-style/browser';
import { documentDocxSourcePresentation } from '../src/embedded-render/document-docx-source-colors.js';
import { documentMarkdownInput } from '../src/embedded-render/document-markdown.js';
const date = '<time data-eve-document-date="1" datetime="2024-02-29" data-eve-date-locale="en-US">Persisted leap day</time>';
const html = documentHtml('Dates', `<p>Before ${date} after.</p>`);
it('makes the canonical Date visible-label projection qualify for the existing strict Word normalizer', () => {
  const source = documentDocxSourcePresentation(html);
  const document = new JSDOM(source.html).window.document;
  expect(documentColorLayoutQualified(document, Array.from(document.querySelectorAll('style') as ArrayLike<{ textContent: string | null }>).map(node => node.textContent ?? ''))).toBe(true);
  expect(document.querySelector('time')).toBeNull();
  expect(document.body.textContent).toBe('Before Persisted leap day after.');
  expect(html).toContain(date);
});
it('retains exact semantic TIME through the existing Markdown RawInline owner path', () => {
  const source = documentMarkdownInput(html);
  expect([...source.rawSpans.values()]).toContain(date);
  expect(html).toContain(date);
});
it('uses one outer raw owner for a styled Date without leaking nested generated identities', () => {
  const outer = `<span style="color:red">${date}</span>`;
  const source = documentMarkdownInput(documentHtml('Styled date', `<p>${outer}</p>`));
  expect([...source.rawSpans.values()]).toEqual([outer]);
});
it.each([date.replace('2024-02-29', '2023-02-29'), date.replace('<time ', '<time onclick="run()" '), date.replace('>Persisted leap day<', '><b>Persisted leap day</b><')])('refuses malformed Date conversion instead of flattening source: %s', malformed => {
  const source = documentHtml('Malformed Date', `<p>${malformed}</p>`);
  expect(() => documentDocxSourcePresentation(source)).toThrow('Document dates could not be preserved');
  expect(() => documentMarkdownInput(source)).toThrow('Document dates could not be preserved');
});
it('leaves legacy unmarked HTML TIME on its existing converter path without a new Date interpretation', () => {
  const legacy = '<time datetime="2024-02-29">Legacy time</time>', source = documentHtml('Legacy time', `<p>${legacy}</p>`);
  expect(documentDocxSourcePresentation(source).html).toContain('<time datetime="2024-02-29">');
  const markdown = documentMarkdownInput(source); expect(markdown.html).toContain(legacy); expect(markdown.rawSpans.size).toBe(0);
});
it('preserves formatted Date ancestors independently of the narrower editable atom model', () => {
  const formatted = documentHtml('Formatted Date', `<p><strong><span style="color:red">${date}</span></strong></p>`);
  const word = documentDocxSourcePresentation(formatted).html;
  const document = new JSDOM(word).window.document;
  expect(document.querySelector('time')).toBeNull();
  expect(document.querySelector('strong span[style="color:red"]')?.textContent).toBe('Persisted leap day');
  const markdown = documentMarkdownInput(formatted);
  expect([...markdown.rawSpans.values()]).toContain(`<span style="color:red">${date}</span>`);
  expect(markdown.html).toContain('<strong>'); expect(formatted).toContain(date);
});
