import { useEffect, useId } from 'react';
import type { LexicalEditor } from 'lexical';
import { createDOMRange } from '@lexical/selection';
import { resolveDocumentComment, type DocumentCommentAnchor } from './document-comment-anchor';

/** A view-only exact-range mark. It never restores Lexical/native selection. */
export function useDocumentCommentHighlight(editor: LexicalEditor, anchor: DocumentCommentAnchor | null, revision: number) {
  const name = 'document-comment-' + useId().replace(/[^a-zA-Z0-9_-]/g, '');
  useEffect(() => {
    if (!anchor || typeof CSS === 'undefined' || !CSS.highlights || typeof Highlight === 'undefined') return;
    const range = editor.getEditorState().read(() => {
      const selection = resolveDocumentComment(anchor);
      return selection && createDOMRange(editor, selection.anchor.getNode(), selection.anchor.offset, selection.focus.getNode(), selection.focus.offset);
    });
    if (!range) return;
    const highlight = new Highlight(range), style = document.createElement('style');
    style.textContent = `::highlight(${name}) { background-color: var(--color-tab-count-selected-background); }`;
    document.head.append(style);
    CSS.highlights.set(name, highlight);
    return () => { if (CSS.highlights.get(name) === highlight) CSS.highlights.delete(name); style.remove(); };
  }, [editor, anchor, revision, name]);
}
