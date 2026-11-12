// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { WorkbookRecoveryCard } from '../../../src/components/embedded/workbook/WorkbookRecoveryCard';

afterEach(cleanup);
const drafts = [{ draftId: 'private-storage-key-one', updatedAt: Date.UTC(2026, 10, 12, 10) }, { draftId: 'private-storage-key-two', updatedAt: Date.UTC(2026, 10, 12, 11) }];
function props() { return { drafts, busy: false, error: null, onRestore: vi.fn(), onDiscard: vi.fn(), onContinue: vi.fn(), onDownload: vi.fn() }; }

it('exposes timestamps and compact named actions without exposing storage identities', () => {
  const handlers = props(); const { container } = render(<WorkbookRecoveryCard {...handlers} />);
  expect(screen.getByRole('region', { name: 'Unsaved drafts' })).toBeInTheDocument();
  expect(container.querySelectorAll('time')).toHaveLength(2);
  expect(container.querySelector('time')).toHaveAttribute('datetime', new Date(drafts[0]!.updatedAt).toISOString());
  expect(container.textContent).not.toContain('private-storage-key');
  fireEvent.click(screen.getAllByRole('button', { name: /^Restore draft/ })[1]!);
  fireEvent.click(screen.getAllByRole('button', { name: /^Download draft/ })[0]!);
  fireEvent.click(screen.getAllByRole('button', { name: /^Discard draft/ })[1]!);
  expect(handlers.onRestore).toHaveBeenCalledWith(drafts[1]!.draftId);
  expect(handlers.onDownload).toHaveBeenCalledWith(drafts[0]!.draftId);
  expect(handlers.onDiscard).toHaveBeenCalledWith(drafts[1]!.draftId);
});

it('continues without choosing or discarding another draft', () => {
  const handlers = props(); render(<WorkbookRecoveryCard {...handlers} />);
  fireEvent.click(screen.getByRole('button', { name: 'Continue with current workbook and keep drafts' }));
  expect(handlers.onContinue).toHaveBeenCalledOnce();
  expect(handlers.onDiscard).not.toHaveBeenCalled();
  expect(handlers.onRestore).not.toHaveBeenCalled();
});

it('disables every recovery action while busy and announces errors', () => {
  const handlers = props(); render(<WorkbookRecoveryCard {...handlers} busy error="Close the other workbook tab before restoring." />);
  expect(screen.getByRole('alert')).toHaveTextContent('Close the other workbook tab');
  for (const button of screen.getAllByRole('button')) { expect(button).toBeDisabled(); fireEvent.click(button); }
  expect(handlers.onRestore).not.toHaveBeenCalled();
  expect(handlers.onDiscard).not.toHaveBeenCalled();
  expect(handlers.onDownload).not.toHaveBeenCalled();
  expect(handlers.onContinue).not.toHaveBeenCalled();
});

it('supports an empty draft list and omits unavailable download actions', () => {
  const handlers = props(); const view = render(<WorkbookRecoveryCard {...handlers} onDownload={undefined} />);
  expect(screen.queryByRole('button', { name: /^Download draft/ })).not.toBeInTheDocument();
  view.rerender(<WorkbookRecoveryCard {...handlers} drafts={[]} />);
  expect(screen.queryByRole('list')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /^Continue/ })).toBeEnabled();
});
