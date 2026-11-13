import { $getState, type LexicalEditor } from 'lexical';
import { $isHeadingNode } from '@lexical/rich-text';
import { documentBlockId, documentBlockNodes } from './document-identity';

export type DocumentSection = { id: string; level: number; title: string };
/** Read the editor's existing identities; navigation never manufactures IDs. */
export function readDocumentSections(): DocumentSection[] {
  return documentBlockNodes().flatMap(node => {
    if (!$isHeadingNode(node)) return [];
    const id = $getState(node, documentBlockId);
    return id ? [{ id, level: Number(node.getTag().slice(1)), title: node.getTextContent().trim() || 'Untitled section' }] : [];
  });
}

/** Resolve again at activation time: a stale menu cannot jump to a deleted,
 * replaced or duplicate-named heading. No Lexical update or source save occurs. */
export function focusDocumentSection(editor: LexicalEditor, id: string): (() => void) | null {
  const element = editor.getEditorState().read(() => {
    const heading = documentBlockNodes().find(node => $isHeadingNode(node) && $getState(node, documentBlockId) === id);
    return heading ? editor.getElementByKey(heading.getKey()) : null;
  });
  if (!element?.isConnected || !editor.getRootElement()?.contains(element)) return null;
  const before = element.getAttribute('tabindex');
  element.tabIndex = -1;
  const restore = () => {
    element.removeEventListener('blur', restore);
    if (before === null) element.removeAttribute('tabindex'); else element.setAttribute('tabindex', before);
  };
  element.addEventListener('blur', restore, { once: true });
  element.scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'auto' });
  element.focus({ preventScroll: true });
  return restore;
}
