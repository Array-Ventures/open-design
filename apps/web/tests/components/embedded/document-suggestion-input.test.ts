// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createEditor, $getRoot, $createParagraphNode, $createTextNode, CONTROLLED_TEXT_INSERTION_COMMAND, INSERT_PARAGRAPH_COMMAND, $isElementNode, $isTextNode, UNDO_COMMAND, REDO_COMMAND, HISTORY_PUSH_TAG } from 'lexical';
import { registerRichText } from '@lexical/rich-text';
import { registerHistory, createEmptyHistoryState } from '@lexical/history';
import { documentNodes } from '../../../src/components/embedded/document/DocumentEditor';
import { attachDocumentSuggestionInput, type DocumentMode } from '../../../src/components/embedded/document/document-suggestion-input';
import { $documentSuggestions, $resolveDocumentSuggestion } from '../../../src/components/embedded/document/document-suggestion-commands';
const dispose: (() => void)[] = [];
afterEach(() => { dispose.splice(0).reverse().forEach(close => close()); vi.unstubAllGlobals(); });
function fixture(textMode: 'normal' | 'token' | 'segmented' = 'normal') {
  let mode: DocumentMode = 'suggesting';
  const notice = vi.fn();
  const editor = createEditor({ nodes: documentNodes, onError: error => { throw error; } });
  const root = document.createElement('div'); document.body.append(root); editor.setRootElement(root);
  dispose.push(() => { editor.setRootElement(null); root.remove(); });
  dispose.push(registerRichText(editor));
  dispose.push(registerHistory(editor, createEmptyHistoryState(), 300));
  editor.update(() => { const p = $createParagraphNode().append($createTextNode('Original 👩🏽‍💻').setMode(textMode)); $getRoot().append(p); p.selectEnd(); }, { discrete: true, tag: HISTORY_PUSH_TAG });
  dispose.push(attachDocumentSuggestionInput(editor, () => mode, notice));
  return { editor, root, notice, mode: (next: DocumentMode) => { mode = next; editor.setEditable(next !== 'viewing'); } };
}
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
it('owns actual Lexical typing commands, blocks structural input and keeps normal Editing direct', async () => {
  const f = fixture();
  f.editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, ' proposed'); await flush();
  f.editor.getEditorState().read(() => {
    expect($getRoot().getTextContent()).toBe('Original 👩🏽‍💻 proposed');
    expect($documentSuggestions()).toHaveLength(1);
  });
  const before = f.editor.getEditorState();
  f.editor.dispatchCommand(INSERT_PARAGRAPH_COMMAND, undefined); await flush();
  expect(f.editor.getEditorState().read(() => $getRoot().getChildrenSize())).toBe(1);
  expect(f.notice).toHaveBeenLastCalledWith('structure');
  f.editor.update(() => { $resolveDocumentSuggestion($documentSuggestions()[0]!.suggestion().id, false); $getRoot().getFirstChildOrThrow().selectEnd(); }, { discrete: true, tag: HISTORY_PUSH_TAG });
  f.mode('editing'); f.editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, ' direct'); await flush();
  expect(f.editor.getEditorState().read(() => $getRoot().getTextContent())).toBe('Original 👩🏽‍💻 direct');
  expect(before).not.toBe(f.editor.getEditorState());
});
it('uses native Undo and Redo for the complete proposal and review transaction', async () => {
  const f = fixture();
  f.editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, ' proposed'); await flush();
  f.editor.update(() => $resolveDocumentSuggestion($documentSuggestions()[0]!.suggestion().id, true), { discrete: true, tag: HISTORY_PUSH_TAG });
  expect(f.editor.getEditorState().read(() => $documentSuggestions().length)).toBe(0);
  f.editor.dispatchCommand(UNDO_COMMAND, undefined); await flush();
  expect(f.editor.getEditorState().read(() => $documentSuggestions().length)).toBe(1);
  f.editor.dispatchCommand(REDO_COMMAND, undefined); await flush();
  expect(f.editor.getEditorState().read(() => $documentSuggestions().length)).toBe(0);
});
it('blocks composition before native input and restores editability on blur without proposing guessed text', () => {
  const f = fixture();
  const start = new CompositionEvent('compositionstart', { bubbles: true, cancelable: true, data: '' });
  expect(f.root.dispatchEvent(start)).toBe(false); expect(f.editor.isEditable()).toBe(false);
  expect(f.editor.getEditorState().read(() => $getRoot().getTextContent())).toBe('Original 👩🏽‍💻');
  f.root.dispatchEvent(new FocusEvent('blur'));
  expect(f.editor.isEditable()).toBe(true);
  expect(f.notice).toHaveBeenLastCalledWith('composition');
});

import { DELETE_CHARACTER_COMMAND, $getSelection, $isRangeSelection } from 'lexical';
it('coalesces consecutive typed text into one proposal and retains a whole Unicode grapheme on deletion', async () => {
  const f = fixture();
  f.editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, 'a'); await flush();
  f.editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, 'b'); await flush();
  f.editor.getEditorState().read(() => { expect($documentSuggestions()).toHaveLength(1); const selection = $getSelection(); expect($documentSuggestions()[0]!.getTextContent(), JSON.stringify({ notices: f.notice.mock.calls, selection: $isRangeSelection(selection) ? { anchor: selection.anchor, type: selection.anchor.getNode().getType(), parent: selection.anchor.getNode().getParent()?.getType() } : null })).toBe('ab'); });
  f.editor.update(() => { $resolveDocumentSuggestion($documentSuggestions()[0]!.suggestion().id, false); $getRoot().getFirstChildOrThrow().selectEnd(); }, { discrete: true });
  f.editor.dispatchCommand(DELETE_CHARACTER_COMMAND, true); await flush();
  f.editor.getEditorState().read(() => { expect($documentSuggestions()[0]!.getTextContent()).toBe('👩🏽‍💻'); expect($getRoot().getTextContent()).toBe('Original 👩🏽‍💻'); });
});
it('refuses ordinary Editing deletion next to a pending proposal rather than removing it as an opaque inline node', async () => {
  const f = fixture();
  f.editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, ' proposed'); await flush();
  f.mode('editing'); f.editor.dispatchCommand(DELETE_CHARACTER_COMMAND, true); await flush();
  f.editor.getEditorState().read(() => { expect($documentSuggestions()).toHaveLength(1); expect($getRoot().getTextContent()).toBe('Original 👩🏽‍💻 proposed'); });
  expect(f.notice).toHaveBeenLastCalledWith('reviewFirst');
});
it('turns a cancelable native beforeinput into a proposal without also applying the native text mutation', async () => {
  const f = fixture();
  const input = new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: ' native' });
  expect(f.root.dispatchEvent(input)).toBe(false); await flush();
  f.editor.getEditorState().read(() => { expect($documentSuggestions()).toHaveLength(1); expect($getRoot().getTextContent()).toBe('Original 👩🏽‍💻 native'); });
});
it('keeps pending source branches non-editable in the live DOM without leaking that render-only attribute into source', async () => {
  const f = fixture();
  f.editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, ' protected'); await flush();
  expect(f.root.querySelector('ins')?.getAttribute('contenteditable')).toBe('false');
  f.editor.getEditorState().read(() => { expect($documentSuggestions()[0]!.exportDOM().element.hasAttribute('contenteditable')).toBe(false); });
});
it('lets Backspace revise the insertion just typed without proposing deletion of committed source', async () => {
  const f = fixture();
  f.editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, 'ab'); await flush();
  f.editor.dispatchCommand(DELETE_CHARACTER_COMMAND, true); await flush();
  f.editor.getEditorState().read(() => { expect($documentSuggestions()[0]!.getTextContent()).toBe('a'); expect($documentSuggestions()[0]!.suggestion().operation).toBe('insert'); });
  f.editor.dispatchCommand(DELETE_CHARACTER_COMMAND, true); await flush();
  f.editor.getEditorState().read(() => { expect($documentSuggestions()).toHaveLength(0); expect($getRoot().getTextContent()).toBe('Original 👩🏽‍💻'); });
});
it('keeps per-character replacement typing in one paired proposal and preserves deletion when its insertion is erased', async () => {
  const f = fixture();
  // Select only the committed word; subsequent browser commands arrive one character at a time.
  f.editor.update(() => { const p = $getRoot().getFirstChildOrThrow(); if (!$isElementNode(p)) throw Error('Expected paragraph'); const text = p.getFirstChildOrThrow(); if (!$isTextNode(text)) throw Error('Expected text'); text.select(0, 8); }, { discrete: true });
  const trace: unknown[] = [];
  for (const text of ['n', 'e', 'w']) { f.editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, text); await flush(); f.editor.getEditorState().read(() => { const selection = $getSelection(); trace.push({ proposals: $documentSuggestions().map(node => ({ ...node.suggestion(), text: node.getTextContent() })), selection: $isRangeSelection(selection) ? { anchor: selection.anchor, node: selection.anchor.getNode().getType(), previous: selection.anchor.getNode().getPreviousSibling()?.getType() } : null }); }); }
  f.editor.getEditorState().read(() => { expect($documentSuggestions(), JSON.stringify(trace)).toHaveLength(2); expect($documentSuggestions().map(node => node.getTextContent())).toEqual(['Original', 'new']); });
  for (let i = 0; i < 3; i++) { f.editor.dispatchCommand(DELETE_CHARACTER_COMMAND, true); await flush(); }
  f.editor.getEditorState().read(() => { expect($documentSuggestions()).toHaveLength(1); expect($documentSuggestions()[0]!.suggestion().operation).toBe('delete'); expect($documentSuggestions()[0]!.getTextContent()).toBe('Original'); });
  expect(f.root.querySelector('del')?.getAttribute('data-eve-suggestion-operation')).toBe('delete');
});

import { fireEvent } from '@testing-library/react';
it('preserves ordinary Editing paste containing the literal suggestion attribute name as text', async () => {
  // jsdom omits these browser constructors; the real SDK paste path reads them.
  vi.stubGlobal('DragEvent', class DragEvent extends MouseEvent {});
  vi.stubGlobal('ClipboardEvent', class ClipboardEvent extends Event {});
  const f = fixture(); f.mode('editing');
  fireEvent.paste(f.root, { clipboardData: { types: ['text/html', 'text/plain'], files: [], getData: (type: string) => type === 'text/html' ? '<span>data-eve-suggestion example</span>' : type === 'text/plain' ? 'data-eve-suggestion example' : '' } });
  await flush();
  expect(f.editor.getEditorState().read(() => $getRoot().getTextContent())).toBe('Original 👩🏽‍💻data-eve-suggestion example');
});

import { $createNodeSelection, $setSelection } from 'lexical';
import { $createDocumentImageNode } from '../../../src/components/embedded/document/DocumentImageNode';
it('leaves ordinary Editing image NodeSelection beforeinput alone when no suggestions exist', () => {
  const f = fixture(); f.mode('editing');
  f.editor.update(() => {
    const image = $createDocumentImageNode({ src: 'data:image/png;base64,aGVsbG8=', alt: 'Fixture' });
    const p = $getRoot().getFirstChildOrThrow(); if (!$isElementNode(p)) throw Error('Expected paragraph'); p.append(image);
    const selection = $createNodeSelection(); selection.add(image.getKey()); $setSelection(selection);
  }, { discrete: true });
  const event = new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'deleteContentBackward' });
  f.root.dispatchEvent(event);
  expect(f.notice).not.toHaveBeenCalled();
});
it.each(['token', 'segmented'] as const)('refuses %s TextNode replacement before touching its text or creating a proposal', async textMode => {
  const f = fixture(textMode);
  f.editor.update(() => {
    const p = $getRoot().getFirstChildOrThrow(); if (!$isElementNode(p)) throw Error('Expected paragraph');
    const text = p.getFirstChildOrThrow(); if (!$isTextNode(text)) throw Error('Expected text'); text.select(0, text.getTextContentSize());
  }, { discrete: true });
  f.editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, 'replacement'); await flush();
  f.editor.getEditorState().read(() => {
    expect($getRoot().getTextContent()).toBe('Original 👩🏽‍💻'); expect($documentSuggestions()).toHaveLength(0);
    const p = $getRoot().getFirstChildOrThrow(); if (!$isElementNode(p)) throw Error('Expected paragraph');
    const text = p.getFirstChildOrThrow(); if (!$isTextNode(text)) throw Error('Expected text'); expect(text.getMode()).toBe(textMode);
  });
  expect(f.notice).toHaveBeenLastCalledWith('unsupported');
});
