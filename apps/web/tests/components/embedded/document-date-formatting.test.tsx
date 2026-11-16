// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { $getRoot, CONTROLLED_TEXT_INSERTION_COMMAND, createEditor, type LexicalEditor } from 'lexical';
import { $generateHtmlFromNodes, $generateNodesFromDOM } from '@lexical/html';
import { DocumentEditor, documentNodes } from '../../../src/components/embedded/document/DocumentEditor';
import { documentHtmlConfig } from '../../../src/components/embedded/document/document-identity';
import { readMarkdownDocument } from '../../../src/components/embedded/document/markdown-document';
import styles from '../../../src/components/embedded/document/DocumentEditor.module.css';
import { documentHtml, documentImport } from '../../../src/components/embedded/document/document-html';
import { supportedDocument } from '../../../src/components/embedded/document/document-admission';
const save = vi.hoisted(() => vi.fn(async (_project: string, _file: string, html: string) => ({ html, sha256: 'saved' })));
vi.mock('../../../src/components/embedded/document/document-file', () => ({ saveDocumentFile: save }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const atom = '<time data-eve-document-date="1" datetime="2024-02-29" data-eve-date-locale="en-US">Persisted Date label</time>';
const cases = [
  ['semantic bold', `<strong>${atom}</strong>`, 'strong'],
  ['semantic italic', `<em>${atom}</em>`, 'em'],
  ['authored ink', `<span style="color:rgb(180, 20, 30)">${atom}</span>`, 'span[style*="color"]'],
  ['authored size', `<span style="font-size:24px">${atom}</span>`, 'span[style*="font-size"]'],
] as const;
it.each(cases)('preserves %s Date presentation in actual Lexical export or refuses before editing', (_name, fragment, retained) => {
  const html = documentHtml('Formatted Date', `<p>${fragment}</p>`);
  if (!supportedDocument(html, 'date.html')) { expect(() => documentImport(html)).toThrow(); return; }
  const editor = createEditor({ nodes: documentNodes, html: documentHtmlConfig(), onError: error => { throw error; } });
  editor.update(() => $getRoot().append(...$generateNodesFromDOM(editor, documentImport(html))), { discrete: true });
  const output = new DOMParser().parseFromString(editor.read(() => $generateHtmlFromNodes(editor)), 'text/html');
  expect(output.querySelector('time')?.closest(retained)).not.toBeNull();
});
it('does not drop admitted bold Date presentation on an unrelated actual conditional-writer save', async () => {
  const html = documentHtml('Formatted Date', `<p data-od-id="body"><strong>${atom}</strong> end.</p>`);
  if (!supportedDocument(html, 'date.html')) { expect(() => documentImport(html)).toThrow(); return; }
  render(<DocumentEditor projectId="format-date" fileName="date.html" title="Formatted Date" observed={{ html, sha256: 'before' }} onSaved={() => {}} />);
  const active = (screen.getByRole('textbox', { name: 'Formatted Date' }) as HTMLElement & { __lexicalEditor: LexicalEditor }).__lexicalEditor;
  await act(async () => { active.update(() => $getRoot().getFirstChildOrThrow().selectEnd(), { discrete: true }); active.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, ' appended'); });
  fireEvent.click(await screen.findByRole('button', { name: 'Save document' }));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  const output = new DOMParser().parseFromString(save.mock.calls[0]![2], 'text/html');
  expect(output.querySelector('time')?.closest('strong')).not.toBeNull(); expect(output.body.textContent).toContain(' appended');
});
it.each(['p', 'div', 'h1'])('keeps authored inherited text presentation on %s out of editable Date import', tag => {
  for (const style of ['color:red', 'font-size:24px', 'font-weight:bold', 'font-family:Georgia', 'font-style:italic']) {
    const html = documentHtml('Inherited Date', `<${tag} style="${style}">${atom}</${tag}>`);
    expect(supportedDocument(html, 'date.html')).toBe(false);
    expect(() => documentImport(html)).toThrow('Document dates could not be preserved');
  }
});
it.each(['p', 'span', 'h1'])('does not flatten an ancestor format class on %s around a Date', tag => {
  const html = documentHtml('Class Date', `<${tag} class="${styles.underline}">${atom}</${tag}>`);
  expect(supportedDocument(html, 'date.html')).toBe(false); expect(() => documentImport(html)).toThrow();
});
it('keeps unknown global CSS outside the existing canonical source-admission boundary', () => {
  const source = documentHtml('Global Date', `<p class="author-date">${atom}</p>`).replace('</head>', '<style>.author-date{font-size:24px;color:red}</style></head>');
  expect(supportedDocument(source, 'date.html')).toBe(false);
});
it('preserves raw Markdown formatting while refusing a Date it cannot safely edit', async () => {
  const markdown = `**${atom}**\n`;
  const parsed = await readMarkdownDocument(markdown, 'Bold Date');
  expect(new DOMParser().parseFromString(parsed.html, 'text/html').querySelector('time')?.closest('strong')).not.toBeNull();
  expect(supportedDocument(parsed.html, 'date.md')).toBe(false); expect(() => documentImport(parsed.html)).toThrow();
});
it.each([
  ['semantic heading', `<h1>${atom}</h1>`, 'h1'],
  ['retained block layout', `<p style="text-align:center;padding-inline-start:80px">${atom}</p>`, 'p[style*="text-align: center"][style*="padding-inline-start: 80px"]'],
  ['retained table background', `<table><tbody><tr><td style="background-color:rgb(255, 204, 0)"><p>${atom}</p></td></tr></tbody></table>`, 'td[style*="background-color: rgb(255, 204, 0)"]'],
  ['preserved link', `<p><a href="https://example.invalid">${atom}</a></p>`, 'a[href="https://example.invalid"]'],
  ['retained checklist', `<ul __lexicallisttype="check" class="${styles.checklist}"><li aria-checked="true" role="checkbox" tabindex="-1" class="${styles.checked}">${atom}</li></ul>`, 'li[aria-checked="true"]'],
] as const)('continues actual source import/export for %s Date context', (_name, body, retained) => {
  const source = documentHtml('Supported Date', body); expect(supportedDocument(source, 'date.html')).toBe(true);
  const editor = createEditor({ nodes: documentNodes, html: documentHtmlConfig(), theme: { list: { checklist: styles.checklist, listitemChecked: styles.checked, listitemUnchecked: styles.unchecked } }, onError: error => { throw error; } });
  editor.update(() => $getRoot().append(...$generateNodesFromDOM(editor, documentImport(source))), { discrete: true });
  const output = new DOMParser().parseFromString(editor.read(() => $generateHtmlFromNodes(editor)), 'text/html');
  expect(output.querySelector('time')?.outerHTML).toBe(atom); expect(output.querySelector('time')?.closest(retained)).not.toBeNull();
});
