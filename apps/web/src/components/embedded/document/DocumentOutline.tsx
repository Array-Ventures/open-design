'use client';

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { RiMenu2Line } from '@remixicon/react';
import { Dropdown, DropdownTrigger, DropdownPopover, DropdownItem } from '../boardui/dropdown';
import { ScrollFade, useScrollFade } from '../boardui/scroll-fade';
import { cx } from '../boardui/cx';
import { DOCUMENT_ICON_BUTTON } from './document-controls';
import { focusDocumentSection, readDocumentSections, type DocumentSection } from './document-outline';

const indent = ['ps-2', 'ps-4', 'ps-6', 'ps-8', 'ps-10', 'ps-12'];
/** Content navigation in the same mounted document, not another editor. */
export function DocumentOutline() {
  const [editor] = useLexicalComposerContext();
  const [sections, setSections] = useState<DocumentSection[]>([]);
  const [open, setOpen] = useState(false), [active, setActive] = useState<string | null>(null);
  const list = useRef<HTMLElement>(null);
  const fade = useScrollFade();
  useEffect(() => { if (!open) fade.reset(); }, [open, fade.reset]);
  const pending = useRef(0), releaseTarget = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    const sync = () => editor.getEditorState().read(() => {
      const next = readDocumentSections();
      setSections(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    });
    sync();
    const stop = editor.registerUpdateListener(({ dirtyElements, dirtyLeaves }) => { if (dirtyElements.size || dirtyLeaves.size) sync(); });
    return () => { stop(); cancelAnimationFrame(pending.current); releaseTarget.current?.(); };
  }, [editor]);
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      const selected = list.current?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]');
      (selected ?? list.current?.querySelector<HTMLButtonElement>('button'))?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);
  const navigate = (id: string) => {
    setOpen(false); cancelAnimationFrame(pending.current);
    // Finish the popover's focus handoff before focusing the actual heading.
    pending.current = requestAnimationFrame(() => {
      releaseTarget.current?.();
      const restore = focusDocumentSection(editor, id);
      releaseTarget.current = restore;
      setActive(restore ? id : null);
    });
  };
  const move = (event: KeyboardEvent<HTMLElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-boardui-menu-item]')];
    if (!buttons.length) return;
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let next: number;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = buttons.length - 1;
    else if (event.key === 'ArrowUp') next = index <= 0 ? buttons.length - 1 : index - 1;
    else next = (index + 1) % buttons.length;
    event.preventDefault(); event.stopPropagation(); buttons[next]?.focus();
  };
  return <Dropdown isOpen={open} onOpenChange={setOpen}>
    <DropdownTrigger aria-label="Document outline" className={cx(DOCUMENT_ICON_BUTTON, 'me-auto box-border flex size-8 shrink-0 items-center justify-center rounded-lg border-0 p-0')}><span title="Outline"><RiMenu2Line className="size-4 shrink-0" aria-hidden /></span></DropdownTrigger>
    <DropdownPopover aria-label="Document outline" placement="bottom start" className="w-64 max-w-[calc(100vw-24px)] overflow-hidden">
      <div className="relative">
      <nav ref={list} aria-label="Document sections" className="max-h-80 overflow-y-auto" onScroll={fade.onScroll} onKeyDown={move}>
        {sections.length ? <ol className="m-0 flex list-none flex-col gap-1 p-0">{sections.map((section, index) => <li key={section.id} data-document-section-id={section.id}>
          <DropdownItem selected={active === section.id} className={cx('min-h-8 py-1.5 pe-2 text-body-2-regular', indent[section.level - 1])} onSelect={() => navigate(section.id)}>
            <span className="sr-only">{`Section ${index + 1}, heading level ${section.level}: ${section.title}`}</span><span aria-hidden className="min-w-0 truncate" title={section.title}>{section.title}</span>
          </DropdownItem>
        </li>)}</ol> : <p className="m-0 px-2 py-1.5 text-body-2-regular text-text-tertiary">No headings yet</p>}
      </nav>
      <ScrollFade progress={fade.progress} />
      </div>
    </DropdownPopover>
  </Dropdown>;
}
