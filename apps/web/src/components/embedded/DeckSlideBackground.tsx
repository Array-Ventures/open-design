import { useId, useMemo, useState } from 'react';
import { parseColor, type Color } from 'react-aria-components';
import { RiCheckLine, RiCloseLine } from '@remixicon/react';
import { readDeckSlideBackground, setDeckSlideBackground } from '../../edit-mode/deck-background';
import { useT } from '../../i18n';
import { ColorPicker } from './boardui/color-picker';
import { Button } from './boardui/button';
import { Dropdown, DropdownPopover, DropdownTrigger } from './boardui/dropdown';
import { DOCUMENT_ICON_BUTTON } from './document/document-controls';

function pickerColor(value: string): Color | null {
  try { return parseColor(value || '#00000000'); } catch { return null; }
}
const colorValue = (color: Color) => color.toString(color.getChannelValue('alpha') < 1 ? 'hexa' : 'hex');
function colorLabel(value: string, custom: string): string {
  try { return colorValue(parseColor(value)); } catch { return custom; }
}

/** The picker owns a local draft. A changed source or active slide invalidates
 * that draft before it can target a different slide or overwrite newer bytes. */
export function DeckSlideBackground({ source, index, count, busy, onChange }: {
  source: string; index: number; count: number; busy?: boolean;
  onChange(source: string, label: string): void;
}) {
  const t = useT();
  const descriptionId = useId();
  const selection = useMemo(() => readDeckSlideBackground(source, index), [source, index]);
  const initialColor = useMemo(() => pickerColor(selection?.color ?? ''), [selection?.color]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => parseColor('#00000000'));
  const [dirty, setDirty] = useState(false);
  const [owner, setOwner] = useState<{ source: string; index: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const eligible = selection !== null && selection.editable && selection.count === count && initialColor !== null;
  const stale = owner !== null && (owner.source !== source || owner.index !== index);
  const label = t('manualEdit.slideBackground');
  return <div className="flex flex-col gap-2" title={!eligible ? t('manualEdit.backgroundUnavailable') : undefined}>
    <span className="text-body-2-medium text-text-primary">{label}</span>
    {!eligible ? <span id={descriptionId} className="sr-only">{t('manualEdit.backgroundUnavailable')}</span> : null}
    <Dropdown isOpen={open} onOpenChange={next => {
      if (next) {
        if (!eligible || busy || !initialColor) return;
        setDraft(initialColor); setOwner({source,index}); setFailed(false); setDirty(false);
      }
      setOpen(next);
    }}>
      <DropdownTrigger aria-label={label} aria-describedby={!eligible ? descriptionId : undefined} isDisabled={!eligible || busy}
        className="flex w-full items-center justify-start gap-2 rounded-xl border border-border-button-default bg-background-primary-default px-3 py-2 text-body-2-regular text-text-primary disabled:cursor-default disabled:opacity-50">
        <span aria-hidden className="size-5 rounded-full border border-border-button-default" style={{backgroundColor:selection?.color || 'transparent'}} />
        <span>{selection?.color ? colorLabel(selection.color,t('qf.colorCustom')) : t('common.default')}</span>
      </DropdownTrigger>
      <DropdownPopover aria-label={label} className="w-64" dialogClassName="gap-3">
        <ColorPicker aria-label={label} showAlpha value={draft} onChange={color => {setDraft(color);setDirty(true);}} />
        {stale ? <p role="status" className="text-body-2-regular text-text-secondary">{t('manualEdit.backgroundChanged')}</p> : null}
        {failed ? <p role="alert" className="text-body-2-regular text-text-error-primary">{t('manualEdit.backgroundUnavailable')}</p> : null}
        <div className="flex justify-end gap-2">
          <Button iconOnly leadingIcon={RiCloseLine} variant="ghost" size="xs" className={DOCUMENT_ICON_BUTTON}
            aria-label={t('common.cancel')} onClick={() => setOpen(false)} />
          <Button iconOnly leadingIcon={RiCheckLine} variant="ghost" size="xs" className={DOCUMENT_ICON_BUTTON}
            aria-label={t('common.save')} disabled={busy || stale || !eligible || !dirty} onClick={() => {
              if (busy || stale || !eligible || !dirty) return;
              const next = setDeckSlideBackground(source,index,colorValue(draft));
              if (next === null) { setFailed(true); return; }
              if (next !== source) onChange(next,label);
              setOpen(false);
            }} />
        </div>
      </DropdownPopover>
    </Dropdown>
  </div>;
}
