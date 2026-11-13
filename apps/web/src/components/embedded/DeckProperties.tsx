import { useMemo } from 'react';
import { DECK_TRANSITIONS } from '@open-design/contracts/runtime/deck-stage-fallback';
import { readDeckDimensions, resizeDeckSource, readDeckTransition, setDeckTransition, type DeckAspect } from '../../edit-mode/deck-properties';
import { useT } from '../../i18n';
import { Select, SelectItem } from './boardui/select';

/** Source-backed presentation controls; the saved stage owns their behavior. */
export function DeckProperties({ source, busy, onChange }: { source: string; busy?: boolean; onChange: (source: string, label: string) => void }) {
  const t = useT();
  const dimensions = useMemo(() => readDeckDimensions(source), [source]);
  const transition = useMemo(() => readDeckTransition(source), [source]);
  if (!dimensions) return null;
  return <div className="cc-inspector"><Select label={t('inspect.size')} size="sm" className="w-full" triggerClassName="w-full justify-between"
    selectedKey={dimensions.aspect} isDisabled={busy} onSelectionChange={key => {
      if (key !== '16:9' && key !== '4:3') return;
      const next = resizeDeckSource(source, key as DeckAspect);
      if (next !== null && next !== source) onChange(next, t('inspect.size'));
    }}>
    <SelectItem id="16:9">16:9</SelectItem>
    <SelectItem id="4:3">4:3</SelectItem>
    {dimensions.aspect === 'custom' ? <SelectItem id="custom" isDisabled>{`${dimensions.width} × ${dimensions.height}`}</SelectItem> : null}
  </Select>
  <Select label={t('manualEdit.transition')} size="sm" className="w-full" triggerClassName="w-full justify-between" selectedKey={transition ?? 'none'} isDisabled={busy} onSelectionChange={key => {
    const mode = DECK_TRANSITIONS.find(value => value === key);
    if (!mode) return;
    const next = setDeckTransition(source, mode);
    if (next !== null && next !== source) onChange(next, t('manualEdit.transition'));
  }}>
    <SelectItem id="none">{t('common.none')}</SelectItem>
    <SelectItem id="fade">{t('manualEdit.transitionFade')}</SelectItem>
    <SelectItem id="push">{t('manualEdit.transitionPush')}</SelectItem>
    <SelectItem id="magic-move">{t('manualEdit.transitionMagicMove')}</SelectItem>
  </Select></div>;
}
