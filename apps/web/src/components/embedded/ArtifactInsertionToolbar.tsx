import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { RiText, RiTableLine, RiShapesLine, RiCloseLine, RiRefreshLine } from '@remixicon/react';
import { ManualEditInsertionPatch, type ManualEditInsertion } from '../../edit-mode/insertion';
import { Button } from './boardui/button';
import { Dropdown, DropdownTrigger, DropdownPopover, DropdownItem } from './boardui/dropdown';
import { cx } from './boardui/cx';
import { DOCUMENT_ICON_BUTTON } from './document/document-controls';

type Request = { requestId: string; id: string; element: ManualEditInsertion; source: string; frame: HTMLIFrameElement; window: Window };
interface Props {
  source: string | null; busy: boolean;
  getFrame(): HTMLIFrameElement | null;
  getSource(): string | null;
  onPrepare(): Promise<boolean>;
  onInsert(patch: ManualEditInsertionPatch, label: string, expectedSource: string): Promise<boolean>;
}
/** Visible only in Edit. Content remains in the source-owning canvas and uses
 * its conditional writer/history; the toolbar never writes files itself. */
export function ArtifactInsertionToolbar(props: Props) {
  const current = useRef(props);
  useLayoutEffect(() => { current.current = props; });
  const request = useRef<Request | null>(null);
  const retry = useRef<{patch: ManualEditInsertionPatch; source: string} | null>(null);
  const [active, setActive] = useState<ManualEditInsertion['kind'] | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [menu, setMenu] = useState(false);
  const alive = useRef(true);
  const preparing = useRef(false);
  const ackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = () => {
    const previous = request.current;
    request.current = null;
    if (ackTimer.current) clearTimeout(ackTimer.current);
    ackTimer.current = null;
    previous?.window.postMessage({type:'od-insert-cancel',requestId:previous.requestId}, '*');
    retry.current = null;
    setActive(null); setStatus(null);
  };
  const save = async (patch: ManualEditInsertionPatch, expectedSource: string) => {
    setPending(true); retry.current = {patch, source: expectedSource}; setStatus('Saving…');
    try {
      const ok = await current.current.onInsert(patch, patch.element.kind === 'shape' ? `Insert ${patch.element.shape}` : `Insert ${patch.element.kind}`, expectedSource);
      if (!alive.current) return;
      if (ok) { retry.current = null; setStatus(null); }
      else setStatus('Could not save insertion. Retry or cancel.');
    } catch { if (alive.current) setStatus('Could not save insertion. Retry or cancel.'); }
    finally { if (alive.current) setPending(false); }
  };
  useEffect(() => {
    alive.current = true;
    const receive = (event: MessageEvent) => {
      const attempt = request.current, data = event.data;
      if (!attempt || event.source !== attempt.window || data?.requestId !== attempt.requestId
        || current.current.getFrame() !== attempt.frame || attempt.frame.contentWindow !== attempt.window
        || current.current.getSource() !== attempt.source) return;
      if (data.type === 'od-insert-armed') {
        if (ackTimer.current) clearTimeout(ackTimer.current);
        ackTimer.current = null;
        setStatus('Click or drag to place · Esc to cancel'); return;
      }
      if (data.type === 'od-insert-unavailable') { setStatus('Choose a positioned canvas or slide.'); return; }
      if (data.type === 'od-insert-cancelled') { cancel(); return; }
      if (data.type !== 'od-insert-placement') return;
      const parsed = ManualEditInsertionPatch.safeParse({kind:'insert-element',id:attempt.id,parentId:data.parentId,element:attempt.element,placement:data.placement});
      if (!parsed.success || !parsed.data.placement) { cancel(); setStatus('Could not determine placement. Try again.'); return; }
      request.current = null;
      if (ackTimer.current) clearTimeout(ackTimer.current);
      ackTimer.current = null; setActive(null);
      void save(parsed.data, attempt.source);
    };
    window.addEventListener('message',receive);
    return () => {
      alive.current = false;
      const attempt = request.current; request.current = null;
      attempt?.window.postMessage({type:'od-insert-cancel',requestId:attempt.requestId}, '*');
      if (ackTimer.current) clearTimeout(ackTimer.current);
      window.removeEventListener('message',receive);
    };
  }, []);
  useEffect(() => {
    const attempt = request.current;
    if (!attempt) return;
    if (props.source !== attempt.source) { cancel(); return; }
    const loaded = () => cancel(); attempt.frame.addEventListener('load',loaded);
    return () => attempt.frame.removeEventListener('load',loaded);
  }, [props.source, active]);
  const arm = async (element: ManualEditInsertion) => {
    if (preparing.current || pending || current.current.busy || retry.current) return;
    cancel(); setMenu(false); preparing.current = true; setPending(true);
    try {
      if (!(await current.current.onPrepare()) || !alive.current) return;
      // Let a flushed text/style save finish its source render before choosing
      // the live frame and revision that own this insertion.
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      if (!alive.current) return;
      const frame = current.current.getFrame(), source = current.current.getSource(), target = frame?.contentWindow;
      if (!frame || !target || source === null) { setStatus('The canvas is not ready. Try again.'); return; }
      const attempt: Request = {requestId:crypto.randomUUID(),id:`eve-${crypto.randomUUID()}`,element,source,frame,window:target};
      request.current = attempt; setActive(element.kind); setStatus('Preparing placement…');
      ackTimer.current = setTimeout(() => {
        if (request.current !== attempt) return;
        cancel(); setStatus('The canvas is not ready. Try again.');
      },1500);
      target.postMessage({type:'od-insert-arm',requestId:attempt.requestId,element},'*');
      frame.focus();
    } catch { if (alive.current) setStatus('Could not prepare insertion. Try again.'); }
    finally { preparing.current = false; if (alive.current) setPending(false); }
  };
  const disabled = props.busy || pending || retry.current !== null;
  return <div className="pointer-events-none absolute inset-x-3 bottom-3 z-30 flex flex-col items-center gap-2" data-testid="artifact-insertion-toolbar">
    {status ? <div role="status" className="pointer-events-auto max-w-full rounded-lg bg-background-secondary-default px-3 py-2 text-caption-1-regular text-text-secondary shadow-sm">{status}</div> : null}
    <div role="toolbar" aria-label="Canvas insertion" className="pointer-events-auto flex max-w-full items-center gap-1 rounded-2xl border border-border-button-default bg-background-secondary-default p-1 shadow-sm">
      <Button variant="ghost" size="small" iconOnly leadingIcon={RiText} aria-label="Insert text" title="Insert text" disabled={disabled} aria-pressed={active === 'text'} className={cx(DOCUMENT_ICON_BUTTON,active === 'text' && 'bg-accent-100 text-accent-700')} onClick={() => void arm({kind:'text',text:'Text'})} />
      <Button variant="ghost" size="small" iconOnly leadingIcon={RiTableLine} aria-label="Insert table" title="Insert 3 × 3 table" disabled={disabled} aria-pressed={active === 'table'} className={cx(DOCUMENT_ICON_BUTTON,active === 'table' && 'bg-accent-100 text-accent-700')} onClick={() => void arm({kind:'table',rows:3,columns:3})} />
      <Dropdown isOpen={menu} onOpenChange={setMenu}>
        <DropdownTrigger isDisabled={disabled} aria-label="Insert shape" className={cx(DOCUMENT_ICON_BUTTON,'box-border flex size-8 items-center justify-center border-0 p-0',active === 'shape' && 'bg-accent-100 text-accent-700')}><RiShapesLine className="size-4 shrink-0" aria-hidden /></DropdownTrigger>
        <DropdownPopover aria-label="Shapes" placement="top end">
          {(['rectangle','ellipse','triangle','line','arrow'] as const).map(shape => <DropdownItem key={shape} onSelect={() => void arm({kind:'shape',shape})}>{shape[0]!.toUpperCase()+shape.slice(1)}</DropdownItem>)}
        </DropdownPopover>
      </Dropdown>
      {retry.current ? <Button variant="ghost" size="small" iconOnly leadingIcon={RiRefreshLine} aria-label="Retry insertion save" title="Retry save" disabled={props.busy || pending} className={DOCUMENT_ICON_BUTTON} onClick={() => { const attempt = retry.current; if (attempt) void save(attempt.patch, attempt.source); }} /> : null}
      {active || retry.current ? <Button variant="ghost" size="small" iconOnly leadingIcon={RiCloseLine} aria-label="Cancel insertion" title="Cancel insertion" disabled={props.busy || pending} className={DOCUMENT_ICON_BUTTON} onClick={cancel} /> : null}
    </div>
  </div>;
}
