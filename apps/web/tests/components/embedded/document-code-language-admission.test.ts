// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { createEditor, $getRoot, $getState } from 'lexical';
import { CodeNode, CodeHighlightNode, $isCodeNode } from '@lexical/code';
import { $generateHtmlFromNodes, $generateNodesFromDOM } from '@lexical/html';
import { readMarkdownDocument } from '../../../src/components/embedded/document/markdown-document';
import { supportedDocument } from '../../../src/components/embedded/document/document-admission';
import { documentImport } from '../../../src/components/embedded/document/document-html';
import { documentBlockId, documentHtmlConfig } from '../../../src/components/embedded/document/document-identity';
import styles from '../../../src/components/embedded/document/DocumentEditor.module.css';

it.each(['ts', 'javascript'])('admits and imports a raw styled language-%s CODE through the actual supported-document gate', async language => {
  const text = '  const value = 1;\n  value++;\n';
  const raw = `<pre data-od-id="code-anchor"><code class="language-${language}" style="color:red;background-color:yellow;font-size:14px">${text}</code></pre>`;
  const loaded = await readMarkdownDocument(raw, 'Raw painted code');
  // DocumentSurface calls this gate before documentImport/Lexical. The earlier
  // producer regression bypassed it and therefore missed the real fallback.
  expect(supportedDocument(loaded.html, 'code.md')).toBe(true);
  const editor = createEditor({ nodes: [CodeNode, CodeHighlightNode], theme: { code: styles.code }, html: documentHtmlConfig(), onError: error => { throw error; } });
  editor.update(() => { $getRoot().append(...$generateNodesFromDOM(editor, documentImport(loaded.html))); }, { discrete: true });
  editor.getEditorState().read(() => {
    const node = $getRoot().getFirstChild();
    if (!$isCodeNode(node)) throw Error('Expected code block');
    expect(node.getLanguage()).toBe(language);
    expect(node.getTextContent()).toBe(text);
    expect($getState(node, documentBlockId)).toBe('code-anchor');
    const exported = new DOMParser().parseFromString($generateHtmlFromNodes(editor), 'text/html');
    expect(exported.querySelector('pre')?.getAttribute('data-language')).toBe(language);
    expect(exported.querySelector('code')?.textContent).toBe(text);
    expect(exported.querySelector<HTMLElement>('code')?.style.color).toBe('red');
    expect(exported.querySelector<HTMLElement>('code')?.style.backgroundColor).toBe('yellow');
  });
});

it('admits an ordinary language fence while retaining its exact logical text', async () => {
  const loaded = await readMarkdownDocument('```ts\n  value++;\n```', 'Fenced');
  expect(supportedDocument(loaded.html, 'code.md')).toBe(true);
  const parsed = new DOMParser().parseFromString(loaded.html, 'text/html');
  expect(parsed.querySelector('pre')?.getAttribute('data-language')).toBe('ts');
  expect(parsed.querySelector('code')?.textContent).toBe('  value++;');
});

it.each(['unknown-author-class', 'language-ts unknown-author-class', 'language-ts language-js', 'language-ts!'])('retains unqualified CODE classes %s and refuses editing admission', async classes => {
  const loaded = await readMarkdownDocument(`<pre data-od-id="keep"><code class="${classes}" style="color:red">Keep\n</code></pre>`, 'Unknown');
  const parsed = new DOMParser().parseFromString(loaded.html, 'text/html');
  expect(parsed.querySelector('code')?.getAttribute('class')).toBe(classes);
  expect(parsed.querySelector('code')?.textContent).toBe('Keep\n');
  expect(supportedDocument(loaded.html, 'code.md')).toBe(false);
});

it('keeps conflicting PRE and CODE language metadata unqualified rather than choosing and dropping one', async () => {
  const loaded = await readMarkdownDocument('<pre data-language="python"><code class="language-ts" style="color:red">Keep\n</code></pre>', 'Conflict');
  const parsed = new DOMParser().parseFromString(loaded.html, 'text/html');
  expect(parsed.querySelector('pre')?.getAttribute('data-language')).toBe('python');
  expect(parsed.querySelector('code')?.getAttribute('class')).toBe('language-ts');
  expect(parsed.querySelector('code')?.textContent).toBe('Keep\n');
  expect(supportedDocument(loaded.html, 'code.md')).toBe(false);
});

it.each(['background:url(https://fixture.test/image.png)', 'position:fixed', 'color:var(--external-ink)'])('does not let a semantic language class bypass unsafe authored %s', async style => {
  const loaded = await readMarkdownDocument(`<pre><code class="language-ts" style="${style}">Keep\n</code></pre>`, 'Unsafe');
  const parsed = new DOMParser().parseFromString(loaded.html, 'text/html');
  expect(parsed.querySelector('code')?.getAttribute('style')).toBe(style);
  expect(parsed.querySelector('code')?.textContent).toBe('Keep\n');
  expect(supportedDocument(loaded.html, 'code.md')).toBe(false);
});
