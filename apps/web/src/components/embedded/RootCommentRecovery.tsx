import { RiRefreshLine } from '@remixicon/react';
import { Button } from './boardui/button';
import { cx } from './boardui/cx';

export function RootCommentRecovery({ failure, stale, deleted, busy, onRebase }: {
  failure: string | null; stale: boolean; deleted: boolean; busy: boolean; onRebase(): void;
}) {
  if (!failure && !stale && !deleted) return null;
  return <div role={failure ? 'alert' : 'status'} className={cx('flex items-center gap-2 pb-2 text-caption-1-regular', failure ? 'text-text-error-primary' : 'text-text-tertiary')}>
    <span className="min-w-0 flex-1">{failure ?? (deleted ? 'This comment was deleted. Your draft is preserved.' : 'This comment changed. Your draft is preserved.')}</span>
    {stale && !deleted ? <Button variant="ghost" size="small" iconOnly leadingIcon={RiRefreshLine}
      className="box-border size-8 min-h-8 shrink-0 border-0 bg-transparent p-0 text-foreground-icon-secondary shadow-none hover:bg-background-secondary-hover active:bg-background-secondary-active"
      aria-label="Continue editing latest comment" title="Keep your draft and edit the latest version" disabled={busy} onClick={onRebase} /> : null}
  </div>;
}
