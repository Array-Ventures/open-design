// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { createEditor, $getRoot } from 'lexical';
import { $generateHtmlFromNodes, $generateNodesFromDOM } from '@lexical/html';
import { documentNodes } from '../../../src/components/embedded/document/DocumentEditor';
import { documentHtml, documentImport } from '../../../src/components/embedded/document/document-html';
import { documentHtmlConfig, initializeDocumentBlockIds } from '../../../src/components/embedded/document/document-identity';
import { supportedDocument } from '../../../src/components/embedded/document/document-admission';
import { serializeMarkdownDocument } from '../../../src/components/embedded/document/markdown-serialization';
import { readMarkdownDocument } from '../../../src/components/embedded/document/markdown-document';
const atom = '<time data-eve-document-date="1" datetime="2024-02-29" data-eve-date-locale="en-US">Feb 29, 2024</time>';
const source = documentHtml('Date source', `<p data-od-id="paragraph">Before ${atom} after.</p>`);
it('admits a canonical Gregorian date atom without flattening it into plain text', () => {
  expect(supportedDocument(source, 'date.html')).toBe(true);
});
it('retains date semantics and persisted label through actual Lexical HTML and Markdown reopen', async () => {
  const editor = createEditor({ nodes: documentNodes, html: documentHtmlConfig(), onError: error => { throw error; } });
  editor.update(() => { $getRoot().append(...$generateNodesFromDOM(editor, documentImport(source))); initializeDocumentBlockIds(new Map(), 'a'.repeat(64)); }, { discrete: true });
  const exported = editor.getEditorState().read(() => ({ html: $generateHtmlFromNodes(editor), markdown: serializeMarkdownDocument(editor) }));
  expect(new DOMParser().parseFromString(exported.html, 'text/html').querySelector('time')?.outerHTML).toBe(atom);
  const reopened = await readMarkdownDocument(exported.markdown, 'Date source');
  expect(new DOMParser().parseFromString(reopened.html, 'text/html').querySelector('time')?.outerHTML).toBe(atom);
});
it.each(['2023-02-29', '2024-02-30', '2024-13-01', '2024-00-01', '0000-01-01'])('refuses an impossible date instead of silently flattening it: %s', iso => {
  expect(supportedDocument(source.replace('2024-02-29', iso), 'date.html')).toBe(false);
});
it.each([
  atom.replace('datetime="2024-02-29"', 'datetime="2024-02-29T00:00:00Z"'),
  atom.replace('data-eve-date-locale="en-US"', 'data-eve-date-locale="en_us"'),
  atom.replace('>Feb 29, 2024<', '><strong>Feb 29, 2024</strong><'),
  atom.replace('<time ', '<time onclick="run()" '),
  atom.replace('<time ', '<time style="color:red" '),
  atom.replace('data-eve-document-date="1"', 'data-eve-document-date="2"'),
  '<span data-eve-document-date="1" datetime="2024-02-29" data-eve-date-locale="en-US">Date</span>',
])('refuses the complete malformed atom before sanitize/import: %s', malformed => {
  const input = documentHtml('Unsafe date', `<p>${malformed}</p>`);
  expect(supportedDocument(input, 'date.html')).toBe(false);
  expect(() => documentImport(input)).toThrow('Document dates could not be preserved');
});
it('rejects malformed serialized Date data instead of silently stripping it', async () => {
  const { DocumentDateNode } = await import('../../../src/components/embedded/document/DocumentDateNode');
  const editor = createEditor({ nodes: documentNodes, onError: error => { throw error; } });
  for (const data of [{ iso: '2023-02-29' }, { locale: 'bad_locale' }, { label: '' }, { label: 'unsafe\nlabel' }, { iso: 20240229 }]) {
    expect(() => editor.update(() => DocumentDateNode.importJSON({ type: 'document-date', version: 1, iso: '2024-02-29', locale: 'en-US', label: 'Leap day', ...data } as never), { discrete: true })).toThrow();
  }
});
it.each(['<pre><code>DATE</code></pre>', '<code>DATE</code>', 'DATE'])('does not admit a Date that Lexical would flatten outside a document block', container => {
  expect(supportedDocument(documentHtml('Date context', container.replace('DATE', atom)), 'date.html')).toBe(false);
});
it('retains Date atoms already present inside a table even though table insertion is unavailable', () => {
  const html = documentHtml('Table date', `<table><tbody><tr><td><p>${atom}</p></td></tr></tbody></table>`);
  expect(supportedDocument(html, 'table.html')).toBe(true);
  const editor = createEditor({ nodes: documentNodes, onError: error => { throw error; } });
  editor.update(() => $getRoot().append(...$generateNodesFromDOM(editor, documentImport(html))), { discrete: true });
  expect(editor.read(() => $generateHtmlFromNodes(editor))).toContain(atom);
});
