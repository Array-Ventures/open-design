import { expect, it } from 'vitest';
import { load } from 'cheerio';
import { documentHtml } from '@open-design/contracts/runtime/document';
import { documentDocxSourcePresentation } from '../src/embedded-render/document-docx-source-colors.js';
import { documentMarkdownInput } from '../src/embedded-render/document-markdown.js';
import { prepareDocument } from '../src/embedded-render/documents.js';
import { documentDatePrintCss } from '../src/embedded-render/document-date-export.js';

const first = '<time data-eve-document-date="1" datetime="2026-11-16" data-eve-date-locale="en">Nov 16, 2026</time>';
const second = '<time data-eve-document-date="1" datetime="2026-11-17" data-eve-date-locale="en">Nov 17, 2026</time>';
const gap = '\u2005';

it('projects adjacent Date chips to separated Word labels without altering canonical TIME source', () => {
  const html = documentHtml('Dates', `<p>Date QA baseline.${first}${second}</p>`), before = html;
  const $ = load(documentDocxSourcePresentation(html).html);
  expect($('body').text()).toBe(`Date QA baseline.${gap}Nov 16, 2026${gap}${gap}Nov 17, 2026${gap}`);
  expect($('time')).toHaveLength(0); expect(html).toBe(before); expect(html).toContain(`${first}${second}`);
});

it.each([
  [`<p>Before ${first} after.</p>`, `Before ${gap}Nov 16, 2026${gap} after.`],
  [`<p>(${first}),${second}.</p>`, `(${gap}Nov 16, 2026${gap}),${gap}Nov 17, 2026${gap}.`],
  [`<p><strong>Before</strong><a href="https://example.invalid">${first}</a><em>after</em></p>`, `Before${gap}Nov 16, 2026${gap}after`],
  [`<p><span style="white-space: pre-wrap;">a  b\tc</span>${first}</p>`, `a  b\tc${gap}Nov 16, 2026${gap}`],
])('changes only derived Date boundaries in Word, retaining neighboring whitespace/format/link context: %s', (body, expected) => {
  const html = documentHtml('Dates', body!); const $ = load(documentDocxSourcePresentation(html).html);
  expect($('body').text()).toBe(expected); expect(html).toContain(body!);
  if (body!.includes('<a ')) expect($('a').attr('href')).toBe('https://example.invalid');
  if (body!.includes('<strong>')) expect($('strong').text()).toBe('Before');
});

it('preserves semantic Date atoms in PDF preparation while supplying scoped four-pixel print margins', async () => {
  const html = documentHtml('Dates', `<p>Date QA baseline.${first}${second}</p>`);
  const prepared = await prepareDocument(html, 'date.html', 'Dates');
  expect(prepared).toContain(`${first}${second}`);
  expect(documentDatePrintCss).toBe('time[data-eve-document-date="1"]{margin-inline:4px}');
});

it('leaves Markdown raw semantic atoms exact and does not add presentation whitespace to source', () => {
  const html = documentHtml('Dates', `<p>Date QA baseline.${first}${second}</p>`), projected = documentMarkdownInput(html);
  expect([...projected.rawSpans.values()]).toEqual([first, second]);
  expect(html).not.toContain(gap); expect(projected.html).not.toContain(gap);
});

it('does not reinterpret legacy unmarked TIME as a chip', () => {
  const legacy = '<time datetime="2026-11-16">Legacy</time>', html = documentHtml('Legacy', `<p>before${legacy}after</p>`);
  const $ = load(documentDocxSourcePresentation(html).html);
  expect($('time').attr('datetime')).toBe('2026-11-16'); expect($('time').text()).toBe('Legacy');
  expect($('body').text()).toBe('beforeLegacyafter');
});

it('keeps pending Date proposals behind print refusal', async () => {
  const html = documentHtml('Pending', `<p><ins data-eve-suggestion="1" data-eve-suggestion-id="11111111-1111-4111-8111-111111111111" data-eve-suggestion-operation="insert">${first}</ins></p>`);
  await expect(prepareDocument(html, 'date.html', 'Pending')).rejects.toThrow(/Resolve document suggestions/);
});

it.each([first.replace('2026-11-16', '2026-02-30'), first.replace('<time ', '<time unknown="value" ')])('validates reserved Date atoms before supplying print presentation: %s', async date => {
  await expect(prepareDocument(documentHtml('Malformed', `<p>${date}</p>`), 'date.html', 'Malformed')).rejects.toThrow(/Document dates could not be preserved/);
});
