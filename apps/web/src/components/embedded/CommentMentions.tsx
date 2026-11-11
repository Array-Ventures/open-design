import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
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
    onChange(next);
    setDismissed(true);
    setCaret(position);
    requestAnimationFrame(() => { const input = root.current?.querySelector('textarea'); input?.focus(); input?.setSelectionRange(position, position); });
  };
  const updateCaret = (target: EventTarget | null) => {
    if (target instanceof HTMLTextAreaElement) setCaret(target.selectionStart);
  };
  return <div ref={root} className="relative min-w-0" onInputCapture={event => { updateCaret(event.target); setDismissed(false); setIndex(0); }} onSelectCapture={event => updateCaret(event.target)} onKeyDownCapture={event => {
    if (event.nativeEvent.isComposing || !options.length) return;
    if (['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      if (event.key === 'Escape') setDismissed(true);
      else if (event.key === 'Enter' || event.key === 'Tab') choose(options[selected]!.name);
      else setIndex((selected + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length);
    }
  }}>
    {children}
    {options.length > 0 ? <div id={id} role="listbox" aria-label="Mention a bot" className="mt-1 flex max-h-40 flex-col gap-1 overflow-y-auto rounded-xl border border-border-button-default bg-background-primary-default p-1 shadow-dropdown">
      {options.map((bot, i) => <div key={bot.id} id={`${id}-${i}`} role="option" aria-selected={i === selected}>
        <Button variant="ghost" size="small" className={cx('w-full justify-start', i === selected && 'bg-background-secondary-hover')} tabIndex={-1} onMouseDown={event => event.preventDefault()} onClick={() => choose(bot.name)}>{bot.name}</Button>
      </div>)}
    </div> : null}
  </div>;
}
