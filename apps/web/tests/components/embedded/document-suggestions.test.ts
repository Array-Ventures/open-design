// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { documentHtml, documentImport } from '../../../src/components/embedded/document/document-html';
import { supportedDocument } from '../../../src/components/embedded/document/document-admission';
const id = '11111111-1111-4111-8111-111111111111';
const mark = (kind: 'insert' | 'delete', text: string, operation: 'insert' | 'delete' | 'replace' = kind) => `<${kind === 'insert' ? 'ins' : 'del'} data-eve-suggestion="1" data-eve-suggestion-id="${id}" data-eve-suggestion-operation="${operation}">${text}</${kind === 'insert' ? 'ins' : 'del'}>`;
it('admits only a complete recognized replacement and retains both proposed and removed text at import', () => {
  const html = documentHtml('Review', `<p data-od-id="body">Before ${mark('delete', '<strong>old</strong>', 'replace')}${mark('insert', '<em>new</em>', 'replace')} after.</p>`);
  expect(supportedDocument(html, 'review.html')).toBe(true);
  const parsed = documentImport(html);
  expect(parsed.querySelector('del')?.textContent).toBe('old');
  expect(parsed.querySelector('ins')?.textContent).toBe('new');
  expect(parsed.querySelector('strong')?.textContent).toBe('old');
  expect(parsed.querySelector('em')?.textContent).toBe('new');
});
it.each([
  '<ins>unmarked authored insertion</ins>', '<del>unmarked authored deletion</del>',
  mark('insert', 'x', 'replace'),
  mark('insert', 'x') + mark('insert', 'duplicate'),
  mark('delete', mark('insert', 'nested'), 'replace'),
  mark('insert', '<p>block</p>'),
  mark('insert', 'x').replace('data-eve-suggestion="1"', 'data-eve-suggestion="2"'),
])('refuses malformed, ambiguous or unrecognized tracked markup: %s', body => {
  expect(supportedDocument(documentHtml('Review', `<p>${body}</p>`), 'review.html')).toBe(false);
});

import { createEditor, $getRoot } from 'lexical';
import { $generateHtmlFromNodes, $generateNodesFromDOM } from '@lexical/html';
import { documentNodes } from '../../../src/components/embedded/document/DocumentEditor';
import { documentHtmlConfig, initializeDocumentBlockIds } from '../../../src/components/embedded/document/document-identity';
import { serializeMarkdownDocument } from '../../../src/components/embedded/document/markdown-serialization';
import { readMarkdownDocument } from '../../../src/components/embedded/document/markdown-document';
it('roundtrips replacement identity, both formatted branches and Unicode through real Lexical and Markdown', async () => {
  const source = documentHtml('Review', `<p data-od-id="body">Before ${mark('delete', '<strong>old 👩🏽‍💻</strong>', 'replace')}${mark('insert', '<a href="https://fixture.test/">new é</a>', 'replace')} after.</p>`);
  const editor = createEditor({ nodes: documentNodes, html: documentHtmlConfig(), onError: error => { throw error; } });
  editor.update(() => {
    $getRoot().append(...$generateNodesFromDOM(editor, documentImport(source)));
    initializeDocumentBlockIds(new Map(), 'a'.repeat(64));
  }, { discrete: true });
  const exported = editor.getEditorState().read(() => ({ html: documentHtml('Review', $generateHtmlFromNodes(editor)), markdown: serializeMarkdownDocument(editor) }));
  expect(supportedDocument(exported.html, 'review.html')).toBe(true);
  const markdown = await readMarkdownDocument(exported.markdown, 'Review');
  expect(supportedDocument(markdown.html, 'review.md')).toBe(true);
  for (const html of [exported.html, markdown.html]) {
    const parsed = documentImport(html);
    expect(parsed.querySelector('del')?.textContent).toBe('old 👩🏽‍💻');
    expect(parsed.querySelector('ins')?.textContent).toBe('new é');
    expect(parsed.querySelector('del strong')).not.toBeNull();
    expect(parsed.querySelector('ins a')?.getAttribute('href')).toBe('https://fixture.test/');
    expect(parsed.querySelector('ins')?.getAttribute('data-eve-suggestion-id')).toBe(id);
    expect(parsed.querySelector('p')?.getAttribute('data-od-id')).toBe('body');
  }
});

import { $getSelection, $isRangeSelection, $isTextNode, $isElementNode } from 'lexical';
import { $documentSuggestions, $suggestDocumentText, $suggestDocumentDeletion, $resolveDocumentSuggestion } from '../../../src/components/embedded/document/document-suggestion-commands';
function fixture(body: string) {
  const editor = createEditor({ nodes: documentNodes, html: documentHtmlConfig(), onError: error => { throw error; } });
  editor.update(() => { $getRoot().append(...$generateNodesFromDOM(editor, documentImport(documentHtml('Review', body)))); initializeDocumentBlockIds(new Map(), 'a'.repeat(64)); }, { discrete: true });
  return editor;
}
it('retains a formatted original replacement, rejects atomically, then preserves a separate deletion until acceptance', () => {
  const editor = fixture('<p data-od-id="body"><strong>old 👩🏽‍💻</strong> after</p>');
  editor.update(() => {
    const paragraph = $getRoot().getFirstChildOrThrow();
    if (!$isElementNode(paragraph)) throw Error('Expected paragraph');
    const text = paragraph.getFirstDescendant();
    if (!$isTextNode(text)) throw Error('Expected text');
    text.select(0, text.getTextContentSize());
    $suggestDocumentText('new é', id);
    expect($documentSuggestions().map(node => node.getTextContent())).toEqual(['old 👩🏽‍💻', 'new é']);
    $resolveDocumentSuggestion(id, false);
    expect($getRoot().getTextContent()).toBe('old 👩🏽‍💻 after');
    const restored = paragraph.getFirstDescendant();
    if (!$isTextNode(restored)) throw Error('Expected text');
    expect(restored.hasFormat('bold')).toBe(true);
    restored.select(0, restored.getTextContentSize()); $suggestDocumentDeletion(id);
    expect($getRoot().getTextContent()).toBe('old 👩🏽‍💻 after');
    $resolveDocumentSuggestion(id, true);
    expect($getRoot().getTextContent()).toBe(' after');
  }, { discrete: true });
});
it('keeps selected hyperlinks and text formatting when a replacement is rejected', () => {
  const editor = fixture('<p>Before <a href="https://fixture.test/"><strong>link</strong></a> after</p>');
  editor.update(() => {
    const paragraph = $getRoot().getFirstChildOrThrow();
    if (!$isElementNode(paragraph)) throw Error('Expected paragraph');
    paragraph.select(0, paragraph.getChildrenSize());
    $suggestDocumentText('replacement', id); $resolveDocumentSuggestion(id, false);
    const html = $generateHtmlFromNodes(editor);
    expect(new DOMParser().parseFromString(html, 'text/html').querySelector('a strong')?.textContent).toBe('link');
    expect($getRoot().getTextContent()).toBe('Before link after');
  }, { discrete: true });
});
it('refuses cross-block and already-proposed ranges before changing text', () => {
  const editor = fixture(`<p>first</p><p>${mark('insert', 'second')}</p>`);
  editor.update(() => {
    $getRoot().select(0, 2);
    const before = $generateHtmlFromNodes(editor);
    expect(() => $suggestDocumentText('bad', id)).toThrow();
    expect($generateHtmlFromNodes(editor)).toBe(before);
    $getRoot().getLastChildOrThrow().selectStart();
    const selection = $getSelection(); expect($isRangeSelection(selection)).toBe(true);
    expect(() => $suggestDocumentDeletion(id)).toThrow();
  }, { discrete: true });
});

it.each(['within-link', 'from-link'] as const)('preserves link boundaries for a replacement starting %s', scope => {
  const editor = fixture('<p data-od-id="body">Before <a href="https://fixture.test/">link</a> after</p>');
  editor.update(() => {
    const paragraph = $getRoot().getFirstChildOrThrow();
    if (!$isElementNode(paragraph)) throw Error('Expected paragraph');
    const texts = paragraph.getAllTextNodes();
    texts[1]!.select(scope === 'within-link' ? 1 : 2, scope === 'within-link' ? 3 : 4);
    if (scope === 'from-link') {
      const selection = $getSelection(); if (!$isRangeSelection(selection)) throw Error('Expected range');
      selection.focus.set(texts[2]!.getKey(), 3, 'text');
    }
    $suggestDocumentText('new', id);
    const html = documentHtml('Review', $generateHtmlFromNodes(editor));
    expect(supportedDocument(html, 'review.html')).toBe(true);
    expect(documentImport(html).querySelector('del')?.textContent).toBe(scope === 'within-link' ? 'in' : 'nk af');
    $resolveDocumentSuggestion(id, false);
    const restored = new DOMParser().parseFromString($generateHtmlFromNodes(editor), 'text/html');
    // Native range insertion splits a partial link into adjacent equivalent links.
    // Inspect every linked character and URL, rather than requiring one DOM wrapper.
    const links = Array.from(restored.querySelectorAll('a'));
    expect(links.map(link => link.textContent).join('')).toBe('link');
    expect(links.every(link => link.getAttribute('href') === 'https://fixture.test/')).toBe(true);
    expect(restored.querySelector('p')?.textContent).toBe('Before link after');
  }, { discrete: true });
});
it('keeps a table-cell proposal and neighboring cell content through HTML and Markdown source roundtrip', async () => {
  const editor = fixture('<table data-od-id="table"><tbody><tr><td data-od-id="cell"><p data-od-id="cell-text">Before</p></td><td><p>Neighbor</p></td></tr></tbody></table>');
  editor.update(() => {
    const table = $getRoot().getFirstChildOrThrow(); if (!$isElementNode(table)) throw Error('Expected table');
    const text = table.getAllTextNodes()[0]!; text.select(0, text.getTextContentSize()); $suggestDocumentText('After', id);
  }, { discrete: true });
  const html = editor.getEditorState().read(() => documentHtml('Review', $generateHtmlFromNodes(editor)));
  const markdown = await readMarkdownDocument(editor.getEditorState().read(() => serializeMarkdownDocument(editor)), 'Review');
  for (const source of [html, markdown.html]) {
    expect(supportedDocument(source, 'review.md')).toBe(true);
    const parsed = documentImport(source), cells = parsed.querySelectorAll('td');
    expect(cells).toHaveLength(2); expect(cells[1]?.textContent).toBe('Neighbor');
    expect(cells[0]?.querySelector('del')?.textContent).toBe('Before'); expect(cells[0]?.querySelector('ins')?.textContent).toBe('After');
    expect(cells[0]?.querySelector('p')?.getAttribute('data-od-id')).toBe('cell-text');
  }
});
