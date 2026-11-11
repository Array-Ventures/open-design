import { commentIconButton } from './comment-button-style';
import { createContext, useContext, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { RiCheckLine, RiFilter3Line, RiCloseLine } from '@remixicon/react';
import type { PreviewComment } from '../../types';
import { Button } from './boardui/button';
import { Dropdown, DropdownTrigger, DropdownPopover, DropdownItem } from './boardui/dropdown';

type Review = {
  projectId?: string;
  showResolved: boolean;
  setShowResolved(value: boolean): void;
  changeStatus(id: string, status: 'open' | 'resolved'): Promise<boolean>;
};
const ReviewContext = createContext<Review | null>(null);
export const useCommentReview = () => useContext(ReviewContext);
export function CommentReviewProvider({ projectId, changeStatus, children }: { projectId?: string; changeStatus: Review['changeStatus']; children: ReactNode }) {
  const [showResolved, setShowResolved] = useState(false);
  const value = useMemo(() => ({ ...(projectId ? { projectId } : {}), showResolved, setShowResolved, changeStatus }), [projectId, showResolved, changeStatus]);
  return <ReviewContext.Provider value={value}>{children}</ReviewContext.Provider>;
}

/** Resolution changes the saved thread, not its canvas identity or pin number. */
export function ResolveCommentButton({ comment, allowed, blocked = false, onResolved }: { comment: PreviewComment; allowed: boolean; blocked?: boolean; onResolved?(): void }) {
  const review = useCommentReview();
  const [busy, setBusy] = useState(false);
  const life = useRef({ active: false, generation: 0, pending: false });
  useLayoutEffect(() => {
    const current = life.current; current.active = true; current.generation++; current.pending = false; setBusy(false);
    return () => { current.active = false; current.generation++; };
  }, [comment.id]);
  if (!review || !allowed || comment.status !== 'open') return null;
  return <div onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
    <Button variant="ghost" size="small" iconOnly leadingIcon={RiCheckLine} aria-label="Resolve comment" title={blocked ? 'Save your comment changes before resolving' : busy ? 'Resolving…' : 'Resolve'} disabled={busy || blocked}
      className={commentIconButton}
      onClick={() => {
        const current = life.current;
        if (current.pending || blocked) return;
        const generation = current.generation; current.pending = true; setBusy(true);
        void review.changeStatus(comment.id, 'resolved').then(saved => {
          if (current.active && current.generation === generation && saved) onResolved?.();
        }).finally(() => {
          if (current.active && current.generation === generation) { current.pending = false; setBusy(false); }
        });
      }} />
  </div>;
}

export function CommentReviewFilter() {
  const review = useCommentReview();
  if (!review) return null;
  return <Dropdown>
    <DropdownTrigger aria-label="Filter comments" className="box-border flex size-8 shrink-0 items-center justify-center rounded-lg border-0 p-0 text-foreground-icon-secondary hover:bg-background-secondary-hover focus-visible:ring-2 focus-visible:ring-border-focus-ring"><RiFilter3Line className="size-4 shrink-0" aria-hidden /></DropdownTrigger>
    <DropdownPopover aria-label="Filter comments" placement="bottom end" className="w-44">
      <DropdownItem selected={review.showResolved} onSelect={() => review.setShowResolved(!review.showResolved)}><span>Show resolved</span>{review.showResolved ? <RiCheckLine className="ms-auto size-4 shrink-0" aria-hidden /> : null}</DropdownItem>
    </DropdownPopover>
  </Dropdown>;
}

/** A list can open even when every saved thread is resolved and no pin is visible. */
export function CommentListPopover({ children, onClose }: { children: ReactNode; onClose(): void }) {
  const close = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => { close.current?.focus(); }, []);
  return <div role="dialog" aria-label="All comments" className="comment-popover comment-popover-composer comment-popover-compact comment-popover-list"
    style={{ insetInlineStart: 'auto', insetInlineEnd: 12, top: 12, width: 'min(320px, calc(100% - 24px))', maxHeight: 'calc(100% - 24px)' }}
    onKeyDown={event => { if (event.key === 'Escape' && event.currentTarget.contains(event.target as Node)) { event.preventDefault(); event.stopPropagation(); onClose(); } }}>
    <div className="comment-popover-titlebar"><span className="comment-popover-title">All comments</span><CommentReviewFilter />
      <Button ref={close} variant="ghost" size="small" iconOnly leadingIcon={RiCloseLine} aria-label="Close comments" title="Close" onClick={onClose}
        className={commentIconButton} />
    </div>
    <div className="comment-popover-body">{children}</div>
  </div>;
}
