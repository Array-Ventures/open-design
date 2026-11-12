import { useEffect, useRef } from 'react';
import { RiCloseLine, RiRefreshLine } from '@remixicon/react';
import { Button } from '../boardui/button';
import { ScrollFade, useScrollFade } from '../boardui/scroll-fade';
import { ARTIFACT_ICON_BUTTON } from '../artifact-controls';
import { cx } from '../boardui/cx';
import type { useWorkbookHistory } from './use-workbook-history';

type History = ReturnType<typeof useWorkbookHistory>;
function versionTime(time: number) { return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(time); }
export function WorkbookHistory({ history, dirty, sourceSha256, reload }: { history: History; dirty: boolean; sourceSha256?: string; reload(): void }) {
  const close = useRef<HTMLButtonElement>(null), fade = useScrollFade();
  useEffect(() => { if (history.open) close.current?.focus(); }, [history.open]);
  if (!history.open || history.canOpen === false) return null;
  const mismatch = sourceSha256 !== undefined && (history.sha !== null || history.versions.length > 0) && history.sha !== sourceSha256;
  const missing = history.available && history.sha === null, recovery = history.available && !sourceSha256 && !missing;
  const disabled = history.available === false || history.working || history.checking || !history.intent && (missing || dirty || mismatch);
  return <section role="dialog" aria-label="Workbook history" aria-busy={history.loading || history.working} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); history.close(); } }}
    className="absolute end-3 top-3 z-30 flex max-h-[calc(100%-1.5rem)] w-80 max-w-[calc(100%-1.5rem)] flex-col rounded-xl border border-border-button-default bg-background-primary-default text-text-primary shadow-lg">
    <header className="flex shrink-0 items-center gap-1 px-3 py-2">
      <h2 className="min-w-0 flex-1 text-body-medium">History</h2>
      <Button variant="ghost" size="small" iconOnly leadingIcon={RiRefreshLine} className={ARTIFACT_ICON_BUTTON} aria-label="Refresh workbook history" title="Refresh history" disabled={history.loading || history.working} onClick={history.refresh} />
      <Button ref={close} variant="ghost" size="small" iconOnly leadingIcon={RiCloseLine} className={ARTIFACT_ICON_BUTTON} aria-label="Close workbook history" title="Close history" onClick={history.close} />
    </header>
    <div className="relative min-h-0 flex-1">
      <div tabIndex={0} onScroll={fade.onScroll} className="max-h-72 overflow-y-auto px-2 pb-2 outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring">
        {!history.versions.length ? <p role="status" className="m-0 p-2 text-caption-1-regular text-text-tertiary">{history.loading || history.checking ? 'Loading history…' : 'No saved revisions yet.'}</p> :
          <ul aria-label="Workbook revisions" className="m-0 list-none space-y-1 p-0">{history.versions.map(version => <li key={version.id}>
            <Button variant="ghost" size="small" aria-label={`Version ${version.version}${version.current ? ', current' : ''}`} aria-pressed={(history.intent?.versionId ?? history.selected?.id) === version.id}
              disabled={history.working || Boolean(history.intent)} onClick={() => history.select(version)}
              className={cx(ARTIFACT_ICON_BUTTON, 'h-auto w-full justify-start rounded-lg px-2 py-2 text-start text-text-primary disabled:bg-transparent disabled:text-text-tertiary [&>span]:min-w-0 [&>span]:flex-1', (history.intent?.versionId ?? history.selected?.id) === version.id && 'bg-button-ghost-background text-button-ghost-foreground')}>
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex items-center gap-2 text-caption-1-semibold"><span>Version {version.version}</span>{version.current ? <span className="text-caption-2-regular text-text-tertiary">Current</span> : null}</span>
                <span className="truncate text-caption-2-regular text-text-secondary">{versionTime(version.createdAt)} · {version.source === 'restore' ? 'Restored' : version.source === 'ai' ? 'Agent' : 'Saved'}</span>
                {version.label ? <span className="truncate text-caption-2-regular text-text-tertiary" title={version.label}>{version.label}</span> : null}
              </span>
            </Button>
          </li>)}</ul>}
        {history.cursor ? <Button variant="ghost" size="small" className="mt-2 w-full" disabled={history.loading || history.working} onClick={history.more}>Load older</Button> : null}
      </div>
      <ScrollFade progress={fade.progress} />
    </div>
    {history.error || history.intent || dirty || mismatch || missing || recovery || history.selected ? <footer className="flex shrink-0 flex-col gap-2 border-t border-separator-border p-3">
      {history.error ? <p role="alert" className="m-0 break-words text-caption-1-regular text-text-error-primary">{history.error}</p> : null}
      {history.intent ? <p className="m-0 text-caption-1-regular text-text-secondary">{history.intent.versionNumber ? `Version ${history.intent.versionNumber} restore needs confirmation.` : 'A restore needs confirmation.'} Check its status before editing.</p> : missing ? <p className="m-0 text-caption-1-regular text-text-secondary">The current workbook is missing. History restore will not recreate it.</p> : dirty ? <p className="m-0 text-caption-1-regular text-text-secondary">Save or discard your edits before restoring.</p> : mismatch ? <div className="flex items-center gap-2"><p className="m-0 min-w-0 flex-1 text-caption-1-regular text-text-secondary">The workbook changed elsewhere. Reload it before restoring.</p><Button variant="ghost" size="small" iconOnly leadingIcon={RiRefreshLine} className={ARTIFACT_ICON_BUTTON} aria-label="Reload current workbook" onClick={reload} /></div> : history.selected ? <p className="m-0 text-caption-1-regular text-text-secondary">Restore version {history.selected.version} as a new revision.</p> : null}
      {history.intent && missing ? <p className="m-0 text-caption-1-regular text-text-secondary">The current file is missing. Check status only; it will not be recreated.</p> : null}
      {recovery ? <p className="m-0 text-caption-1-regular text-text-secondary">Restore a saved version to recover this file. Local drafts are kept.</p> : null}
      {history.intent || history.selected ? <div className="flex justify-end"><Button variant="secondary" size="small" disabled={disabled || !history.intent && history.selected?.contentDigest === (sourceSha256 ?? history.sha)} onClick={() => void history.restore()}>{history.working ? 'Restoring…' : history.intent ? 'Check status' : 'Restore'}</Button></div> : null}
    </footer> : null}
  </section>;
}
