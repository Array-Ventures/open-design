import { cx } from './boardui/cx';

/** Comment actions stay neutral; blue belongs to the selected annotation mode. */
export const commentIconButton = cx(
  'box-border size-8 min-h-8 shrink-0 border-0 bg-transparent p-0 shadow-none',
  'text-foreground-icon-secondary hover:bg-background-secondary-hover active:bg-background-secondary-active',
  'disabled:bg-transparent disabled:text-foreground-icon-disabled',
  'aria-disabled:bg-transparent aria-disabled:text-foreground-icon-disabled',
);
