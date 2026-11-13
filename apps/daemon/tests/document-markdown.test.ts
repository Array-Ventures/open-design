import { expect, it } from 'vitest';
import { load } from 'cheerio';
import { documentMarkdownHtml, documentMarkdownInput, restoreDocumentMarkdownSpans } from '../src/embedded-render/document-markdown.js';
const document = (body: string) => `<!doctype html><html data-eve-document="1"><body>${body}</body></html>`;
it('exports ordinary editor text without regenerated default wrappers', () => {
  const $ = load(documentMarkdownHtml(document('<h1><span style="white-space: pre-wrap;">Report</span></h1><p><span style="white-space: pre-wrap;">Alpha <strong>bold</strong></span></p>')));
  expect($('span')).toHaveLength(0); expect($('h1').text()).toBe('Report'); expect($('strong').text()).toBe('bold');
});
it('recognizes a uniform first TH row as the real Markdown table header', () => {
  const $ = load(documentMarkdownHtml(document('<table><tbody><tr><th>Item</th><th>Owner</th></tr><tr><td>Alpha</td><td>A</td></tr></tbody></table>')));
  expect($('thead tr').text()).toBe('ItemOwner'); expect($('tbody tr')).toHaveLength(1); expect($('tbody tr').text()).toBe('AlphaA');
});
it('retains authored styles, attributes and whitespace that needs pre-wrap', () => {
  const body = '<p><span style="white-space: pre-wrap; color:red">Color</span><span title="Keep" style="white-space: pre-wrap;">Title</span><span style="white-space: pre-wrap;">two  spaces</span><span style="white-space: pre-wrap;">line\nbreak</span></p>';
  const $ = load(documentMarkdownHtml(document(body))); expect($('span')).toHaveLength(4); expect($('span').eq(2).text()).toBe('two  spaces');
});
it('does not infer headers for merged, mixed, nested or already explicit table structures', () => {
  const tables = ['<tr><th colspan="2">Merged</th></tr><tr><td>A</td><td>B</td></tr>', '<tr><th>Mixed</th><td>Data</td></tr>', '<tr><th>A</th></tr><tr><td><table><tr><td>Nested</td></tr></table></td></tr>'];
  for (const table of tables) expect(load(documentMarkdownHtml(document(`<table>${table}</table>`)))('thead')).toHaveLength(0);
  const $ = load(documentMarkdownHtml(document('<table><thead><tr><th>A</th></tr></thead><tbody><tr><td>B</td></tr></tbody></table>'))); expect($('thead')).toHaveLength(1);
});
it('leaves unmarked HTML unchanged', () => { const html = '<p><span style="white-space: pre-wrap;">App</span></p>'; expect(documentMarkdownHtml(html)).toBe(html); });
it('restores styled and whitespace-sensitive spans through native Pandoc AST owners', () => {
  const input = documentMarkdownInput(document('<p><span style="white-space: pre-wrap;">two  spaces\nnext</span><span style="color:red"><span title="nested">Color</span></span></p>'));
  expect(input.rawSpans.size).toBe(2);
  const ast = { blocks: [{ t: 'Para', c: [...input.rawSpans.keys()].map(id => ({ t: 'Span', c: [[id, [], []], [{ t: 'Str', c: 'collapsed' }]] })) }] };
  restoreDocumentMarkdownSpans(ast, input.rawSpans);
  expect(ast.blocks[0]!.c.map(node => node.t)).toEqual(['RawInline', 'RawInline']);
  expect(JSON.stringify(ast)).toContain('two  spaces\\nnext'); expect(JSON.stringify(ast)).toContain('nested');
});
it('refuses missing or duplicated styled owners rather than silently losing content', () => {
  const raw = new Map([['owned', '<span style="color:red">Red</span>']]);
  expect(() => restoreDocumentMarkdownSpans({ blocks: [] }, raw)).toThrow('preserve');
  expect(() => restoreDocumentMarkdownSpans([{ t: 'Span', c: [['owned'], []] }, { t: 'Span', c: [['owned'], []] }], raw)).toThrow('duplicated');
});
