// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { createEditor, $getRoot, $getSelection, $isElementNode, $isRangeSelection, HISTORY_PUSH_TAG, UNDO_COMMAND, REDO_COMMAND, type ElementNode } from 'lexical';
import { $isLinkNode } from '@lexical/link';
import { $generateNodesFromDOM } from '@lexical/html';
import { createEmptyHistoryState, registerHistory } from '@lexical/history';
import { documentNodes } from '../../../src/components/embedded/document/DocumentEditor';
import { documentHtml, documentImport } from '../../../src/components/embedded/document/document-html';
import { supportedDocument } from '../../../src/components/embedded/document/document-admission';
import { documentHtmlConfig, initializeDocumentBlockIds } from '../../../src/components/embedded/document/document-identity';
import { $documentSuggestions, $suggestDocumentCharacterDeletion } from '../../../src/components/embedded/document/document-suggestion-commands';
const id = '11111111-1111-4111-8111-111111111111';
const closers: (() => void)[] = [];
afterEach(() => closers.splice(0).reverse().forEach(close => close()));
function fixture(body: string) {
  const html = documentHtml('Deletion', `<p data-od-id="body">${body}</p>`);
  expect(supportedDocument(html, 'review.html')).toBe(true);
  const editor = createEditor({ nodes: documentNodes, html: documentHtmlConfig(), onError: error => { throw error; } });
  const history = createEmptyHistoryState();
  closers.push(registerHistory(editor, history, 300));
  editor.update(() => {
    $getRoot().append(...$generateNodesFromDOM(editor, documentImport(html)));
    initializeDocumentBlockIds(new Map(), 'a'.repeat(64));
  }, { discrete: true, tag: HISTORY_PUSH_TAG });
  return { editor, history };
}
function paragraph(): ElementNode {
  const value = $getRoot().getFirstChildOrThrow();
  if (!$isElementNode(value)) throw Error('Expected actual paragraph');
  return value;
}
function selectionPoints() {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) throw Error('Expected range');
  return { anchor: { ...selection.anchor }, focus: { ...selection.focus }, format: selection.format, style: selection.style };
}
const barriers = [
  { name: 'BR', html: '<br>' },
  { name: 'image', html: '<img src="figure.png" alt="Barrier" width="1" height="1">' },
];
for (const barrier of barriers) for (const point of ['text', 'element'] as const) for (const backward of [true, false]) {
  it(`refuses ${backward ? 'backward' : 'forward'} ${point} deletion into ${barrier.name} without changing selection, source or history`, () => {
    const f = fixture(`A${barrier.html}B`);
    f.editor.update(() => {
      const owner = paragraph(), texts = owner.getAllTextNodes();
      if (point === 'text') texts[backward ? 1 : 0]!.select(backward ? 0 : 1, backward ? 0 : 1);
      else owner.select(backward ? 2 : 1, backward ? 2 : 1);
    }, { discrete: true });
    const before = f.editor.getEditorState().toJSON();
    const selected = f.editor.getEditorState().read(selectionPoints);
    const undo = [...f.history.undoStack], redo = [...f.history.redoStack];
    let failure: unknown;
    f.editor.update(() => {
      try { $suggestDocumentCharacterDeletion(backward, id); } catch (error) { failure = error; }
    }, { discrete: true, tag: HISTORY_PUSH_TAG });
    expect(failure).toBeInstanceOf(Error);
    expect(f.editor.getEditorState().toJSON()).toEqual(before);
    expect(f.editor.getEditorState().read(selectionPoints)).toEqual(selected);
    expect(f.editor.getEditorState().read($documentSuggestions)).toHaveLength(0);
    expect(f.history.undoStack).toEqual(undo); expect(f.history.redoStack).toEqual(redo);
  });
  it(`keeps valid ${backward ? 'backward' : 'forward'} ${point} deletion on the text side of ${barrier.name}`, async () => {
    const f = fixture(`A${barrier.html}B`);
    f.editor.update(() => {
      const owner = paragraph(), texts = owner.getAllTextNodes();
      if (point === 'text') texts[backward ? 1 : 0]!.select(backward ? 1 : 0, backward ? 1 : 0);
      else owner.select(backward ? 3 : 0, backward ? 3 : 0);
    }, { discrete: true });
    const before = f.editor.getEditorState().toJSON();
    f.editor.update(() => $suggestDocumentCharacterDeletion(backward, id), { discrete: true, tag: HISTORY_PUSH_TAG });
    f.editor.getEditorState().read(() => {
      expect($documentSuggestions()).toHaveLength(1);
      expect($documentSuggestions()[0]!.getTextContent()).toBe(backward ? 'B' : 'A');
    });
    f.editor.dispatchCommand(UNDO_COMMAND, undefined); await new Promise(resolve => setTimeout(resolve, 0));
    expect(f.editor.getEditorState().toJSON()).toEqual(before);
    f.editor.dispatchCommand(REDO_COMMAND, undefined); await new Promise(resolve => setTimeout(resolve, 0));
    expect(f.editor.getEditorState().read(() => $documentSuggestions()[0]!.getTextContent())).toBe(backward ? 'B' : 'A');
  });
}
for (const point of ['text', 'element'] as const) for (const backward of [true, false]) {
  it(`preserves a whole formatted/link grapheme for ${backward ? 'backward' : 'forward'} ${point} deletion`, () => {
    const f = fixture('<strong>👩</strong><a href="https://fixture.test/"><em>🏽‍💻</em></a>X');
    f.editor.update(() => {
      const owner = paragraph(), texts = owner.getAllTextNodes();
      if (point === 'text') texts[backward ? 1 : 0]!.select(backward ? texts[1]!.getTextContentSize() : 0, backward ? texts[1]!.getTextContentSize() : 0);
      else if (backward) {
        const link = owner.getChildren()[1]; if (!$isElementNode(link)) throw Error('Expected link'); link.select(link.getChildrenSize(), link.getChildrenSize());
      } else owner.select(0, 0);
      $suggestDocumentCharacterDeletion(backward, id);
      const deleted = $documentSuggestions()[0]!;
      expect(deleted.getTextContent()).toBe('👩🏽‍💻');
      expect(deleted.getAllTextNodes()[0]!.hasFormat('bold')).toBe(true);
      expect(deleted.getAllTextNodes()[1]!.hasFormat('italic')).toBe(true);
      expect(deleted.getChildren().find($isLinkNode)?.getURL()).toBe('https://fixture.test/');
      expect(paragraph().getTextContent()).toBe('👩🏽‍💻X');
    }, { discrete: true, tag: HISTORY_PUSH_TAG });
  });
}
