// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { $createParagraphNode, $createTextNode, $createRangeSelection, $setSelection, $isTextNode, $getRoot, $getNodeByKey, createEditor, KEY_ENTER_COMMAND, UNDO_COMMAND, REDO_COMMAND } from 'lexical';
import { createEmptyHistoryState, registerHistory } from '@lexical/history';
import { attachDocumentSuggestionInput } from '../../../src/components/embedded/document/document-suggestion-input';
import { documentNodes } from '../../../src/components/embedded/document/DocumentEditor';
import { createDocumentDateController, type DateCalendarOwner } from '../../../src/components/embedded/document/document-date-controller';
import { $isDocumentDateNode } from '../../../src/components/embedded/document/DocumentDateNode';
import { $documentSuggestions, $resolveDocumentSuggestion } from '../../../src/components/embedded/document/document-suggestion-commands';
import type { DocumentMode } from '../../../src/components/embedded/document/document-suggestion-input';
const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).reverse().forEach(fn => fn()); document.body.replaceChildren(); });
function fixture(initialMode: DocumentMode = 'editing') {
  const root = document.createElement('div'); root.contentEditable = 'true'; document.body.append(root);
  const editor = createEditor({ nodes: documentNodes, onError: error => { throw error; } }); editor.setRootElement(root);
  const history = createEmptyHistoryState(); cleanups.push(registerHistory(editor, history, 1000));
  editor.update(() => { $getRoot().append($createParagraphNode().append($createTextNode('Before '))); }, { discrete: true });
  let mode = initialMode, open: DateCalendarOwner | null = null, blocked = 0;
  cleanups.push(attachDocumentSuggestionInput(editor, () => mode, () => {}));
  const controller = createDocumentDateController(editor, { mode: () => mode, locale: () => 'en-US', publish: value => { open = value; }, blocked: () => { blocked++; } });
  cleanups.push(() => controller.dispose(), () => editor.setRootElement(null));
  const flush = () => editor.read(() => {});
  const text = () => editor.read(() => $getRoot().getTextContent());
  return { editor, controller, flush, text, get open() { return open; }, get blocked() { return blocked; }, setMode(next: DocumentMode) { mode = next; controller.modeChanged(); } };
}
it('inserts without DOM focus, changes the same atom and preserves separate native Undo/Redo transactions', async () => {
  const f = fixture(); f.controller.insert(); f.flush(); const first = f.open!;
  expect(first).not.toBeNull(); expect(f.text()).toContain(first.value.label);
  f.controller.choose(first, '2024-02-29'); f.flush();
  expect(f.editor.read(() => { const node = $getNodeByKey(first.key); return $isDocumentDateNode(node) && node.getDate().iso; })).toBe('2024-02-29');
  f.editor.dispatchCommand(UNDO_COMMAND, undefined); f.flush();
  expect(f.editor.read(() => { const node = $getNodeByKey(first.key); return $isDocumentDateNode(node) && node.getDate().iso; })).toBe(first.value.iso);
  f.editor.dispatchCommand(REDO_COMMAND, undefined); f.flush(); expect(f.text()).toContain('Feb 29, 2024');
});
it('keeps one Add proposal across day changes, with first Reject undo restoring the date atom', () => {
  const f = fixture('suggesting'); f.controller.insert(); f.flush(); const first = f.open!;
  expect(first).not.toBeNull(); const id = f.editor.read(() => $documentSuggestions()[0]!.suggestion().id);
  f.controller.choose(first, '2024-02-29'); f.flush();
  expect(f.editor.read(() => $documentSuggestions().map(node => node.suggestion().id))).toEqual([id]);
  f.editor.read(() => {}); f.editor.update(() => $resolveDocumentSuggestion(id, false), { discrete: true, tag: 'history-push' });
  expect(f.text()).toBe('Before ');
  f.editor.dispatchCommand(UNDO_COMMAND, undefined); f.flush(); expect(f.text()).toContain('Feb 29, 2024');
  f.editor.dispatchCommand(REDO_COMMAND, undefined); f.flush(); expect(f.text()).toBe('Before ');
});
it('rejects stale callbacks after outside dismissal, mode withdrawal, deletion and disposal', () => {
  const f = fixture(); f.controller.insert(); f.flush(); const owner = f.open!; const before = f.text();
  f.controller.dismiss(owner); f.controller.choose(owner, '2024-02-29'); expect(f.text()).toBe(before);
  f.controller.open(owner.key, f.editor.getElementByKey(owner.key)!); const second = f.open!;
  f.setMode('viewing'); f.controller.choose(second, '2024-02-29'); expect(f.text()).toBe(before);
  f.setMode('editing'); f.controller.open(owner.key, f.editor.getElementByKey(owner.key)!); const third = f.open!;
  f.editor.update(() => $getNodeByKey(owner.key)?.remove(), { discrete: true }); f.controller.choose(third, '2024-02-29'); expect(f.text()).toBe('Before ');
  f.controller.dispose(); f.controller.insert(); expect(f.text()).toBe('Before ');
});
it('refuses cross-paragraph insertion before removing any selected source', () => {
  const f = fixture();
  f.editor.update(() => { const a = $createTextNode('First selected paragraph'), b = $createTextNode('Keep this paragraph'); $getRoot().clear().append($createParagraphNode().append(a), $createParagraphNode().append(b)); const selection = $createRangeSelection(); selection.setTextNodeRange(a, 2, b, 4); $setSelection(selection); }, { discrete: true });
  const before = f.editor.getEditorState().toJSON(); f.controller.insert(); f.flush();
  expect(f.editor.getEditorState().toJSON()).toEqual(before); expect(f.blocked).toBe(1); expect(f.open).toBeNull();
});
it.each([true, false])('uses first native review history for a Date Add, accept=%s', accept => {
  const f = fixture('suggesting'); f.controller.insert(); const owner = f.open!; f.controller.choose(owner, '2024-02-29'); f.flush();
  const id = f.editor.read(() => $documentSuggestions()[0]!.suggestion().id);
  f.editor.read(() => {}); f.editor.update(() => $resolveDocumentSuggestion(id, accept), { discrete: true, tag: 'history-push' });
  expect(f.editor.read(() => $documentSuggestions())).toHaveLength(0);
  expect(f.text().includes('Feb 29, 2024')).toBe(accept);
  f.editor.dispatchCommand(UNDO_COMMAND, undefined); f.flush();
  expect(f.editor.read(() => $documentSuggestions())).toHaveLength(1); expect(f.text()).toContain('Feb 29, 2024');
  f.editor.dispatchCommand(REDO_COMMAND, undefined); f.flush(); expect(f.editor.read(() => $documentSuggestions())).toHaveLength(0);
});
it('retains the old Date atom in a Replace and rejects to the exact original label and ISO', () => {
  const f = fixture(); f.controller.insert(); const original = f.open!; f.controller.dismiss(original); f.setMode('suggesting');
  f.controller.open(original.key, f.editor.getElementByKey(original.key)!); f.controller.choose(f.open!, '2024-02-29'); f.flush();
  const entries = f.editor.read(() => $documentSuggestions().map(node => ({ ...node.suggestion(), text: node.getTextContent() })));
  expect(entries).toHaveLength(2); expect(entries[0]).toMatchObject({ kind: 'delete', operation: 'replace', text: original.value.label });
  expect(entries[1]).toMatchObject({ kind: 'insert', operation: 'replace', id: entries[0]!.id, text: 'Feb 29, 2024' });
  const deletionKey = f.editor.read(() => $documentSuggestions()[0]!.getFirstChildOrThrow().getKey());
  f.controller.open(deletionKey, f.editor.getElementByKey(deletionKey)!); expect(f.blocked).toBe(1); expect(f.open).toBeNull();
  f.editor.read(() => {}); f.editor.update(() => $resolveDocumentSuggestion(entries[0]!.id, false), { discrete: true, tag: 'history-push' }); f.flush();
  expect(f.text()).toContain(original.value.label); expect(f.text()).not.toContain('Feb 29, 2024');
  f.editor.dispatchCommand(UNDO_COMMAND, undefined); f.flush(); expect(f.editor.read(() => $documentSuggestions())).toHaveLength(2);
});
it('a later calendar owns its own generation and never lets a retired calendar change or refocus it', async () => {
  const f = fixture(); f.controller.insert(); const first = f.open!; f.controller.dismiss(first);
  f.editor.update(() => $getRoot().getLastChildOrThrow().selectEnd(), { discrete: true });
  f.controller.insert(); const next = f.open!; expect(next.key).not.toBe(first.key);
  const before = f.text(); f.controller.choose(first, '2024-02-29'); expect(f.text()).toBe(before); expect(f.open).toBe(next);
  const input = document.createElement('input'); document.body.append(input); input.focus(); f.controller.dismiss(next);
  await Promise.resolve(); expect(document.activeElement).toBe(input);
});
it('returns the exact retained text when a Date Replace of selected text is rejected', () => {
  const f = fixture('suggesting');
  f.editor.update(() => { const text = $getRoot().getFirstDescendant(); if ($isTextNode(text)) text.select(0, 6); }, { discrete: true });
  f.controller.insert(); const owner = f.open!; expect(owner).not.toBeNull();
  const suggestions = f.editor.read(() => $documentSuggestions().map(node => ({ ...node.suggestion(), text: node.getTextContent() })));
  expect(suggestions).toHaveLength(2); expect(suggestions[0]).toMatchObject({ kind: 'delete', operation: 'replace', text: 'Before' });
  f.editor.read(() => {}); f.editor.update(() => $resolveDocumentSuggestion(suggestions[0]!.id, false), { discrete: true, tag: 'history-push' });
  expect(f.text()).toBe('Before ');
});
it('revalidates the private pending Date owner after native day-change Undo before editing it again', () => {
  const f = fixture('suggesting'); f.controller.insert(); const initial = f.open!;
  f.controller.choose(initial, '2024-02-29'); f.flush();
  const id = f.editor.read(() => $documentSuggestions()[0]!.suggestion().id);
  f.editor.dispatchCommand(UNDO_COMMAND, undefined); f.flush();
  f.controller.open(initial.key, f.editor.getElementByKey(initial.key)!); const reopened = f.open!;
  expect(reopened.value.iso).toBe(initial.value.iso);
  f.controller.choose(reopened, '2024-03-01'); f.flush();
  expect(f.text()).toContain('Mar 1, 2024');
  expect(f.editor.read(() => $documentSuggestions().map(node => node.suggestion().id))).toEqual([id]);
});
it('withdraws an open calendar when the actual editor root is replaced, while the old root container stays connected', () => {
  const f = fixture(); f.controller.insert(); const old = f.open!, before = f.text(), oldRoot = f.editor.getRootElement()!;
  const replacement = document.createElement('div'); document.body.append(replacement); f.editor.setRootElement(replacement);
  // Pinned Lexical removes the old children but leaves this external container.
  expect(oldRoot.isConnected).toBe(true); expect(old.target.isConnected).toBe(false); expect(f.open).toBeNull();
  f.controller.choose(old, '2024-02-29'); expect(f.text()).toBe(before);
});
it('opens the selected atomic Date through the actual Lexical Enter command without inserting a paragraph', async () => {
  const f = fixture(); f.controller.insert(); const owner = f.open!; f.controller.dismiss(owner);
  const before = f.editor.getEditorState().toJSON();
  f.editor.dispatchCommand(KEY_ENTER_COMMAND, new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
  await Promise.resolve(); f.flush();
  expect(f.open?.key).toBe(owner.key); expect(f.editor.getEditorState().toJSON()).toEqual(before);
});
