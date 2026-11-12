import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $createParagraphNode, $insertNodes, $getRoot, $getSelection, $getState, $isRangeSelection, $setState, FORMAT_TEXT_COMMAND, UNDO_COMMAND, REDO_COMMAND } from 'lexical';
import { $createCodeNode } from '@lexical/code';
import { $createHeadingNode, $createQuoteNode } from '@lexical/rich-text';
import { $setBlocksType } from '@lexical/selection';
import { INSERT_CHECK_LIST_COMMAND, INSERT_ORDERED_LIST_COMMAND, INSERT_UNORDERED_LIST_COMMAND } from '@lexical/list';
import { INSERT_TABLE_COMMAND } from '@lexical/table';
import { RiBold, RiItalic, RiUnderline, RiStrikethrough, RiCodeLine, RiListOrdered, RiListUnordered, RiTableLine, RiArrowGoBackLine, RiArrowGoForwardLine, RiFontSize, RiMoreLine, RiCheckLine, RiCheckboxLine, RiDoubleQuotesL, RiArrowDownSLine } from '@remixicon/react';
import { Button } from '../boardui/button';
import { Dropdown, DropdownTrigger, DropdownPopover, DropdownItem, DropdownGroup, DropdownDivider } from '../boardui/dropdown';
import { cx } from '../boardui/cx';
import { DocumentImageInsertion } from './DocumentImageInsertion';
import { DOCUMENT_ICON_BUTTON } from './document-controls';
import { documentFont, documentHeadingFont } from './document-identity';

type SelectionState = { x: number; y: number; bold: boolean; italic: boolean; underline: boolean; strikethrough: boolean; code: boolean };
/** Separate insertion and selected-text controls, following the observed document surfaces. */
export function DocumentToolbar({ font, headingFont, onImageStatus, hidden = false }: { hidden?: boolean; font: 'sans' | 'serif'; headingFont: 'sans' | 'serif'; onImageStatus?(message: string | null): void }) {
  const [editor] = useLexicalComposerContext();
  const [menu, setMenu] = useState<string | null>(null);
  useEffect(() => { if (hidden) setMenu(null); }, [hidden]);
  const [selected, setSelected] = useState<SelectionState | null>(null);
  useEffect(() => {
    let frame = 0;
    const sync = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => editor.getEditorState().read(() => {
        const selection = $getSelection(); const dom = window.getSelection(); const root = editor.getRootElement();
        if (!editor.isEditable() || !$isRangeSelection(selection) || selection.isCollapsed() || !dom?.rangeCount || !root?.contains(dom.anchorNode)) { setSelected(null); return; }
        const rect = dom.getRangeAt(0).getBoundingClientRect();
        const width = Math.min(360, window.innerWidth - 24);
        setSelected({ x: Math.max(12, Math.min(window.innerWidth - width - 12, rect.left)), y: rect.top >= 64 ? rect.top - 48 : rect.bottom + 8,
          bold: selection.hasFormat('bold'), italic: selection.hasFormat('italic'), underline: selection.hasFormat('underline'), strikethrough: selection.hasFormat('strikethrough'), code: selection.hasFormat('code') });
      }));
    };
    const unregister = editor.registerUpdateListener(sync); const editable = editor.registerEditableListener(sync);
    document.addEventListener('selectionchange', sync); window.addEventListener('scroll', sync, true); window.addEventListener('resize', sync);
    return () => { cancelAnimationFrame(frame); unregister(); editable(); document.removeEventListener('selectionchange', sync); window.removeEventListener('scroll', sync, true); window.removeEventListener('resize', sync); };
  }, [editor]);
  const heading = (tag: 'p' | 'h1' | 'h2' | 'h3') => editor.update(() => {
    const selection = $getSelection();
    if ($isRangeSelection(selection)) $setBlocksType(selection, () => tag === 'p' ? $createParagraphNode() : $createHeadingNode(tag));
  });
  return <>
    <div hidden={hidden} className={cx(hidden ? 'hidden' : 'flex', 'shrink-0 justify-center px-3 pb-3 pt-2')}>
      <div className="flex max-w-full items-center gap-1 rounded-2xl border border-border-button-default bg-background-secondary-default p-1 shadow-sm" role="toolbar" aria-label="Document insertion">
        <Dropdown isOpen={!hidden && menu === 'font'} onOpenChange={open => setMenu(open ? 'font' : null)}>
          <DropdownTrigger aria-label="Font" className="box-border flex size-8 shrink-0 items-center justify-center rounded-lg border-0 p-0 text-foreground-icon-secondary hover:bg-background-secondary-hover focus-visible:ring-2 focus-visible:ring-border-focus-ring"><RiFontSize className="size-4 shrink-0" aria-hidden /></DropdownTrigger>
          <DropdownPopover aria-label="Font" placement="top start" className="w-40">
            {([{ label: 'Headings', state: documentHeadingFont, value: headingFont }, { label: 'Text', state: documentFont, value: font }] as const).map((group, index) => <div key={group.label} role="group" aria-label={group.label}>
              {index ? <DropdownDivider /> : null}
              <DropdownGroup label={group.label}>
                {(['serif', 'sans'] as const).map(choice => <DropdownItem key={choice} selected={group.value === choice} onSelect={() => editor.update(() => $setState($getRoot(), group.state, choice))}>
                  <span>{choice === 'serif' ? 'Serif' : 'Sans'}</span>{group.value === choice ? <RiCheckLine className="ms-auto size-4 shrink-0 text-accent-600" aria-hidden /> : null}
                </DropdownItem>)}
              </DropdownGroup>
            </div>)}
          </DropdownPopover>
        </Dropdown>
        <Button variant="ghost" size="small" iconOnly className={DOCUMENT_ICON_BUTTON} leadingIcon={RiTableLine} aria-label="Insert table" title="Insert 3 × 3 table" onMouseDown={event => event.preventDefault()} onClick={() => editor.dispatchCommand(INSERT_TABLE_COMMAND, { columns: '3', rows: '3', includeHeaders: true })} />
        <DocumentImageInsertion onStatus={onImageStatus} />
        <Button variant="ghost" size="small" iconOnly className={DOCUMENT_ICON_BUTTON} leadingIcon={RiCheckboxLine} aria-label="Checklist" title="Checklist" onMouseDown={event => event.preventDefault()} onClick={() => editor.dispatchCommand(INSERT_CHECK_LIST_COMMAND, undefined)} />
        <Dropdown isOpen={!hidden && menu === 'more'} onOpenChange={open => setMenu(open ? 'more' : null)}>
          <DropdownTrigger aria-label="More document actions" className="box-border flex size-8 shrink-0 items-center justify-center rounded-lg border-0 p-0 text-foreground-icon-secondary hover:bg-background-secondary-hover focus-visible:ring-2 focus-visible:ring-border-focus-ring"><RiMoreLine className="size-4 shrink-0" aria-hidden /></DropdownTrigger>
          <DropdownPopover aria-label="Document actions" placement="top end">
            <DropdownItem onSelect={() => editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined)}><RiListUnordered className="size-4 shrink-0" aria-hidden />Bulleted list</DropdownItem>
            <DropdownItem onSelect={() => editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined)}><RiListOrdered className="size-4 shrink-0" aria-hidden />Numbered list</DropdownItem>
            <DropdownDivider />
            <DropdownItem onSelect={() => editor.update(() => { const selection = $getSelection(); if ($isRangeSelection(selection)) $setBlocksType(selection, () => $createQuoteNode()); })}><RiDoubleQuotesL className="size-4 shrink-0" aria-hidden />Quote</DropdownItem>
            <DropdownItem onSelect={() => editor.update(() => { const selection = $getSelection(); if ($isRangeSelection(selection)) $insertNodes([$createCodeNode()]); })}><RiCodeLine className="size-4 shrink-0" aria-hidden />Code block</DropdownItem>
            <DropdownDivider />
            <DropdownItem onSelect={() => editor.dispatchCommand(UNDO_COMMAND, undefined)}><RiArrowGoBackLine className="size-4 shrink-0" aria-hidden />Undo</DropdownItem>
            <DropdownItem onSelect={() => editor.dispatchCommand(REDO_COMMAND, undefined)}><RiArrowGoForwardLine className="size-4 shrink-0" aria-hidden />Redo</DropdownItem>
          </DropdownPopover>
        </Dropdown>
      </div>
    </div>
    {!hidden && selected ? createPortal(<div role="toolbar" aria-label="Selected text formatting" style={{ position: 'fixed', left: selected.x, top: selected.y }} className="z-30 flex max-w-[calc(100vw-24px)] items-center gap-1 rounded-xl border border-border-button-default bg-background-secondary-default p-1 shadow-lg">
      <Dropdown isOpen={!hidden && menu === 'text'} onOpenChange={open => setMenu(open ? 'text' : null)}>
        <DropdownTrigger aria-label="Text style" className="box-border flex h-8 shrink-0 items-center gap-1 rounded-lg border-0 px-2 py-0 text-body-2-medium text-text-secondary hover:bg-background-secondary-hover">Text<RiArrowDownSLine className="size-4 shrink-0" aria-hidden /></DropdownTrigger>
        <DropdownPopover aria-label="Text style" placement="bottom start">
          {(['p', 'h1', 'h2', 'h3'] as const).map((tag, index) => <DropdownItem key={tag} onSelect={() => heading(tag)}>{index ? `Heading ${index}` : 'Normal text'}</DropdownItem>)}
        </DropdownPopover>
      </Dropdown>
      {([{ label: 'Bold', icon: RiBold, format: 'bold' }, { label: 'Italic', icon: RiItalic, format: 'italic' }, { label: 'Underline', icon: RiUnderline, format: 'underline' }, { label: 'Strikethrough', icon: RiStrikethrough, format: 'strikethrough' }, { label: 'Code', icon: RiCodeLine, format: 'code' }] as const).map(control => <Button key={control.format} variant="ghost" size="small" iconOnly leadingIcon={control.icon} aria-label={control.label} title={control.label} aria-pressed={selected[control.format]} className={cx(DOCUMENT_ICON_BUTTON, selected[control.format] && 'bg-accent-100 text-accent-700 hover:bg-accent-200 active:bg-accent-200')} onMouseDown={event => event.preventDefault()} onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, control.format)} />)}
    </div>, document.body) : null}
  </>;
}
