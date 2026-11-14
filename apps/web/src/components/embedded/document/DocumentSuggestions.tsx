import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $hasUpdateTag, HISTORY_PUSH_TAG } from 'lexical';
import { RiArrowLeftSLine, RiArrowRightSLine, RiCloseLine } from '@remixicon/react';
import { useT } from '../../../i18n';
import type { Dict } from '../../../i18n/types';
import { Button } from '../boardui/button';
import { cx } from '../boardui/cx';
import { $documentSuggestions, $resolveDocumentSuggestion } from './document-suggestion-commands';
import { DOCUMENT_SUGGESTION_UPDATE_TAG, DocumentSuggestionInputError } from './document-suggestion-policy';
import { attachDocumentSuggestionInput, type DocumentMode, type SuggestionNotice } from './document-suggestion-input';
import { useDocumentCommentPlacement } from './useDocumentCommentPlacement';
type Review = { id: string; inserted: string; deleted: string };
const noticeKeys: Record<SuggestionNotice, keyof Dict> = {
  unsupported: 'documentSuggestions.unsupported', structure: 'documentSuggestions.structure',
  reviewFirst: 'documentSuggestions.reviewFirst', clipboard: 'documentSuggestions.clipboard',
  plainPaste: 'documentSuggestions.plainPaste', composition: 'documentSuggestions.composition',
  blocked: 'documentSuggestions.blocked', stale: 'documentSuggestions.stale',
};
/** Passive current-proposal UI; source review uses the existing conditional writer. */
export function DocumentSuggestions({ mode, suspended, onPending, onOpenChange }: { mode: DocumentMode; suspended: boolean; onPending(count: number): void; onOpenChange(open: boolean): void }) {
  const [editor] = useLexicalComposerContext(), t = useT();
  const currentMode = useRef(mode); currentMode.current = mode;
  const [changes, setChanges] = useState<Review[]>([]), [notice, setNotice] = useState<SuggestionNotice | null>(null);
  const [selected, setSelected] = useState<string | null>(null), [open, setOpen] = useState(true), [revision, setRevision] = useState(0);
  const trigger = useRef<HTMLButtonElement>(null), returnToTrigger = useRef(false), focusCard = useRef(false);
  const callbacks = useRef({ onPending, onOpenChange }); callbacks.current = { onPending, onOpenChange };
  const index = Math.max(0, changes.findIndex(change => change.id === selected)), current = changes[index];
  const active = Boolean(current && open && !suspended);
  const range = useCallback(() => editor.getEditorState().read(() => {
    const nodes = $documentSuggestions().filter(node => node.suggestion().id === current?.id);
    const node = nodes.find(value => value.suggestion().kind === 'insert') ?? nodes[0];
    const element = node && editor.getElementByKey(node.getKey());
    if (!element?.isConnected) return null;
    const measured = element.ownerDocument.createRange(); measured.selectNodeContents(element); return measured;
  }), [editor, current?.id]);
  const placement = useDocumentCommentPlacement(editor, null, active, revision, 320, range);
  useLayoutEffect(() => attachDocumentSuggestionInput(editor, () => currentMode.current, setNotice), [editor]);
  useEffect(() => {
    const publish = () => editor.getEditorState().read(() => {
      const groups = new Map<string, Review>();
      for (const node of $documentSuggestions()) {
        const value = node.suggestion(), group = groups.get(value.id) ?? { id: value.id, inserted: '', deleted: '' };
        if (value.kind === 'insert') group.inserted = node.getTextContent(); else group.deleted = node.getTextContent();
        groups.set(value.id, group);
      }
      const next = [...groups.values()];
      setChanges(previous => previous.length === next.length && previous.every((value, at) => value.id === next[at]!.id && value.inserted === next[at]!.inserted && value.deleted === next[at]!.deleted) ? previous : next);
      setRevision(value => value + 1); callbacks.current.onPending(groups.size);
    });
    publish(); return editor.registerUpdateListener(({ dirtyElements, dirtyLeaves }) => { if (dirtyElements.size || dirtyLeaves.size) publish(); });
  }, [editor]);
  useEffect(() => { callbacks.current.onOpenChange(active); return () => callbacks.current.onOpenChange(false); }, [active]);
  useLayoutEffect(() => {
    if (active && focusCard.current) { placement.card.current?.focus(); focusCard.current = false; }
    if (!active && returnToTrigger.current) { trigger.current?.focus(); returnToTrigger.current = false; }
  }, [active, placement.card]);
  useEffect(() => {
    const click = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const element = event.target.closest('[data-eve-suggestion-id]');
      if (!element) return;
      const id = editor.getEditorState().read(() => $documentSuggestions().find(node => editor.getElementByKey(node.getKey()) === element)?.suggestion().id);
      if (id) { setSelected(id); setOpen(true); }
    };
    return editor.registerRootListener((root, previous) => { previous?.removeEventListener('click', click); root?.addEventListener('click', click); });
  }, [editor]);
  const close = () => { returnToTrigger.current = Boolean(placement.card.current?.contains(document.activeElement)); setOpen(false); };
  const review = (accept: boolean) => {
    if (!current || currentMode.current === 'viewing' || !editor.isEditable()) return;
    const id = current.id;
    editor.update(() => {
      try { $resolveDocumentSuggestion(id, accept); setNotice(null); }
      catch { setNotice('stale'); if ($hasUpdateTag(DOCUMENT_SUGGESTION_UPDATE_TAG)) throw new DocumentSuggestionInputError('The incomplete review was rolled back.'); }
    }, { tag: HISTORY_PUSH_TAG });
  };
  return <>
    {notice && !suspended ? <div role="status" className="absolute bottom-3 end-3 z-30 max-w-[calc(100%_-24px)] rounded-xl border border-border-button-default bg-background-primary-default px-3 py-2 text-body-2-regular text-text-secondary">{t(noticeKeys[notice])}</div> : null}
    {current && !open && !suspended ? <Button ref={trigger} variant="ghost" size="small" className="absolute end-3 top-3 z-30 bg-background-primary-default" onClick={() => { focusCard.current = true; setOpen(true); }}>{t('documentSuggestions.review')}</Button> : null}
    {current && open && !suspended ? <aside ref={placement.card} tabIndex={-1} role="dialog" aria-label={t('documentSuggestions.review')} onKeyDown={event => { if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); close(); } }} className={cx('absolute z-30 flex w-80 max-w-[calc(100%_-24px)] flex-col overflow-hidden rounded-2xl border border-border-button-default bg-background-primary-default shadow-lg focus-visible:ring-2 focus-visible:ring-border-focus-ring', placement.style ? 'left-[var(--document-comment-left)] right-auto top-[var(--document-comment-top)] max-h-[var(--document-comment-max-height)]' : 'end-3 top-3 max-h-[calc(100%_-24px)]')} style={{ width: 320, ...placement.style }}>
      <header className="flex shrink-0 items-center gap-1 border-b border-separator-border px-3 py-2">
        <span className="min-w-0 flex-1 text-caption-1-regular text-text-secondary">{t('documentSuggestions.count', { current: index + 1, count: changes.length })}</span>
        <Button variant="ghost" size="xs" iconOnly leadingIcon={RiArrowLeftSLine} aria-label={t('documentSuggestions.previous')} disabled={changes.length < 2} onClick={() => setSelected(changes[(index + changes.length - 1) % changes.length]!.id)} />
        <Button variant="ghost" size="xs" iconOnly leadingIcon={RiArrowRightSLine} aria-label={t('documentSuggestions.next')} disabled={changes.length < 2} onClick={() => setSelected(changes[(index + 1) % changes.length]!.id)} />
        <Button variant="ghost" size="xs" iconOnly leadingIcon={RiCloseLine} aria-label={t('common.close')} onClick={close} />
      </header>
      <div className="min-h-0 overflow-auto whitespace-pre-wrap break-words px-3 py-2 text-body-2-regular text-text-primary">
        {current.deleted ? <p><span className="text-text-secondary">{t('documentSuggestions.delete')} </span><del>{current.deleted}</del></p> : null}
        {current.inserted ? <p><span className="text-text-secondary">{t('documentSuggestions.insert')} </span><ins>{current.inserted}</ins></p> : null}
      </div>
      <footer className="flex shrink-0 justify-end gap-1 px-3 py-2">
        <Button variant="ghost" size="small" disabled={mode === 'viewing'} onClick={() => review(false)}>{t('documentSuggestions.reject')}</Button>
        <Button variant="ghost" size="small" disabled={mode === 'viewing'} onClick={() => review(true)}>{t('documentSuggestions.accept')}</Button>
      </footer>
    </aside> : null}
  </>;
}
