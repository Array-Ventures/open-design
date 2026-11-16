import { createContext, useContext, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { Dialog, I18nProvider, Popover } from 'react-aria-components';
import { parseDate } from '@internationalized/date';
import { useI18n } from '../../../i18n';
import { DateCalendar } from '../boardui/date-calendar';
import { DocumentDateInteraction } from './DocumentDateNode';
import { createDocumentDateController, type DateCalendarOwner } from './document-date-controller';
import type { DocumentMode } from './document-suggestion-input';
export const DocumentDateInsertion = createContext<(() => void) | null>(null);
export function useDocumentDateInsertion() { return useContext(DocumentDateInsertion); }
export function DocumentDates({ mode, children }: { mode: DocumentMode; children: ReactNode }) {
  const [editor] = useLexicalComposerContext();
  const { locale, t } = useI18n();
  const latest = useRef({ mode, locale });
  const [owner, setOwner] = useState<DateCalendarOwner | null>(null);
  const [blocked, setBlocked] = useState(false);
  const controller = useRef<ReturnType<typeof createDocumentDateController> | null>(null);
  useLayoutEffect(() => {
    latest.current = { mode, locale };
    setBlocked(false);
    controller.current?.modeChanged();
  }, [mode, locale]);
  useLayoutEffect(() => {
    const instance = createDocumentDateController(editor, { mode: () => latest.current.mode, locale: () => latest.current.locale, publish: setOwner, blocked: () => setBlocked(true) });
    controller.current = instance;
    return () => { controller.current = null; instance.dispose(); };
  }, [editor]);
  const anchor = useMemo(() => ({ current: owner?.target ?? null }), [owner]);
  return <DocumentDateInteraction.Provider value={{ open: (key, target) => { setBlocked(false); controller.current?.open(key, target); } }}>
    <DocumentDateInsertion.Provider value={() => { setBlocked(false); controller.current?.insert(); }}>
      {children}
      {blocked ? <div role="status" className="px-4 py-2 text-body-2-regular text-text-secondary">{t('documentDate.blocked')}</div> : null}
      {owner ? <I18nProvider locale={locale}><Popover key={owner.generation} triggerRef={anchor} isOpen isNonModal isKeyboardDismissDisabled placement="bottom start" onOpenChange={open => { if (!open) controller.current?.dismiss(owner); }} className="z-50 max-w-[calc(100vw-16px)] outline-none">
        <div data-document-date-calendar={owner.generation} onKeyDownCapture={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); controller.current?.dismiss(owner, true); } }}><Dialog aria-label={t('documentDate.choose')} className="outline-none"><DateCalendar aria-label={t('documentDate.label')} autoFocus minValue={parseDate('0001-01-01')} maxValue={parseDate('9999-12-31')} value={parseDate(owner.value.iso)} onChange={date => controller.current?.choose(owner, date.toString())} /></Dialog></div>
      </Popover></I18nProvider> : null}
    </DocumentDateInsertion.Provider>
  </DocumentDateInteraction.Provider>;
}
