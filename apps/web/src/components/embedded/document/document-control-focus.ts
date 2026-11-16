import type { LexicalEditor } from 'lexical';

export function captureDocumentControlFocus(editor: LexicalEditor, control: HTMLElement) {
  const root = editor.getRootElement(), focused = control.ownerDocument.activeElement;
  return root && focused instanceof HTMLElement && control.contains(focused) ? { root, focused } : null;
}
export type DocumentControlFocus = ReturnType<typeof captureDocumentControlFocus>;

/** A removed control may return focus, but never take it from another input or editor. */
export function restoreDocumentControlFocus(editor: LexicalEditor, owner: DocumentControlFocus): void {
  if (!owner) return;
  const { root, focused } = owner, document = root.ownerDocument;
  if (editor.getRootElement() === root && root.isConnected && editor.isEditable()
    && !focused.isConnected && document.activeElement === document.body && document.hasFocus()) root.focus({ preventScroll: true });
}
