import { useMemo } from 'react';
import { readDeckDimensions, resizeDeckSource, type DeckAspect } from '../../edit-mode/deck-properties';
import { useT } from '../../i18n';
import { Select, SelectItem } from './boardui/select';

/** A source-backed size control: the same saved stage drives every renderer. */
export function DeckDimensions({ source, busy, onChange }: { source: string; busy?: boolean; onChange: (source: string) => void }) {
  const t = useT();
  const dimensions = useMemo(() => readDeckDimensions(source), [source]);
  if (!dimensions) return null;
  return <div className="cc-inspector"><Select label={t('inspect.size')} size="sm" className="w-full" triggerClassName="w-full justify-between"
    selectedKey={dimensions.aspect} isDisabled={busy} onSelectionChange={key => {
      if (key !== '16:9' && key !== '4:3') return;
      const next = resizeDeckSource(source, key as DeckAspect);
      if (next !== null && next !== source) onChange(next);
    }}>
    <SelectItem id="16:9">16:9</SelectItem>
    <SelectItem id="4:3">4:3</SelectItem>
    {dimensions.aspect === 'custom' ? <SelectItem id="custom" isDisabled>{`${dimensions.width} × ${dimensions.height}`}</SelectItem> : null}
  </Select></div>;
}
