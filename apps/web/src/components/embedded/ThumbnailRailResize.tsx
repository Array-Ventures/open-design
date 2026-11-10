import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import styles from './ThumbnailRailResize.module.css';

export function ThumbnailRailResize({ children, collapsed, width, onResize }: {
  children: ReactNode; collapsed: boolean; width: number; onResize: (width: number) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const pointer = useRef<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [pointerFocus, setPointerFocus] = useState(false);
  const maximum = () => Math.max(96, Math.min(360, (root.current?.parentElement?.clientWidth ?? 800) * .45));
  useLayoutEffect(() => {
    const parent = root.current?.parentElement;
    if (!parent) return;
    const clamp = () => { const limit = maximum(); if (!collapsed && width > limit) onResize(limit); };
    clamp();
    const observer = new ResizeObserver(clamp);
    observer.observe(parent);
    return () => observer.disconnect();
  }, [collapsed, width, onResize]);
  const resize = (next: number) => onResize(next < 40 ? 0 : Math.max(64, Math.min(maximum(), next)));
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
        event.preventDefault(); pointer.current = event.pointerId; setPointerFocus(true);
        event.currentTarget.setPointerCapture(event.pointerId); event.currentTarget.focus(); setDragging(true);
      }}
      onPointerMove={event => {
        if (pointer.current !== event.pointerId || !root.current) return;
        event.preventDefault();
        const rect = root.current.getBoundingClientRect();
        resize(getComputedStyle(root.current).direction === 'rtl' ? rect.right - event.clientX : event.clientX - rect.left);
      }}
      onPointerUp={event => { if (pointer.current === event.pointerId) { stop(); event.currentTarget.releasePointerCapture(event.pointerId); } }}
      onPointerCancel={stop} onLostPointerCapture={stop}
      onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape', 'Enter', ' '].includes(event.key)) return;
        event.preventDefault(); setPointerFocus(false);
        if (event.key === 'Home' || event.key === 'Escape') onResize(0);
        else if (event.key === 'End') resize(maximum());
        else if (event.key === 'Enter' || event.key === ' ') onResize(collapsed ? width : 0);
        else {
          const rtl = root.current && getComputedStyle(root.current).direction === 'rtl';
          const grow = event.key === (rtl ? 'ArrowLeft' : 'ArrowRight');
          resize(collapsed ? (grow ? 96 : 0) : width + (grow ? 24 : -24));
        }
      }}><span aria-hidden /></div>
  </div>;
}
