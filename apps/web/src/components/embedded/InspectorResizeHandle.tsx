import { useRef, useState } from 'react';
import styles from './InspectorResizeHandle.module.css';

/** A right-side inspector resizes without mutating its document or canvas state. */
export function InspectorResizeHandle({ width, maximum, label, onResize }: {
  width: number; maximum: number; label: string; onResize: (width: number) => void;
}) {
  const pointer = useRef<{ id: number; x: number; width: number; rtl: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);
  const minimum = Math.min(288, maximum);
  const resize = (next: number) => onResize(Math.max(minimum, Math.min(maximum, next)));
  const stop = () => { pointer.current = null; setDragging(false); };
  return <>
    {dragging ? <div aria-hidden className={styles.shield} /> : null}
    <div role="separator" aria-label={label} aria-orientation="vertical" tabIndex={0}
      aria-valuemin={minimum} aria-valuemax={maximum} aria-valuenow={Math.round(width)}
      className={styles.handle}
      onPointerDown={event => {
        if (event.button !== 0) return;
        event.preventDefault();
        pointer.current = { id: event.pointerId, x: event.clientX, width, rtl: getComputedStyle(event.currentTarget).direction === 'rtl' };
        event.currentTarget.setPointerCapture(event.pointerId);
        event.currentTarget.focus(); setDragging(true);
      }}
      onPointerMove={event => {
        const start = pointer.current;
        if (start?.id !== event.pointerId) return;
        resize(start.width + (event.clientX - start.x) * (start.rtl ? 1 : -1));
      }}
      onPointerUp={event => { if (pointer.current?.id === event.pointerId) { stop(); event.currentTarget.releasePointerCapture(event.pointerId); } }}
      onPointerCancel={stop} onLostPointerCapture={stop}
      onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation();
        if (event.key === 'Home') resize(minimum);
        else if (event.key === 'End') resize(maximum);
        else {
          const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
          resize(width + (event.key === (rtl ? 'ArrowRight' : 'ArrowLeft') ? 16 : -16));
        }
      }}><span aria-hidden /></div>
  </>;
}
