import { useEffect, useRef } from 'react';
import { RiSlideshow3Line, RiStickyNoteLine } from '@remixicon/react';
import { Dropdown, DropdownTrigger, DropdownPopover, DropdownItem } from './boardui/dropdown';

/** The shared host header owns presentation controls; the deck owns its runtime. */
export function DeckPresentationMenu({ projectId, hosted = false, onPresent }: { projectId: string; hosted?: boolean; onPresent(withNotes: boolean): void }) {
  const controllerId = useRef(crypto.randomUUID()).current;
  const handler = useRef(onPresent);
  const inHost = hosted && window.parent !== window;
  useEffect(() => { handler.current = onPresent; }, [onPresent]);
  useEffect(() => {
    if (!inHost) return;
    const publish = () => window.parent.postMessage({ type: 'studio:presentation-state', projectId, controllerId }, window.location.origin);
    const receive = (event: MessageEvent) => {
      if (event.source !== window.parent || event.origin !== window.location.origin || event.data?.projectId !== projectId) return;
      if (event.data.type === 'studio:presentation-request') { publish(); return; }
      if (event.data.type === 'studio:presentation-control' && event.data.controllerId === controllerId && typeof event.data.withNotes === 'boolean') handler.current(event.data.withNotes);
    };
    window.addEventListener('message', receive);
    publish();
    return () => {
      window.removeEventListener('message', receive);
      window.parent.postMessage({ type: 'studio:presentation-unavailable', projectId, controllerId }, window.location.origin);
    };
  }, [projectId, controllerId, inHost]);
  if (inHost) return null;
  return <div className="flex items-center justify-end px-2 py-1"><Dropdown>
    <DropdownTrigger aria-label="Present" className="flex size-8 shrink-0 items-center justify-center rounded-lg p-0 text-foreground-icon-secondary hover:bg-background-secondary-hover">
      <RiSlideshow3Line className="size-4 shrink-0" aria-hidden />
    </DropdownTrigger>
    <DropdownPopover aria-label="Present" placement="bottom end">
      <DropdownItem onSelect={() => onPresent(false)}><RiSlideshow3Line className="size-4 shrink-0" aria-hidden />Present</DropdownItem>
      <DropdownItem onSelect={() => onPresent(true)}><RiStickyNoteLine className="size-4 shrink-0" aria-hidden />Present with speaker notes</DropdownItem>
    </DropdownPopover>
  </Dropdown></div>;
}
