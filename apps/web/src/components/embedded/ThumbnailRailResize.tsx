import { useRef, useState, type ReactNode } from 'react';
import styles from './ThumbnailRailResize.module.css';

export function ThumbnailRailResize({ children, collapsed, width, defaultWidth, onResize }: {
  children: ReactNode; collapsed: boolean; width: number; defaultWidth: number; onResize: (width: number) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const pointer = useRef<{ id: number; x: number; width: number; collapsed: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [pointerFocus, setPointerFocus] = useState(false);
  const maximum = () => Math.max(64, Math.min(defaultWidth + 24, (root.current?.parentElement?.clientWidth ?? 800) - 160));
  const restingWidth = () => Math.min(defaultWidth, maximum());
  const resize = (next: number) => onResize(Math.max(Math.max(24, restingWidth() - 23), Math.min(maximum(), next)));
  const stop = () => { pointer.current = null; setDragging(false); };
  return <div ref={root} className={styles.rail} data-collapsed={collapsed} data-testid="thumbnail-resize-region">
    {!collapsed ? children : null}
    {dragging ? <div aria-hidden className={styles.shield} /> : null}
    <div role="separator" aria-label="Resize slide thumbnails" aria-orientation="vertical"
      aria-valuemin={0} aria-valuemax={Math.round(maximum())} aria-valuenow={collapsed ? 0 : Math.round(width)}
      aria-valuetext={collapsed ? 'Hidden' : `${Math.round(width)} pixels`} tabIndex={0}
      title={collapsed ? 'Pull to show slide thumbnails' : 'Drag to resize slide thumbnails'}
      className={styles.handle} data-pointer-focus={pointerFocus} onBlur={() => setPointerFocus(false)}
      onPointerDown={event => {
        if (event.button !== 0) return;
        event.preventDefault(); pointer.current = { id: event.pointerId, x: event.clientX, width, collapsed }; setPointerFocus(true);
        event.currentTarget.setPointerCapture(event.pointerId); event.currentTarget.focus(); setDragging(true);
      }}
      onPointerMove={event => {
        const start = pointer.current;
        if (start?.id !== event.pointerId || !root.current) return;
        event.preventDefault();
        const delta = (event.clientX - start.x) * (getComputedStyle(root.current).direction === 'rtl' ? -1 : 1);
        if (start.collapsed) onResize(delta >= 12 ? restingWidth() : 0);
        else if (delta <= -24) onResize(0);
        else resize(start.width + delta);
      }}
      onPointerUp={event => { if (pointer.current?.id === event.pointerId) { stop(); event.currentTarget.releasePointerCapture(event.pointerId); } }}
      onPointerCancel={stop} onLostPointerCapture={stop}
      onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape', 'Enter', ' '].includes(event.key)) return;
        event.preventDefault(); setPointerFocus(false);
        if (event.key === 'Home' || event.key === 'Escape') onResize(0);
        else if (event.key === 'End') resize(maximum());
        else if (event.key === 'Enter' || event.key === ' ') onResize(collapsed ? restingWidth() : 0);
        else {
          const rtl = root.current && getComputedStyle(root.current).direction === 'rtl';
          const grow = event.key === (rtl ? 'ArrowLeft' : 'ArrowRight');
          if (!grow) onResize(0);
          else if (collapsed) onResize(restingWidth());
          else resize(width + 8);
        }
      }}><span aria-hidden /></div>
  </div>;
}
