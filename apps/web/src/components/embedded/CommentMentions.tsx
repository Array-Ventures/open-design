import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Popover } from 'react-aria-components';
import { MENU_POPOVER_SURFACE, MENU_POPOVER_WIDTH } from './boardui/menu-styles';
import { Button } from './boardui/button';
import { cx } from './boardui/cx';
import { useEmbeddedMentionBots } from './host-viewer';

/** Mention names stay in the saved note and in the existing staged chat context. */
export function CommentMentions({ value, onChange, children }: { value: string; onChange(value: string): void; children: ReactNode }) {
  const bots = useEmbeddedMentionBots();
  const [caret, setCaret] = useState(value.length);
  const [index, setIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  const composing = useRef(false);
  const insertion = useRef<{ input: HTMLTextAreaElement; value: string; position: number } | null>(null);
  useLayoutEffect(() => {
    const receipt = insertion.current;
    if (!receipt) return;
    insertion.current = null;
    // Restore the insertion caret only in the commit that accepted this value,
    // before another native edit can supersede it. Never target a replacement.
    if (receipt.value !== value || receipt.input !== root.current?.querySelector('textarea') || !receipt.input.isConnected || receipt.input.value !== value) return;
    receipt.input.focus(); receipt.input.setSelectionRange(receipt.position, receipt.position);
  });
  const before = value.slice(0, caret);
  const start = before.lastIndexOf('@');
  const query = before.slice(start + 1);
  const active = !dismissed && start >= 0 && (start === 0 || !/[\p{L}\p{N}_.]/u.test((before[start - 1] ?? ''))) && !query.includes('\n') && !query.includes('@') && query.split(' ').length <= 3;
  const options = active ? bots.filter(bot => bot.name.toLocaleLowerCase().startsWith(query.toLocaleLowerCase())) : [];
  const selected = Math.min(index, Math.max(0, options.length - 1));
  useEffect(() => {
    const input = root.current?.querySelector('textarea');
    if (!input) return;
    input.setAttribute('aria-autocomplete', 'list');
    if (options.length) {
      input.setAttribute('aria-controls', id);
      input.setAttribute('aria-activedescendant', `${id}-${selected}`);
    } else {
      input.removeAttribute('aria-controls'); input.removeAttribute('aria-activedescendant');
    }
  }, [id, options.length, selected]);
  const choose = (name: string) => {
    const next = value.slice(0, start) + `@${name} ` + value.slice(caret);
    const position = start + name.length + 2;
    const input = root.current?.querySelector('textarea');
    insertion.current = input ? { input, value: next, position } : null;
    onChange(next);
    setDismissed(true);
    setCaret(position);
  };
  const updateCaret = (target: EventTarget | null) => {
    insertion.current = null;
    if (target instanceof HTMLTextAreaElement) setCaret(target.selectionStart);
  };
  // Keep input bookkeeping in the bubble batch with the controlled textarea's
  // onChange. A document-delegated capture update can commit an older value
  // before the native input reaches its authoritative value handler.
  return <div ref={root} className="relative min-w-0" onPointerDownCapture={() => { insertion.current = null; }} onBlurCapture={() => { insertion.current = null; }} onCompositionStartCapture={() => { composing.current = true; }} onCompositionEndCapture={() => { composing.current = false; }} onInput={event => { updateCaret(event.target); setDismissed(false); setIndex(0); }} onSelectCapture={event => updateCaret(event.target)} onKeyDownCapture={event => {
    insertion.current = null;
    if (composing.current || event.nativeEvent.isComposing || !options.length) return;
    if (['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      if (event.key === 'Escape') setDismissed(true);
      else if (event.key === 'Enter' || event.key === 'Tab') choose(options[selected]!.name);
      else setIndex((selected + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length);
    }
  }}>
    {children}
    <Popover isOpen={options.length > 0} triggerRef={root} placement="top start" offset={4} isNonModal
      onOpenChange={open => { if (!open) setDismissed(true); }} shouldCloseOnInteractOutside={element => !root.current?.contains(element)}
      className={cx(MENU_POPOVER_SURFACE, MENU_POPOVER_WIDTH)}>
      <div id={id} role="listbox" aria-label="Mention a bot" className="flex max-h-40 flex-col gap-1 overflow-y-auto">
      {options.map((bot, i) => <div key={bot.id} id={`${id}-${i}`} role="option" aria-selected={i === selected}>
        <Button variant="secondary" size="small" className={cx('w-full justify-start border-transparent bg-transparent text-text-secondary shadow-none hover:border-transparent hover:bg-background-secondary-hover', i === selected && 'bg-button-ghost-background text-button-ghost-foreground hover:bg-button-ghost-hover')} tabIndex={-1} onMouseDown={event => event.preventDefault()} onClick={() => choose(bot.name)}>{bot.name}</Button>
      </div>)}
      </div>
    </Popover>
  </div>;
}
