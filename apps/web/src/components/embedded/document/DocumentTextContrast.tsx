import { useEffect } from 'react';
import { $getNodeByKey, $isTextNode, TextNode, type MutationListener } from 'lexical';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { CodeHighlightNode } from '@lexical/code';
import { TableCellNode } from '@lexical/table';
import { DOCUMENT_TEXT_INK, documentTextInk, documentColorReader } from './document-text-contrast';

/** View-only contrast at actual text owners; no model or writer updates. */
export function DocumentTextContrast() {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    const keys = new Set<string>();
    const owners = new Map<string, HTMLElement>();
    const clear = () => { for (const owner of owners.values()) owner.style.removeProperty(DOCUMENT_TEXT_INK); };
    const paint = () => {
      const root = editor.getRootElement();
      if (!root) return;
      // Withdraw all prior colors before measuring any inherited foreground.
      clear();
      const style = root.ownerDocument.createElement('span').style;
      editor.getEditorState().read(() => {
        for (const key of keys) {
          const owner = editor.getElementByKey(key), node = $getNodeByKey(key);
          owner?.style.removeProperty(DOCUMENT_TEXT_INK);
          const cell = owner?.closest('td,th');
          if (!owner || !cell || !root.contains(cell) || !$isTextNode(node)) { owners.delete(key); continue; }
          style.cssText = node.getStyle();
          // An authored foreground is source authority, even if low contrast.
          if (style.getPropertyValue('color')) { owners.delete(key); continue; }
          owners.set(key, owner);
        }
      });
      const read = documentColorReader(root.ownerDocument);
      const inks = Array.from(owners.values(), owner => [owner, documentTextInk(owner, read)] as const);
      for (const [owner, ink] of inks) if (ink) owner.style.setProperty(DOCUMENT_TEXT_INK, ink);
    };
    const changed: MutationListener = nodes => {
      for (const [key, mutation] of nodes) {
        owners.get(key)?.style.removeProperty(DOCUMENT_TEXT_INK);
        if (mutation === 'destroyed') { keys.delete(key); owners.delete(key); }
        else keys.add(key);
      }
      paint();
    };
    const texts = editor.registerMutationListener(TextNode, changed, { skipInitialization: false });
    const highlights = editor.registerMutationListener(CodeHighlightNode, changed, { skipInitialization: false });
    const cells = editor.registerMutationListener(TableCellNode, paint, { skipInitialization: false });
    let observer: MutationObserver | undefined;
    let media: MediaQueryList | undefined;
    const roots = editor.registerRootListener(root => {
      observer?.disconnect(); media?.removeEventListener('change', paint);
      if (!root) { clear(); return; }
      observer = new MutationObserver(paint);
      observer.observe(root.ownerDocument.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] });
      media = root.ownerDocument.defaultView?.matchMedia?.('(prefers-color-scheme: dark)');
      media?.addEventListener('change', paint); paint();
    });
    return () => { texts(); highlights(); cells(); roots(); observer?.disconnect(); media?.removeEventListener('change', paint); clear(); };
  }, [editor]);
  return null;
}
