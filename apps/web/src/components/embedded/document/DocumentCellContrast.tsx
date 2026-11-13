import { useEffect } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { TableCellNode } from '@lexical/table';
import { DOCUMENT_CELL_INK, documentCellInk, documentColorReader } from './document-cell-contrast';

/** View-only contrast: no editor updates, writer state or serialized annotations. */
export function DocumentCellContrast() {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    const keys = new Set<string>();
    const cells = new Map<string, HTMLElement>();
    const clear = () => { for (const cell of cells.values()) cell.style.removeProperty(DOCUMENT_CELL_INK); };
    const paint = () => {
      const root = editor.getRootElement();
      if (!root) return;
      // Withdraw every old fallback before reading any inherited color. Batch
      // style writes, measurements and final writes to avoid per-cell reflows.
      clear();
      for (const key of keys) {
        const cell = editor.getElementByKey(key);
        if (!cell || !root.contains(cell)) { cells.delete(key); continue; }
        cells.set(key, cell); cell.style.removeProperty(DOCUMENT_CELL_INK);
      }
      const read = documentColorReader(root.ownerDocument);
      const inks = Array.from(cells.values(), cell => [cell, documentCellInk(cell, read)] as const);
      for (const [cell, ink] of inks) if (ink) cell.style.setProperty(DOCUMENT_CELL_INK, ink);
    };
    const mutations = editor.registerMutationListener(TableCellNode, nodes => {
      for (const [key, mutation] of nodes) {
        cells.get(key)?.style.removeProperty(DOCUMENT_CELL_INK);
        if (mutation === 'destroyed') { keys.delete(key); cells.delete(key); }
        else keys.add(key);
      }
      paint();
    }, { skipInitialization: false });
    let observer: MutationObserver | undefined;
    let media: MediaQueryList | undefined;
    const roots = editor.registerRootListener(root => {
      observer?.disconnect(); media?.removeEventListener('change', paint);
      if (!root) { clear(); return; }
      const document = root.ownerDocument;
      observer = new MutationObserver(paint);
      // Theme ownership lives on the document, not on the contenteditable root.
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] });
      media = document.defaultView?.matchMedia?.('(prefers-color-scheme: dark)');
      media?.addEventListener('change', paint); paint();
    });
    return () => { mutations(); roots(); observer?.disconnect(); media?.removeEventListener('change', paint); clear(); };
  }, [editor]);
  return null;
}
