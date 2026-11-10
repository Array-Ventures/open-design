import { useId, useRef, useState, type ReactNode } from 'react';
import styles from './SpeakerNotesDrawer.module.css';
const COLLAPSE = 48;
export function SpeakerNotesDrawer({ children }: { children: ReactNode }) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const dragging = useRef<number | null>(null);
  const [height, setHeight] = useState(0);
  const [captured, setCaptured] = useState(false);
  const [pointerFocus, setPointerFocus] = useState(false);
  const maximum = () => Math.max(96, Math.min(400, (root.current?.parentElement?.clientHeight ?? 600) * .6));
  const resize = (next: number) => setHeight(next < COLLAPSE ? 0 : Math.min(maximum(), next));
  return <div ref={root} className={styles.drawer} data-open={height > 0 ? 'true' : 'false'} data-testid="speaker-notes-drawer" style={{ height }}>
    {captured ? <div aria-hidden="true" className={styles.shield} /> : null}
    <div data-pointer-focus={pointerFocus ? "true" : "false"} onBlur={() => setPointerFocus(false)} role="separator" aria-label="Resize speaker notes" aria-orientation="horizontal" aria-controls={id} aria-valuemin={0} aria-valuemax={400} aria-valuenow={Math.round(height)} aria-valuetext={height ? `${Math.round(height)} pixels` : 'Hidden'} tabIndex={0} title={height ? 'Drag to resize speaker notes' : 'Pull up for speaker notes'} className={styles.handle}
      onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); setPointerFocus(true); dragging.current = event.pointerId; event.currentTarget.setPointerCapture(event.pointerId); event.currentTarget.focus(); setCaptured(true); }}
      onPointerMove={event => { if (dragging.current !== event.pointerId) return; event.preventDefault(); const bottom = root.current?.getBoundingClientRect().bottom; if (bottom !== undefined) resize(bottom - event.clientY); }}
      onPointerUp={event => { if (dragging.current === event.pointerId) { dragging.current = null; setCaptured(false); event.currentTarget.releasePointerCapture(event.pointerId); } }}
      onPointerCancel={() => { dragging.current = null; setCaptured(false); }} onLostPointerCapture={() => { dragging.current = null; setCaptured(false); }}
      onKeyDown={event => {
        setPointerFocus(false);
        if (!['ArrowUp', 'ArrowDown', 'Home', 'End', 'Enter', ' ', 'Escape'].includes(event.key)) return;
        event.preventDefault();
        if (event.key === 'Home' || event.key === 'Escape') resize(0);
        else if (event.key === 'End') resize(maximum());
        else if (event.key === 'Enter' || event.key === ' ') resize(height ? 0 : 176);
        else if (event.key === 'ArrowUp') resize(height ? height + 32 : 96);
        else resize(height - 32);
      }}><span aria-hidden="true" /></div>
    <div id={id} hidden={height === 0} className={styles.content}>{children}</div>
  </div>;
}
