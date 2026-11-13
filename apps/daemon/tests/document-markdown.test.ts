import { expect, it } from 'vitest';
import { load } from 'cheerio';
import { documentMarkdownHtml, documentMarkdownInput, restoreDocumentMarkdownOwners } from '../src/embedded-render/document-markdown.js';
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
it('preserves boundary whitespace owners across adjacent spans and paragraph edges', () => {
  const input = documentMarkdownInput(document('<p><span style="white-space: pre-wrap;">A </span><span style="white-space: pre-wrap;"> B</span></p><p><span style="white-space: pre-wrap;"> edge </span></p>'));
  expect(input.rawSpans.size).toBe(3);
  expect([...input.rawSpans.values()].join('')).toContain('A </span><span style="white-space: pre-wrap;"> B');
  expect([...input.rawSpans.values()][2]).toContain('> edge </span>');
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
  restoreDocumentMarkdownOwners(ast, input.rawSpans);
  expect(ast.blocks[0]!.c.map(node => node.t)).toEqual(['RawInline', 'RawInline']);
  expect(JSON.stringify(ast)).toContain('two  spaces\\nnext'); expect(JSON.stringify(ast)).toContain('nested');
});
it('refuses missing or duplicated styled owners rather than silently losing content', () => {
  const raw = new Map([['owned', '<span style="color:red">Red</span>']]);
  expect(() => restoreDocumentMarkdownOwners({ blocks: [] }, raw)).toThrow('preserve');
  expect(() => restoreDocumentMarkdownOwners([{ t: 'Span', c: [['owned'], []] }, { t: 'Span', c: [['owned'], []] }], raw)).toThrow('duplicated');
});
it('normalizes pinned Lexical code exports to a real language-owned code block without changing whitespace', async () => {
  const { readFileSync } = await import('node:fs');
  const html = readFileSync(`${process.cwd()}/tests/fixtures/documents/lexical-code-export.html`, 'utf8');
  const input = documentMarkdownInput(html), $ = load(input.html);
  expect($('pre > code').attr('class')).toBe('language-javascript'); expect($('pre > code').text()).toBe('  const n = 1;\n  n++;');
  expect($('pre span,pre br')).toHaveLength(0); expect(input.rawBlocks.size).toBe(0);
  expect([...input.rawSpans.values()]).toEqual(['<code spellcheck="false" style="white-space: pre-wrap;"><span class="DocumentEditor-module__qFNIka__inlineCode"> x  y </span></code>']);
});
it.each([
  '<pre class="authored-code"><span style="white-space: pre-wrap;">  x  y</span></pre>',
  '<pre style="color:red"><span style="white-space: pre-wrap;">  x  y</span></pre>',
  '<pre data-language="javascript"><span style="color:red">  x  y</span></pre>',
  '<pre data-language="javascript" data-highlight-language="python">  x  y</pre>',
  '<pre data-eve-native-code="1"><span title="authored">  x  y</span></pre>',
])('preserves an unknown rich-code block as one complete HTML owner: %s', html => {
  const input = documentMarkdownInput(document(html)); expect(input.rawSpans.size).toBe(0); expect([...input.rawBlocks.values()]).toEqual([html]);
  const id = [...input.rawBlocks.keys()][0]!, ast = { t: 'Div', c: [[id, [], []], []] };
  restoreDocumentMarkdownOwners(ast, input.rawSpans, input.rawBlocks); expect(ast).toEqual({ t: 'RawBlock', c: ['html', html] });
});
it('restores complete inline code and refuses lost, duplicate or conflicting block owners', () => {
  const input = documentMarkdownInput(document('<p><code><span style="white-space: pre-wrap;"> x  y </span></code></p><pre style="color:red">  x</pre>'));
  const inline = [...input.rawSpans.keys()][0]!, block = [...input.rawBlocks.keys()][0]!;
  const ast = [{ t: 'Span', c: [[inline, [], []], []] }, { t: 'Div', c: [[block, [], []], []] }];
  restoreDocumentMarkdownOwners(ast, input.rawSpans, input.rawBlocks); expect(ast.map(node => node.t)).toEqual(['RawInline', 'RawBlock']);
  expect(() => restoreDocumentMarkdownOwners([], input.rawSpans, input.rawBlocks)).toThrow('preserve');
  expect(() => restoreDocumentMarkdownOwners([{ t: 'Div', c: [[block], []] }, { t: 'Div', c: [[block], []] }], new Map(), input.rawBlocks)).toThrow('duplicated');
  expect(() => restoreDocumentMarkdownOwners([], new Map([[block, 'inline']]), input.rawBlocks)).toThrow('identity');
});

it('keeps one outer owner when styled text contains inline code', () => {
  const html = '<span style="color:red"><code><span style="white-space:pre-wrap"> x  y </span></code></span>';
  const input = documentMarkdownInput(document(`<p>${html}</p>`));
  expect([...input.rawSpans.values()]).toEqual([html]); expect(input.rawBlocks.size).toBe(0);
  const id = [...input.rawSpans.keys()][0]!, ast = { t: 'Span', c: [[id, [], []], []] };
  restoreDocumentMarkdownOwners(ast, input.rawSpans, input.rawBlocks);
  expect(ast).toEqual({ t: 'RawInline', c: ['html', html] }); expect(JSON.stringify(ast)).not.toContain('eve-document-');
});
it.each([
  '<code>x</code>',
  '<code spellcheck="false" style="white-space:pre-wrap"><span class="DocumentEditor-module__qFNIka__inlineCode">x</span></code>',
  '<code><span style="white-space:pre-wrap">one two</span></code>',
])('uses native inline code for exact ordinary text with only regenerated defaults: %s', body => {
  const input = documentMarkdownInput(document(`<p>${body}</p>`)), $ = load(input.html);
  expect(input.rawSpans.size).toBe(0); expect(input.rawBlocks.size).toBe(0);
  expect($('code').attr('style')).toBeUndefined(); expect($('code span')).toHaveLength(0);
  expect($('code').text()).toBe(body.includes('one two') ? 'one two' : 'x');
});
it.each([' x', 'x ', 'x  y', 'x\ty', 'x\ny'])('retains whole inline code for whitespace that native Pandoc would change: %s', text => {
  const input = documentMarkdownInput(document(`<p><code>${text}</code></p>`)); expect([...input.rawSpans.values()]).toEqual([`<code>${text}</code>`]);
});

it('does not normalize away code defaults inside an outer styled source owner', () => {
  const html = '<span style="color:red"><code spellcheck="false" style="white-space:pre-wrap"><span class="DocumentEditor-module__qFNIka__inlineCode">x</span></code></span>';
  const input = documentMarkdownInput(document(`<p>${html}</p>`)); expect([...input.rawSpans.values()]).toEqual([html]);
});
