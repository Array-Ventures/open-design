import { suggestionAttributes } from './document-suggestion-schema';
import { assertDocumentSuggestionUpdate, DOCUMENT_SUGGESTION_UPDATE_TAG, DocumentSuggestionInputError } from './document-suggestion-policy';
import { RootNode, $hasUpdateTag, UNDO_COMMAND, REDO_COMMAND, $getSelection, $isRangeSelection, COMMAND_PRIORITY_CRITICAL, CONTROLLED_TEXT_INSERTION_COMMAND, CUT_COMMAND, PASTE_COMMAND, DROP_COMMAND, INSERT_TAB_COMMAND, INDENT_CONTENT_COMMAND, OUTDENT_CONTENT_COMMAND, DELETE_CHARACTER_COMMAND, DELETE_LINE_COMMAND, DELETE_WORD_COMMAND, FORMAT_ELEMENT_COMMAND, FORMAT_TEXT_COMMAND, INSERT_LINE_BREAK_COMMAND, INSERT_PARAGRAPH_COMMAND, type LexicalEditor, type LexicalNode } from 'lexical';
import { $isDocumentSuggestionNode } from './DocumentSuggestionNode';
import { $documentSuggestions, $eraseCurrentDocumentInsertion, $suggestDocumentCharacterDeletion, $suggestDocumentDeletion, $suggestDocumentText } from './document-suggestion-commands';
function markedClipboard(html: string): boolean {
  return Boolean(new DOMParser().parseFromString(html, 'text/html').querySelector(suggestionAttributes.map(name => `[${name}]`).join(',')));
}
export type SuggestionNotice = 'unsupported' | 'structure' | 'reviewFirst' | 'clipboard' | 'plainPaste' | 'composition' | 'blocked' | 'stale';
export type DocumentMode = 'editing' | 'suggesting' | 'viewing';
function inside(node: LexicalNode): boolean { return $isDocumentSuggestionNode(node) || Boolean(node.getParent() && inside(node.getParent()!)); }
function touchesSuggestion(): boolean {
  const selection = $getSelection();
  return !$isRangeSelection(selection) || selection.getNodes().some(inside);
}
/** Own only this editor's input. Unsupported suggesting operations stop before native mutation. */
export function attachDocumentSuggestionInput(editor: LexicalEditor, mode: () => DocumentMode, notice: (message: SuggestionNotice | null) => void) {
  let active = true, compositionBlocked = false, lastInsertion: string | undefined;
  const run = (action: () => void) => {
    if (!active || !editor.isEditable() || mode() === 'viewing') return;
    try { action(); notice(null); } catch {
      notice('unsupported');
      if ($hasUpdateTag(DOCUMENT_SUGGESTION_UPDATE_TAG)) throw new DocumentSuggestionInputError('The incomplete suggestion was rolled back.');
    }
  };
  const insert = (text: string) => { lastInsertion = $suggestDocumentText(text, crypto.randomUUID(), lastInsertion); };
  const erase = (backward: boolean) => {
    if ($eraseCurrentDocumentInsertion(lastInsertion, backward)) return;
    lastInsertion = undefined; $suggestDocumentCharacterDeletion(backward, crypto.randomUUID());
  };
  const command = (action: () => void) => {
    if (mode() !== 'suggesting') {
      if ($documentSuggestions().length && touchesSuggestion()) { notice('reviewFirst'); return true; }
      return false;
    }
    run(action); return true;
  };
  const protectedBlock = () => {
    const selection = $getSelection();
    return !$isRangeSelection(selection) || $documentSuggestions().some(node => node.getTopLevelElement() === selection.anchor.getNode().getTopLevelElement());
  };
  const unsupported = () => {
    if (mode() !== 'suggesting' && !$documentSuggestions().length) return false;
    notice('structure'); return true;
  };
  const stops = [
    editor.registerNodeTransform(RootNode, () => {
      try { assertDocumentSuggestionUpdate(editor, mode()); }
      catch (error) { if (error instanceof DocumentSuggestionInputError) notice('blocked'); throw error; }
    }),
    editor.registerCommand(UNDO_COMMAND, () => mode() === 'viewing', COMMAND_PRIORITY_CRITICAL),
    editor.registerCommand(REDO_COMMAND, () => mode() === 'viewing', COMMAND_PRIORITY_CRITICAL),
    editor.registerCommand(CONTROLLED_TEXT_INSERTION_COMMAND, value => command(() => insert(typeof value === 'string' ? value : value.data ?? '')), COMMAND_PRIORITY_CRITICAL),
    editor.registerCommand(DELETE_CHARACTER_COMMAND, backward => {
      if (mode() === 'editing' && $documentSuggestions().length > 0 && protectedBlock()) { notice('reviewFirst'); return true; }
      return command(() => erase(backward));
    }, COMMAND_PRIORITY_CRITICAL),
    editor.registerCommand(CUT_COMMAND, event => {
      if (mode() !== 'suggesting') {
        if (!$documentSuggestions().length || !touchesSuggestion()) return false;
        event?.preventDefault(); notice('reviewFirst'); return true;
      }
      event?.preventDefault();
      const selection = $getSelection();
      if (event && 'clipboardData' in event) event.clipboardData?.setData('text/plain', selection?.getTextContent() ?? '');
      return command(() => { lastInsertion = undefined; $suggestDocumentDeletion(crypto.randomUUID()); });
    }, COMMAND_PRIORITY_CRITICAL),
    editor.registerCommand(PASTE_COMMAND, event => {
      const clipboard = 'clipboardData' in event ? event.clipboardData : null;
      if (markedClipboard(clipboard?.getData('text/html') ?? '') || mode() === 'editing' && $documentSuggestions().length && touchesSuggestion()) {
        event.preventDefault(); notice('reviewFirst'); return true;
      }
      if (mode() !== 'suggesting') return false;
      event.preventDefault();
      if (clipboard?.getData('text/html')) { notice('plainPaste'); return true; }
      return command(() => insert(clipboard?.getData('text/plain') ?? ''));
    }, COMMAND_PRIORITY_CRITICAL),
    editor.registerCommand(DROP_COMMAND, unsupported, COMMAND_PRIORITY_CRITICAL),
    editor.registerCommand(INSERT_TAB_COMMAND, unsupported, COMMAND_PRIORITY_CRITICAL),
    editor.registerCommand(INDENT_CONTENT_COMMAND, unsupported, COMMAND_PRIORITY_CRITICAL),
    editor.registerCommand(OUTDENT_CONTENT_COMMAND, unsupported, COMMAND_PRIORITY_CRITICAL),
    editor.registerCommand(DELETE_WORD_COMMAND, unsupported, COMMAND_PRIORITY_CRITICAL),
    editor.registerCommand(DELETE_LINE_COMMAND, unsupported, COMMAND_PRIORITY_CRITICAL),
    editor.registerCommand(INSERT_LINE_BREAK_COMMAND, unsupported, COMMAND_PRIORITY_CRITICAL),
    editor.registerCommand(INSERT_PARAGRAPH_COMMAND, unsupported, COMMAND_PRIORITY_CRITICAL),
    editor.registerCommand(FORMAT_TEXT_COMMAND, unsupported, COMMAND_PRIORITY_CRITICAL),
    editor.registerCommand(FORMAT_ELEMENT_COMMAND, unsupported, COMMAND_PRIORITY_CRITICAL),
  ];
  const prevent = (event: Event) => { event.preventDefault(); event.stopImmediatePropagation(); };
  const before = (event: InputEvent) => {
    if (mode() === 'viewing' || event.inputType === 'historyUndo' || event.inputType === 'historyRedo') return;
    if (mode() === 'editing') {
      if (!editor.getEditorState().read(() => $documentSuggestions().length)) return;
      const blocked = editor.getEditorState().read(() => touchesSuggestion()
        || event.inputType.startsWith('delete') && protectedBlock()
        || $documentSuggestions().length > 0 && !['insertText', 'deleteContentBackward', 'deleteContentForward'].includes(event.inputType));
      if (blocked) { prevent(event); notice('reviewFirst'); }
      return;
    }
    prevent(event);
    if (compositionBlocked) return;
    editor.update(() => run(() => {
      if (event.inputType === 'insertText') insert(event.data ?? '');
      else if (event.inputType === 'deleteContentBackward' || event.inputType === 'deleteContentForward') erase(event.inputType === 'deleteContentBackward');
      else if (event.inputType === 'deleteByCut') $suggestDocumentDeletion(crypto.randomUUID());
      else throw Error('Suggestions currently support text typing, selection deletion and plain-text paste inside one paragraph.');
    }));
  };
  const paste = (event: ClipboardEvent) => {
    if (mode() === 'suggesting') {
      prevent(event);
      if (event.clipboardData?.getData('text/html')) { notice('plainPaste'); return; }
      const text = event.clipboardData?.getData('text/plain') ?? '';
      editor.update(() => run(() => insert(text)));
    } else if (markedClipboard(event.clipboardData?.getData('text/html') ?? '')) {
      prevent(event); notice('clipboard');
    }
  };
  const drop = (event: DragEvent) => { if (mode() === 'suggesting' || editor.getEditorState().read(() => $documentSuggestions().length > 0)) { prevent(event); notice('structure'); } };
  const compositionStart = (event: CompositionEvent) => {
    if (mode() !== 'suggesting') return;
    prevent(event); compositionBlocked = true; editor.setEditable(false);
    notice('composition');
  };
  const compositionEnd = () => { if (compositionBlocked) { compositionBlocked = false; if (active && mode() !== 'viewing') editor.setEditable(true); } };
  const bind = (root: HTMLElement, add: boolean) => {
    const method = add ? 'addEventListener' : 'removeEventListener';
    root[method]('beforeinput', before as EventListener, true); root[method]('paste', paste as EventListener, true);
    root[method]('drop', drop as EventListener, true); root[method]('compositionstart', compositionStart as EventListener, true); root[method]('compositionend', compositionEnd, true); root[method]('blur', compositionEnd, true);
  };
  const rootStop = editor.registerRootListener((root, previous) => {
    if (previous) { bind(previous, false); compositionEnd(); lastInsertion = undefined; }
    if (root) bind(root, true);
  });
  return () => { if (compositionBlocked && mode() !== 'viewing') editor.setEditable(true); active = false; rootStop(); stops.forEach(stop => stop()); };
}
