import { $getNodeByKey, $getNearestNodeFromDOMNode, HISTORY_PUSH_TAG, KEY_ENTER_COMMAND, UNDO_COMMAND, REDO_COMMAND, COMMAND_PRIORITY_HIGH, type LexicalEditor, type NodeKey } from 'lexical';
import type { DocumentDate } from '@open-design/contracts/runtime/document';
import { $isDocumentDateNode } from './DocumentDateNode';
import { $canChangeDate, $changeDocumentDate, $insertDocumentDate, $selectDocumentDate, $selectedDocumentDate, localDocumentDate } from './document-date-commands';
import type { DocumentMode } from './document-suggestion-input';
import { captureDocumentControlFocus, restoreDocumentControlFocus, type DocumentControlFocus } from './document-control-focus';
export type DateCalendarOwner = Readonly<{ key: NodeKey; generation: number; mode: DocumentMode; value: DocumentDate; target: HTMLElement }>;
/** Private editor lifetime and proposal ownership; source attributes never grant edit authority. */
export function createDocumentDateController(editor: LexicalEditor, options: {
  mode(): DocumentMode; locale(): string; publish(owner: DateCalendarOwner | null): void; blocked(): void;
}) {
  let active = true, generation = 0, current: DateCalendarOwner | null = null;
  let historyFocus: DocumentControlFocus = null;
  const owned = new Map<NodeKey, string>();
  const dismiss = (owner: DateCalendarOwner, focus = false) => {
    if (!active || current !== owner) return;
    const focused = owner.target.ownerDocument.activeElement;
    const focusOwned = owner.target.contains(focused) || focused?.closest('[data-document-date-calendar]')?.getAttribute('data-document-date-calendar') === String(owner.generation);
    current = null; const closed = ++generation; options.publish(null);
    if (focus) queueMicrotask(() => {
      if (!active || current || generation !== closed || options.mode() !== owner.mode) return;
      const target = editor.getElementByKey(owner.key), document = owner.target.ownerDocument;
      if (!focusOwned || !owner.target.isConnected || !editor.getRootElement()?.contains(owner.target) || !target?.contains(owner.target)
        || document.activeElement !== focused && document.activeElement !== document.body && !target.contains(document.activeElement)) return;
      if (target.isConnected) target.querySelector<HTMLButtonElement>('button')?.focus();
    });
  };
  const open = (key: NodeKey, target: HTMLElement) => {
    if (!active || !editor.isEditable() || options.mode() === 'viewing') return;
    let accepted = false;
    editor.read(() => {
      const node = $getNodeByKey(key);
      if (!$isDocumentDateNode(node) || !$canChangeDate(node, owned) || !target.isConnected || !editor.getElementByKey(key)?.contains(target)) { options.blocked(); return; }
      accepted = true;
      current = Object.freeze({ key, target, mode: options.mode(), value: Object.freeze(node.getDate()), generation: ++generation });
    });
    if (!accepted || !current || current.key !== key) return;
    editor.update(() => { const node = $getNodeByKey(key); if ($isDocumentDateNode(node)) $selectDocumentDate(node); }, { discrete: true });
    options.publish(current);
  };
  const insert = () => {
    if (!active || !editor.isEditable() || options.mode() === 'viewing') return;
    editor.read(() => {}); let key: NodeKey | null = null;
    try {
      editor.update(() => { key = $insertDocumentDate(localDocumentDate(options.locale()), options.mode(), owned).getKey(); }, { discrete: true, tag: HISTORY_PUSH_TAG });
      if (key) { const target = editor.getElementByKey(key); if (target) open(key, target); }
    } catch { options.blocked(); }
  };
  const choose = (owner: DateCalendarOwner, iso: string) => {
    if (!active || current !== owner || owner.generation !== generation || options.mode() !== owner.mode || !editor.isEditable()
      || !owner.target.isConnected || !editor.getRootElement()?.contains(owner.target) || !editor.getElementByKey(owner.key)?.contains(owner.target)) return;
    editor.read(() => {});
    let changed = false;
    editor.update(() => {
      const node = $getNodeByKey(owner.key);
      if (!$isDocumentDateNode(node) || !$canChangeDate(node, owned) || JSON.stringify(node.getDate()) !== JSON.stringify(owner.value)) return;
      const next = $changeDocumentDate(node, localDocumentDate(options.locale(), iso), owner.mode, owned);
      changed = true;
      // A replacement suggestion owns a new atom, so focus follows that exact new node.
      current = Object.freeze({ ...owner, key: next.getKey(), value: Object.freeze(next.getDate()) });
    }, { discrete: true, tag: HISTORY_PUSH_TAG });
    if (changed && current) {
      const target = editor.getElementByKey(current.key);
      if (target) current = Object.freeze({ ...current, target });
      dismiss(current, true);
    }
  };
  const enter = editor.registerCommand(KEY_ENTER_COMMAND, event => {
    const node = $selectedDocumentDate();
    if (!node) return false;
    event?.preventDefault(); const target = editor.getElementByKey(node.getKey());
    if (target) queueMicrotask(() => { if (active) open(node.getKey(), target); });
    return true;
  }, COMMAND_PRIORITY_HIGH);
  const history = [UNDO_COMMAND, REDO_COMMAND].map(command => editor.registerCommand(command, () => {
    const focused = editor.getRootElement()?.ownerDocument.activeElement;
    if (focused instanceof HTMLElement && $isDocumentDateNode($getNearestNodeFromDOMNode(focused))) {
      const owner = historyFocus = captureDocumentControlFocus(editor, focused);
      setTimeout(() => { if (historyFocus === owner) historyFocus = null; }, 0);
    }
    return false;
  }, COMMAND_PRIORITY_HIGH));
  const root = editor.registerRootListener((_root, previous) => { if (previous) { historyFocus = null; if (current) dismiss(current); } });
  const editable = editor.registerEditableListener(value => { if (!value) { historyFocus = null; if (current) dismiss(current); } });
  const stop = editor.registerUpdateListener(({ editorState }) => {
    const focus = historyFocus; historyFocus = null;
    if (focus) queueMicrotask(() => { if (active) restoreDocumentControlFocus(editor, focus); });
    if (!current) return;
    const owner = current;
    const valid = editorState.read(() => { const node = $getNodeByKey(owner.key); return $isDocumentDateNode(node) && $canChangeDate(node, owned) && JSON.stringify(node.getDate()) === JSON.stringify(owner.value); });
    if (!valid || options.mode() !== owner.mode || !editor.isEditable()) dismiss(owner);
  });
  return { open, insert, choose, dismiss, modeChanged() { historyFocus = null; if (current) dismiss(current); }, dispose() { active = false; current = null; historyFocus = null; generation++; owned.clear(); root(); editable(); enter(); history.forEach(stop => stop()); stop(); options.publish(null); } };
}
