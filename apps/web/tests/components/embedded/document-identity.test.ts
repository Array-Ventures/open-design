// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { createEditor, $createParagraphNode, $createTextNode, $getRoot, $getState, $setState } from 'lexical';
import { $createHeadingNode, HeadingNode, QuoteNode } from '@lexical/rich-text';
import { ListItemNode, ListNode } from '@lexical/list';
import { TableNode, TableCellNode, TableRowNode } from '@lexical/table';
import { documentBlockId, initializeDocumentBlockIds, ensureDocumentBlockIds } from '../../../src/components/embedded/document/document-identity';
it('retains an original heading identity when a paragraph is pasted before it', () => {
  const editor = createEditor({ nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, TableNode, TableCellNode, TableRowNode], onError: error => { throw error; } });
  const owners = new Map<string, string>();
  editor.update(() => {
    const heading = $createHeadingNode('h1').append($createTextNode('Original'));
    $setState(heading, documentBlockId, 'original-anchor');
    $getRoot().append(heading); ensureDocumentBlockIds(owners);
    const pasted = $createParagraphNode().append($createTextNode('Pasted'));
    $setState(pasted, documentBlockId, 'original-anchor'); heading.insertBefore(pasted);
    ensureDocumentBlockIds(owners);
    expect($getState(heading, documentBlockId)).toBe('original-anchor');
    expect($getState(pasted, documentBlockId)).not.toBe('original-anchor');
    const pastedId = $getState(pasted, documentBlockId);
    ensureDocumentBlockIds(owners); expect($getState(pasted, documentBlockId)).toBe(pastedId);
  }, { discrete: true });
});

it('initializes deterministic missing IDs without stealing a later source-owned ID', () => {
  const editor = createEditor({ onError: error => { throw error; } });
  editor.update(() => {
    const missing = $createParagraphNode().append($createTextNode('Missing')), original = $createParagraphNode().append($createTextNode('Original'));
    $setState(original, documentBlockId, 'doc-source-0'); $getRoot().append(missing, original);
    const owners = new Map<string, string>(); initializeDocumentBlockIds(owners, 'source');
    expect($getState(original, documentBlockId)).toBe('doc-source-0'); expect($getState(missing, documentBlockId)).toBe('doc-source-0-1');
    ensureDocumentBlockIds(owners); expect($getState(original, documentBlockId)).toBe('doc-source-0');
  }, { discrete: true });
});

it('round-trips supported authored inline typography through Lexical', async () => {
  const { $generateNodesFromDOM, $generateHtmlFromNodes } = await import('@lexical/html');
  const { documentImport } = await import('../../../src/components/embedded/document/document-html');
  const { documentHtmlConfig } = await import('../../../src/components/embedded/document/document-identity');
  const editor = createEditor({ html: documentHtmlConfig(), onError: error => { throw error; } });
  editor.update(() => {
    $getRoot().append(...$generateNodesFromDOM(editor, documentImport('<p><span style="color:rgb(10, 20, 30);font-size:22px;font-family:Georgia">Keep <strong style="color:blue">inner</strong></span></p>')));
  }, { discrete: true });
  editor.getEditorState().read(() => {
    const output = new DOMParser().parseFromString($generateHtmlFromNodes(editor), 'text/html');
    // Lexical exports bold text as a styled strong element (optionally wrapped in b).
    const styled = Array.from(output.querySelectorAll<HTMLElement>('[style]'));
    const outer = styled.find(element => element.textContent === 'Keep ');
    const inner = styled.find(element => element.textContent === 'inner');
    expect(outer?.style.color).toBe('rgb(10, 20, 30)');
    expect(outer?.style.fontSize).toBe('22px');
    expect(outer?.style.fontFamily).toBe('Georgia');
    expect(inner?.style.color).toBe('blue');
    expect(inner?.style.fontSize).toBe('22px');
  });
});


it('preserves block direction across importing and exporting a saved document', async () => {
  const { $generateNodesFromDOM, $generateHtmlFromNodes } = await import('@lexical/html');
  const { documentImport } = await import('../../../src/components/embedded/document/document-html');
  const { documentHtmlConfig } = await import('../../../src/components/embedded/document/document-identity');
  const editor = createEditor({ nodes: [HeadingNode], html: documentHtmlConfig(), onError: error => { throw error; } });
  editor.update(() => {
    $getRoot().append(...$generateNodesFromDOM(editor, documentImport('<h1 dir="rtl">Heading</h1><p dir="ltr">Body</p>')));
  }, { discrete: true });
  editor.getEditorState().read(() => {
    const output = new DOMParser().parseFromString($generateHtmlFromNodes(editor), 'text/html');
    expect(output.querySelector('h1')?.getAttribute('dir')).toBe('rtl');
    expect(output.querySelector('p')?.getAttribute('dir')).toBe('ltr');
  });
});
