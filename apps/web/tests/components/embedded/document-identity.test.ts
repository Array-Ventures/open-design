// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { createEditor, $createParagraphNode, $createTextNode, $getRoot, $getState, $setState } from 'lexical';
import { $createHeadingNode, HeadingNode, QuoteNode } from '@lexical/rich-text';
import { ListItemNode, ListNode } from '@lexical/list';
import { TableNode, TableCellNode, TableRowNode } from '@lexical/table';
import { documentBlockId, ensureDocumentBlockIds } from '../../../src/components/embedded/document/document-identity';
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
