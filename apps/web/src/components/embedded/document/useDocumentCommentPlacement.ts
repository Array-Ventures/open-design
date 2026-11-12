import { useLayoutEffect, useRef, useState } from 'react';
import type { LexicalEditor } from 'lexical';
import { createDOMRange } from '@lexical/selection';
import { resolveDocumentComment, type DocumentCommentAnchor } from './document-comment-anchor';

/** Measure the exact saved selection without changing editor selection or text. */
export function useDocumentCommentPlacement(editor: LexicalEditor, anchor: DocumentCommentAnchor | null, active: boolean, revision: number, width: number) {
  const card = useRef<HTMLElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number; maxHeight: number } | undefined>();
  useLayoutEffect(() => {
    const element = card.current, parent = element?.offsetParent;
    if (!active || !anchor || !element || !(parent instanceof HTMLElement)) { setPosition(undefined); return; }
    let frame = 0;
    const measure = () => {
      const bounds = parent.getBoundingClientRect(), size = element.getBoundingClientRect();
      const selected = editor.getEditorState().read(() => {
        const selection = resolveDocumentComment(anchor);
        if (!selection) return null;
        const range = createDOMRange(editor, selection.anchor.getNode(), selection.anchor.offset, selection.focus.getNode(), selection.focus.offset);
        return range && typeof range.getClientRects === 'function' ? [...range.getClientRects()].find(rect => rect.bottom > bounds.top && rect.top < bounds.bottom) : null;
      });
      if (!selected || !bounds.width || !bounds.height) { setPosition(undefined); return; }
      const gap = 12, rtl = getComputedStyle(element).direction === 'rtl';
      const after = selected.right - bounds.left + gap, before = selected.left - bounds.left - size.width - gap;
      const side = rtl ? before >= gap ? before : after : after + size.width <= bounds.width - gap ? after : before;
      const beside = side >= gap && side + size.width <= bounds.width - gap;
      const left = Math.max(gap, Math.min(bounds.width - size.width - gap, beside ? side : bounds.width - size.width - gap));
      const desiredTop = (beside ? selected.top : selected.bottom + gap) - bounds.top;
      const top = Math.max(gap, Math.min(desiredTop, bounds.height - size.height - gap));
      const next = { left, top, maxHeight: Math.max(0, bounds.height - top - gap) };
      setPosition(old => old?.left === next.left && old.top === next.top && old.maxHeight === next.maxHeight ? old : next);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    measure();
    const observer = new ResizeObserver(schedule); observer.observe(element); observer.observe(parent);
    document.addEventListener('scroll', schedule, true); window.addEventListener('resize', schedule);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); document.removeEventListener('scroll', schedule, true); window.removeEventListener('resize', schedule); };
  }, [editor, anchor, active, revision, width]);
  // Embedded BoardUI utilities are important. Pass measurements through CSS
  // variables consumed by those utilities, rather than inline properties that
  // lose to the fallback top/max-height classes in the real stylesheet.
  return { card, style: position ? {
    '--document-comment-left': `${position.left}px`,
    '--document-comment-top': `${position.top}px`,
    '--document-comment-max-height': `${position.maxHeight}px`,
  } : undefined };
}
