import { cx } from './boardui/cx';

/** Quiet shared chrome; accent belongs to an active mode or selection. */
export const ARTIFACT_ICON_BUTTON = cx(
  'border-transparent bg-transparent text-foreground-icon-secondary shadow-none hover:border-transparent hover:bg-background-secondary-hover active:bg-background-secondary-default',
  'disabled:border-transparent disabled:bg-transparent disabled:text-foreground-icon-disabled',
  'aria-disabled:border-transparent aria-disabled:bg-transparent aria-disabled:text-foreground-icon-disabled',
);
