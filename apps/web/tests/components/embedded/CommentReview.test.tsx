// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { PreviewComment } from '../../../src/types';
import { CommentListPopover, CommentReviewFilter, CommentReviewProvider, ResolveCommentButton, useCommentReview } from '../../../src/components/embedded/CommentReview';
import { CommentThreadMenu } from '../../../src/components/embedded/CommentThreadMenu';
afterEach(cleanup);
const comment = { id: 'comment-a', status: 'open' } as PreviewComment;
it('resolves only an authorized open comment and closes only after acceptance', async () => {
  let finish!: (accepted: boolean) => void;
  const change = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; })); const close = vi.fn();
  render(<CommentReviewProvider changeStatus={change}><ResolveCommentButton comment={comment} allowed onResolved={close} /></CommentReviewProvider>);
  const resolve = screen.getByRole('button', { name: 'Resolve comment' });
  fireEvent.click(resolve); fireEvent.click(resolve);
  expect(change).toHaveBeenCalledTimes(1); expect(close).not.toHaveBeenCalled();
  await act(async () => { finish(true); });
  expect(change).toHaveBeenCalledWith('comment-a', 'resolved'); expect(close).toHaveBeenCalledOnce();
});
it('keeps the card available when resolution fails', async () => {
  const close = vi.fn();
  render(<CommentReviewProvider changeStatus={async () => false}><ResolveCommentButton comment={comment} allowed onResolved={close} /></CommentReviewProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Resolve comment' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Resolve comment' })).not.toBeDisabled());
  expect(close).not.toHaveBeenCalled();
});
it('does not close a different thread when a pending resolution finishes', async () => {
  let finish!: (accepted: boolean) => void;
  const change = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; })); const close = vi.fn();
  const view = (id: string) => <CommentReviewProvider changeStatus={change}><ResolveCommentButton comment={{ ...comment, id }} allowed onResolved={close} /></CommentReviewProvider>;
  const rendered = render(view('comment-a')); fireEvent.click(screen.getByRole('button', { name: 'Resolve comment' }));
  rendered.rerender(view('comment-b'));
  await act(async () => { finish(true); });
  expect(close).not.toHaveBeenCalled(); expect(screen.getByRole('button', { name: 'Resolve comment' })).not.toBeDisabled();
});
it('does not close a dismissed card on a late resolution response', async () => {
  let finish!: (accepted: boolean) => void; const close = vi.fn();
  const rendered = render(<CommentReviewProvider changeStatus={() => new Promise(resolve => { finish = resolve; })}><ResolveCommentButton comment={comment} allowed onResolved={close} /></CommentReviewProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Resolve comment' })); rendered.unmount();
  await act(async () => { finish(true); }); expect(close).not.toHaveBeenCalled();
});
it('offers no status action outside the embedded provider or to another author', () => {
  const view = render(<ResolveCommentButton comment={comment} allowed />);
  expect(screen.queryByRole('button')).toBeNull(); view.unmount();
  render(<CommentReviewProvider changeStatus={vi.fn()}><ResolveCommentButton comment={comment} allowed={false} /></CommentReviewProvider>);
  expect(screen.queryByRole('button')).toBeNull();
});
function FilterState() { const review = useCommentReview(); return <><CommentReviewFilter /><output aria-label="Resolved visibility">{String(review?.showResolved)}</output></>; }
it('reveals resolved threads only through an explicit filter choice', async () => {
  render(<CommentReviewProvider changeStatus={vi.fn()}><FilterState /></CommentReviewProvider>);
  expect(screen.getByLabelText('Resolved visibility')).toHaveTextContent('false');
  fireEvent.click(screen.getByRole('button', { name: 'Filter comments' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Show resolved' }));
  expect(screen.getByLabelText('Resolved visibility')).toHaveTextContent('true');
});
it('places Reopen in the saved thread actions menu', async () => {
  const reopen = vi.fn();
  render(<CommentThreadMenu canEdit={false} canDelete onEdit={vi.fn()} onDelete={vi.fn()} onReopen={reopen} />);
  fireEvent.click(screen.getByRole('button', { name: 'Comment actions' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Reopen' }));
  expect(reopen).toHaveBeenCalledOnce();
});

it('opens a keyboard-accessible empty list without inventing an element target', () => {
  const close = vi.fn();
  render(<CommentReviewProvider changeStatus={vi.fn()}><CommentListPopover onClose={close}><p>No comments</p></CommentListPopover></CommentReviewProvider>);
  expect(screen.getByRole('dialog', { name: 'All comments' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Close comments' })).toHaveFocus();
  fireEvent.keyDown(screen.getByRole('button', { name: 'Close comments' }), { key: 'Escape' });
  expect(close).toHaveBeenCalledOnce(); expect(screen.queryByRole('textbox')).toBeNull();
});

it('does not dismiss the comments card for Escape inside its portalled filter', async () => {
  const close = vi.fn();
  render(<CommentReviewProvider changeStatus={vi.fn()}><CommentListPopover onClose={close}><p>No comments</p></CommentListPopover></CommentReviewProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Filter comments' }));
  const option = await screen.findByRole('button', { name: 'Show resolved' });
  fireEvent.keyDown(option, { key: 'Escape' });
  expect(close).not.toHaveBeenCalled(); expect(screen.getByRole('dialog', { name: 'All comments' })).toBeInTheDocument();
});

it('requires saving unsent changes before starting resolution', () => {
  const change = vi.fn();
  render(<CommentReviewProvider changeStatus={change}><ResolveCommentButton comment={comment} allowed blocked /></CommentReviewProvider>);
  const resolve = screen.getByRole('button', { name: 'Resolve comment' });
  expect(resolve).toBeDisabled(); expect(resolve).toHaveAttribute('title', 'Save your comment changes before resolving');
  fireEvent.click(resolve); expect(change).not.toHaveBeenCalled();
});
