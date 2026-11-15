import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { LexicalEditor } from 'lexical';
import { createDOMRange } from '@lexical/selection';
import { resolveDocumentComment, type DocumentCommentAnchor } from './document-comment-anchor';

/** Measure the exact saved selection without changing editor selection or text. */
export function useDocumentCommentPlacement(editor: LexicalEditor, anchor: DocumentCommentAnchor | null, active: boolean, revision: number, width: number, viewRange?: () => Range | null, gutterScroll?: RefObject<HTMLElement | null>) {
  const card = useRef<HTMLElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number; maxHeight: number } | undefined>();
  useLayoutEffect(() => {
    const element = card.current, parent = element?.offsetParent;
    if (!active || (!anchor && !viewRange) || !element || !(parent instanceof HTMLElement)) { setPosition(undefined); return; }
    const scroll = gutterScroll?.current;
    const ownedScroll = scroll && parent.contains(scroll) ? scroll : null;
    let frame = 0;
    const measure = () => {
      const bounds = parent.getBoundingClientRect(), size = element.getBoundingClientRect();
      const range = viewRange ? viewRange() : editor.getEditorState().read(() => {
        const selection = anchor && resolveDocumentComment(anchor);
        if (!selection) return null;
        const range = createDOMRange(editor, selection.anchor.getNode(), selection.anchor.offset, selection.focus.getNode(), selection.focus.offset);
        return range;
      });
      const selected = range && typeof range.getClientRects === 'function' ? [...range.getClientRects()].find(rect => rect.bottom > bounds.top && rect.top < bounds.bottom) : null;
      if (!selected || !bounds.width || !bounds.height) { setPosition(undefined); return; }
      const gap = 12, rtl = getComputedStyle(element).direction === 'rtl';
      const after = selected.right - bounds.left + gap, before = selected.left - bounds.left - size.width - gap;
      const side = rtl ? before >= gap ? before : after : after + size.width <= bounds.width - gap ? after : before;
      const beside = side >= gap && side + size.width <= bounds.width - gap;
      // Suggestions reserve logical end space in this exact scroll owner. Use
      // that measured gutter rather than placing over short selected text.
      const scrollBounds = ownedScroll?.getBoundingClientRect();
      const gutterGap = 8;
      const scrollRtl = ownedScroll ? getComputedStyle(ownedScroll).direction === 'rtl' : false;
      const gutterLeft = scrollBounds ? (scrollRtl
        ? scrollBounds.left - bounds.left - size.width - gutterGap
        : scrollBounds.right - bounds.left + gutterGap) : null;
      const gutterFits = gutterLeft !== null && scrollBounds !== undefined && scrollBounds.width > 0
        && scrollBounds.left >= bounds.left && scrollBounds.right <= bounds.right
        && gutterLeft >= gutterGap && gutterLeft + size.width <= bounds.width - gutterGap;
      const left = gutterFits ? gutterLeft : Math.max(gap, Math.min(bounds.width - size.width - gap, beside ? side : bounds.width - size.width - gap));
      const desiredTop = (gutterFits || beside ? selected.top : selected.bottom + gap) - bounds.top;
      const top = Math.max(gap, Math.min(desiredTop, bounds.height - size.height - gap));
      const next = { left, top, maxHeight: Math.max(0, bounds.height - top - gap) };
      setPosition(old => old?.left === next.left && old.top === next.top && old.maxHeight === next.maxHeight ? old : next);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    measure();
    const observer = new ResizeObserver(schedule); observer.observe(element); observer.observe(parent); if (ownedScroll) observer.observe(ownedScroll);
    const directionObserver = ownedScroll ? new MutationObserver(schedule) : null;
    directionObserver?.observe(document.documentElement, { attributes: true, attributeFilter: ['dir'] });
    document.addEventListener('scroll', schedule, true); window.addEventListener('resize', schedule);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); directionObserver?.disconnect(); document.removeEventListener('scroll', schedule, true); window.removeEventListener('resize', schedule); };
  }, [editor, anchor, active, revision, width, viewRange, gutterScroll]);
  // Embedded BoardUI utilities are important. Pass measurements through CSS
  // variables consumed by those utilities, rather than inline properties that
  // lose to the fallback top/max-height classes in the real stylesheet.
  return { card, style: position ? {
    '--document-comment-left': `${position.left}px`,
    '--document-comment-top': `${position.top}px`,
    '--document-comment-max-height': `${position.maxHeight}px`,
  } : undefined };
}
