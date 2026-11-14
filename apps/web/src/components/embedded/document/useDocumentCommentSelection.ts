import { useEffect, useRef } from 'react';
import { $createRangeSelectionFromDom, createCommand, type LexicalEditor } from 'lexical';
import { captureDocumentComment, resolveDocumentComment, type DocumentCommentAnchor } from './document-comment-anchor';

export const COMMENT_DOCUMENT_SELECTION = createCommand<void>('COMMENT_DOCUMENT_SELECTION');

/** Only completed editor gestures own a retained range. Host-header focus may
 * blur the iframe; saved-thread model selections must never become new quotes. */
export function useDocumentCommentSelection(editor: LexicalEditor, selectionKey: string) {
  const completed = useRef<DocumentCommentAnchor | null>(null);
  const readDOM = () => editor.getEditorState().read(() => {
    const root = editor.getRootElement(), dom = window.getSelection();
    if (!root || !dom?.anchorNode || !dom.focusNode || dom.isCollapsed || !root.contains(dom.anchorNode) || !root.contains(dom.focusNode)) return null;
    const range = $createRangeSelectionFromDom(dom, editor);
    return range && captureDocumentComment(range);
  }, { editor });
  useEffect(() => {
    const starts = (event: PointerEvent) => { if (event.button === 0 && editor.getRootElement()?.contains(event.target as Node)) completed.current = null; };
    const finish = (event: Event) => { if (editor.getRootElement()?.contains(event.target as Node)) completed.current = readDOM(); };
    const pointer = (event: PointerEvent) => { if (event.button === 0) finish(event); };
    const keyStarts = (event: KeyboardEvent) => { if ((event.key === 'Shift' || event.shiftKey) && editor.getRootElement()?.contains(event.target as Node)) completed.current = null; };
    const keyboard = (event: KeyboardEvent) => { if (event.key === 'Shift' || !event.shiftKey && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') finish(event); };
    const changed = () => {
      const dom = window.getSelection(), root = editor.getRootElement();
      // An actual collapsed/cross-root selection invalidates prior eligibility.
      // An outside selection caused by clicking the host header does not.
      if (root && dom && (root.contains(dom.anchorNode) || root.contains(dom.focusNode)) && (dom.isCollapsed || !root.contains(dom.anchorNode) || !root.contains(dom.focusNode))) completed.current = null;
    };
    document.addEventListener('pointerdown', starts, true);
    document.addEventListener('pointerup', pointer, true);
    document.addEventListener('keydown', keyStarts, true);
    document.addEventListener('keyup', keyboard, true);
    document.addEventListener('selectionchange', changed);
    return () => {
      completed.current = null;
      document.removeEventListener('pointerdown', starts, true);
      document.removeEventListener('pointerup', pointer, true);
      document.removeEventListener('keydown', keyStarts, true);
      document.removeEventListener('keyup', keyboard, true);
      document.removeEventListener('selectionchange', changed);
    };
  }, [editor, selectionKey]);
  return {
    clear: () => { completed.current = null; },
    take: () => {
      const candidate = completed.current;
      completed.current = null;
      return candidate && editor.getEditorState().read(() => resolveDocumentComment(candidate) ? candidate : null);
    },
  };
}
