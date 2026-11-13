import { RiArrowRightLine, RiCloseLine, RiHistoryLine, RiRefreshLine } from '@remixicon/react';
import { useState } from 'react';
import { Button } from '../boardui/button';
import { ARTIFACT_ICON_BUTTON } from '../artifact-controls';
import { cx } from '../boardui/cx';

export function MissingWorkbookRestores({ files, more, loading, error, retry, centered, disabled, onOpen }: { files: string[]; more: (() => Promise<void>) | null; loading: boolean; error: string | null; retry(): void; centered: boolean; disabled: boolean; onOpen(fileName: string): void }) {
  const [open, setOpen] = useState(false);
  if (!files.length && !more && !error && !(centered && loading)) return null;
  return <div className={centered ? 'absolute inset-0 z-20 flex items-center justify-center p-4' : 'absolute end-3 top-3 z-30'}>
    {!centered && !open ? <Button variant="ghost" size="small" iconOnly leadingIcon={RiHistoryLine} className={ARTIFACT_ICON_BUTTON} aria-label="Workbook restore recovery" title="Workbook recovery" onClick={() => setOpen(true)} /> :
      <section role="region" aria-label="Workbook restore recovery" className="w-80 max-w-full rounded-xl border border-border-button-default bg-background-primary-default p-3 text-text-primary shadow-lg">
        <header className="mb-2 flex items-center gap-2"><h2 className="m-0 min-w-0 flex-1 text-body-medium">{files.length ? 'Restore needs confirmation' : error ? 'Recovery unavailable' : 'Checking recovery…'}</h2>{!centered ? <Button variant="ghost" size="small" iconOnly leadingIcon={RiCloseLine} className={ARTIFACT_ICON_BUTTON} aria-label="Close restore recovery" onClick={() => setOpen(false)} /> : null}</header>
        <p role={error ? 'alert' : undefined} className="m-0 mb-2 text-caption-1-regular text-text-secondary">{error ?? (files.length ? 'Check a pending restore without recreating its missing file.' : 'Checking restore recovery on this device.')}</p>
        <ul className="m-0 list-none space-y-1 p-0">{files.map(fileName => <li key={fileName}><Button variant="ghost" size="small" trailingIcon={RiArrowRightLine}
          disabled={disabled} title={disabled ? 'Keep your edits before opening restore recovery.' : fileName} aria-label={`Open restore status for ${fileName}`} onClick={() => onOpen(fileName)}
          className={cx(ARTIFACT_ICON_BUTTON, 'w-full justify-between text-start text-text-primary [&>span]:min-w-0 [&>span]:flex-1')}><span className="block truncate">{fileName}</span></Button></li>)}</ul>
        {error ? <div className="flex justify-end"><Button variant="ghost" size="small" iconOnly leadingIcon={RiRefreshLine} className={ARTIFACT_ICON_BUTTON} disabled={loading} aria-label="Retry workbook recovery" title="Retry recovery" onClick={retry} /></div> : null}
        {more ? <Button variant="ghost" size="small" className={cx(ARTIFACT_ICON_BUTTON, 'mt-2 w-full')} disabled={loading} onClick={() => void more()}>Check more</Button> : null}
      </section>}
  </div>;
}
