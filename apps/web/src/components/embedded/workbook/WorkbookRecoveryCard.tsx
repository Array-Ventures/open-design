import { useId } from 'react';
import { RiDeleteBinLine, RiDownloadLine } from '@remixicon/react';
import { Button } from '../boardui/button';
import { ARTIFACT_ICON_BUTTON } from '../artifact-controls';
import { cx } from '../boardui/cx';

export interface WorkbookRecoveryCardProps {
  drafts: { draftId: string; updatedAt: number }[];
  busy: boolean;
  restoreDisabled?: boolean;
  error: string | null;
  onRestore(draftId: string): void;
  onDiscard(draftId: string): void;
  onContinue(): void;
  onDownload?(draftId: string): void;
}

function draftTime(updatedAt: number) {
  const date = new Date(updatedAt);
  if (!Number.isFinite(date.getTime())) return { label: 'Time unavailable', iso: undefined };
  return {
    label: new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date),
    iso: date.toISOString(),
  };
}

/** Presentation only: the caller owns access, draft storage and recovery. */
export function WorkbookRecoveryCard({ drafts, busy, restoreDisabled, error, onRestore, onDiscard, onContinue, onDownload }: WorkbookRecoveryCardProps) {
  const titleId = useId(), descriptionId = useId();
  return <section aria-labelledby={titleId} aria-describedby={descriptionId} aria-busy={busy}
    className="w-full max-w-sm rounded-xl border border-border-button-default bg-background-primary-default p-4 text-text-primary shadow-sm">
    <div className="space-y-1">
      <h2 id={titleId} className="text-body-medium">Unsaved drafts</h2>
      <p id={descriptionId} className="text-caption-1-regular text-text-secondary">Restore a draft, or continue with the current workbook and keep your drafts for later.</p>
    </div>
    {drafts.length ? <ul aria-label="Workbook drafts" className="mt-3 mb-0 max-h-60 list-none space-y-1 overflow-y-auto p-0">
      {drafts.map(({ draftId, updatedAt }) => {
        const time = draftTime(updatedAt);
        const name = `draft saved ${time.label}`;
        return <li key={draftId} className="flex min-w-0 items-center gap-2 rounded-lg bg-background-secondary-default px-2 py-2">
          <time dateTime={time.iso} className="min-w-0 flex-1 truncate text-caption-1-regular text-text-secondary" title={time.label}>{time.label}</time>
          <div className="flex shrink-0 items-center gap-1">
            <Button type="button" variant="ghost" size="xs" className={cx(ARTIFACT_ICON_BUTTON, 'text-text-secondary')} disabled={busy || restoreDisabled} aria-label={`Restore ${name}`} onClick={() => onRestore(draftId)}>Restore</Button>
            {onDownload ? <Button type="button" variant="ghost" size="small" className={ARTIFACT_ICON_BUTTON} iconOnly leadingIcon={RiDownloadLine} disabled={busy}
              aria-label={`Download ${name}`} title="Download recovery copy (JSON)" onClick={() => onDownload(draftId)} /> : null}
            <Button type="button" variant="ghost" size="small" className={ARTIFACT_ICON_BUTTON} iconOnly leadingIcon={RiDeleteBinLine} disabled={busy}
              aria-label={`Discard ${name}`} title="Discard draft" onClick={() => onDiscard(draftId)} />
          </div>
        </li>;
      })}
    </ul> : null}
    {error ? <p role="alert" className="mt-3 break-words text-caption-1-regular text-text-error-primary">{error}</p> : null}
    <div className="mt-3 flex justify-end">
      <Button type="button" variant="secondary" size="small" disabled={busy} aria-label="Continue with current workbook and keep drafts" onClick={onContinue}>Continue</Button>
    </div>
  </section>;
}
