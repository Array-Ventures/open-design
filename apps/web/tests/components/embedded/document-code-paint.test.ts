// @vitest-environment jsdom
import { expect, it } from 'vitest';
import styles from '../../../src/components/embedded/document/DocumentEditor.module.css';
import { createEditor, $getRoot, $getState, $isElementNode, $isTextNode, HISTORY_PUSH_TAG, UNDO_COMMAND } from 'lexical';
import { createEmptyHistoryState, registerHistory } from '@lexical/history';
import { CodeNode, CodeHighlightNode, $isCodeNode } from '@lexical/code';
import { $generateHtmlFromNodes, $generateNodesFromDOM } from '@lexical/html';
import { documentImport } from '../../../src/components/embedded/document/document-html';
import { documentBlockId, documentHtmlConfig, initializeDocumentBlockIds } from '../../../src/components/embedded/document/document-identity';
import { serializeMarkdownDocument } from '../../../src/components/embedded/document/markdown-serialization';

const text = '  const n = 1;\n  n++;';
const source = `<pre data-od-id="code-anchor" data-language="javascript"><code style="color:red;background-color:yellow;font-size:14px">${text}</code></pre><p data-od-id="body-anchor">After.</p>`;
function fixture(html = source) {
  const root = document.createElement('div');
  document.body.append(root);
  const editor = createEditor({ nodes: [CodeNode, CodeHighlightNode], theme: { code: styles.code }, html: documentHtmlConfig(), onError: error => { throw error; } });
  editor.setRootElement(root);
  const stopHistory = registerHistory(editor, createEmptyHistoryState(), 300);
  editor.update(() => {
    $getRoot().append(...$generateNodesFromDOM(editor, documentImport(html)));
    initializeDocumentBlockIds(new Map(), 'source-code-paint');
  }, { discrete: true });
  return { editor, root, close: () => { stopHistory(); editor.setRootElement(null); root.remove(); } };
}

it.each(['live', 'html', 'markdown'] as const)('preserves source-owned uniform CODE paint in actual Lexical %s output', surface => {
  const f = fixture();
  try {
    f.editor.getEditorState().read(() => {
      const node = $getRoot().getFirstChild();
      expect($isCodeNode(node)).toBe(true);
      if (!$isCodeNode(node)) throw Error('Expected code block');
      expect(node.getTextContent()).toBe(text);
      expect(node.getLanguage()).toBe('javascript');
      expect($getState(node, documentBlockId)).toBe('code-anchor');
      if (surface === 'live') {
        const painted = Array.from(f.root.querySelectorAll<HTMLElement>('[style]')).find(element => element.textContent === '  const n = 1;');
        expect(painted?.style.color, f.root.innerHTML + JSON.stringify(node.getChildren().map(n => n.exportJSON()))).toBe('red');
        expect(painted?.style.backgroundColor).toBe('yellow');
      } else {
        const output = surface === 'html' ? $generateHtmlFromNodes(f.editor) : serializeMarkdownDocument(f.editor);
        const parsed = new DOMParser().parseFromString(output, 'text/html');
        const code = parsed.querySelector('pre > code');
        expect(code?.textContent).toBe(text);
        expect((code as HTMLElement | null)?.style.color).toBe('red');
        expect((code as HTMLElement | null)?.style.backgroundColor).toBe('yellow');
      }
    });
  } finally { f.close(); }
});

function exported(editor: ReturnType<typeof createEditor>): string {
  return editor.getEditorState().read(() => $generateHtmlFromNodes(editor));
}
function assertUniform(html: string, expectedText = text) {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const pre = parsed.querySelector('pre')!;
  const code = pre.querySelector<HTMLElement>(':scope > code')!;
  expect(pre.dataset.odId).toBe('code-anchor');
  expect(pre.dataset.language).toBe('javascript');
  expect(code.textContent).toBe(expectedText);
  expect(code.style.color).toBe('red');
  expect(code.style.backgroundColor).toBe('yellow');
  expect(code.style.fontSize).toBe('14px');
  expect(pre.style.backgroundColor).toBe('');
  expect(pre.className).toBe('');
  expect(code.querySelector('span')).toBeNull();
}

it('retains paint and identity through unrelated real Lexical edits, Undo and HTML reimport', async () => {
  const f = fixture();
  try {
    f.editor.update(() => {
      const paragraph = $getRoot().getLastChild();
      if (!$isElementNode(paragraph)) throw Error('Expected paragraph');
      const text = paragraph.getFirstChild();
      if (!$isTextNode(text)) throw Error('Expected paragraph text');
      text.setTextContent('Unrelated edit.');
    }, { discrete: true, tag: HISTORY_PUSH_TAG });
    expect(exported(f.editor)).toContain('Unrelated edit.');
    assertUniform(exported(f.editor));
    f.editor.dispatchCommand(UNDO_COMMAND, undefined);
    await Promise.resolve();
    expect(exported(f.editor)).toContain('After.');
    assertUniform(exported(f.editor));
    const { supportedDocument } = await import('../../../src/components/embedded/document/document-admission');
    const { documentHtml } = await import('../../../src/components/embedded/document/document-html');
    expect(supportedDocument(documentHtml('Saved', exported(f.editor)), 'code.html')).toBe(true);
    const reopened = fixture(exported(f.editor));
    try { assertUniform(exported(reopened.editor)); }
    finally { reopened.close(); }
  } finally { f.close(); }
});

it.each(['tabs and Unicode', 'final newline'] as const)('preserves %s through styled Markdown save and actual readback', async variant => {
  const { readMarkdownDocument, finalizeMarkdownDocument } = await import('../../../src/components/embedded/document/markdown-document');
  const exact = variant === 'final newline' ? '  final\n' : '  零\t😀\n next';
  const f = fixture(source.replace(text, exact));
  try {
    const saved = await finalizeMarkdownDocument(f.editor.getEditorState().read(() => serializeMarkdownDocument(f.editor)));
    const readback = await readMarkdownDocument(saved, 'Painted code');
    const reopened = fixture(readback.html);
    try { assertUniform(exported(reopened.editor), exact); }
    finally { reopened.close(); }
  } finally { f.close(); }
});

it('retains mixed run paint as lossless HTML instead of flattening it to a uniform owner or fence', async () => {
  const { readMarkdownDocument, finalizeMarkdownDocument } = await import('../../../src/components/embedded/document/markdown-document');
  const mixed = '<pre data-od-id="code-anchor" data-language="javascript"><code style="color:red;background-color:yellow"><span>red\n</span><span style="color:blue">blue</span></code></pre>';
  const f = fixture(mixed);
  try {
    const html = exported(f.editor);
    expect(new DOMParser().parseFromString(html, 'text/html').querySelector('pre > code')).toBeNull();
    const saved = await finalizeMarkdownDocument(f.editor.getEditorState().read(() => serializeMarkdownDocument(f.editor)));
    expect(saved).toContain('<pre');
    const readback = await readMarkdownDocument(saved, 'Mixed');
    const reopened = fixture(readback.html);
    try {
      reopened.editor.getEditorState().read(() => {
        const node = $getRoot().getFirstChild();
        if (!$isCodeNode(node)) throw Error('Expected code block');
        expect(node.getTextContent()).toBe('red\nblue');
        const runs = node.getChildren().filter($isTextNode);
        expect(runs.map(run => run.getTextContent())).toEqual(['red', 'blue']);
        expect(runs[0]!.getStyle()).toContain('color: red');
        expect(runs[1]!.getStyle()).toContain('color: blue');
        expect(runs.every(run => run.getStyle().includes('background-color: yellow'))).toBe(true);
      });
    } finally { reopened.close(); }
  } finally { f.close(); }
});

it.each(['background:url(https://fixture.test/image.png)', 'position:fixed', 'color:var(--external-ink)'])('keeps unsafe authored CODE %s outside supported editing admission', async style => {
  const { supportedDocument } = await import('../../../src/components/embedded/document/document-admission');
  const { documentHtml } = await import('../../../src/components/embedded/document/document-html');
  expect(supportedDocument(documentHtml('Unsafe', `<pre><code style="${style}">Keep source</code></pre>`), 'code.html')).toBe(false);
});

it('keeps ordinary unstyled code as a language fence and preserves its text on Markdown reimport', async () => {
  const { readMarkdownDocument, finalizeMarkdownDocument } = await import('../../../src/components/embedded/document/markdown-document');
  const f = fixture('<pre data-language="javascript"><code>  plain\nnext</code></pre>');
  try {
    const saved = await finalizeMarkdownDocument(f.editor.getEditorState().read(() => serializeMarkdownDocument(f.editor)));
    expect(saved).toContain('```javascript\n  plain\nnext\n```');
    expect(saved).not.toContain('<pre');
    const reopened = fixture((await readMarkdownDocument(saved, 'Plain')).html);
    try {
      reopened.editor.getEditorState().read(() => {
        const node = $getRoot().getFirstChild();
        if (!$isCodeNode(node)) throw Error('Expected code block');
        expect(node.getTextContent()).toBe('  plain\nnext');
        expect(node.getLanguage()).toBe('javascript');
      });
    } finally { reopened.close(); }
  } finally { f.close(); }
});
