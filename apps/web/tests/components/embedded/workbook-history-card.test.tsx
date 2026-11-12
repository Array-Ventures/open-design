// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { WorkbookHistory } from '../../../src/components/embedded/workbook/WorkbookHistory';
import type { useWorkbookHistory } from '../../../src/components/embedded/workbook/use-workbook-history';
const sha = 'a'.repeat(64), target = 'b'.repeat(64);
function fixture() {
  return { open: true, versions: [{ id: 'v1', fileName: 'book.xlsx', version: 1, label: 'Original', createdAt: 1, source: 'manual', size: 10, current: false, contentDigest: target }],
    selected: { id: 'v1', version: 1, contentDigest: target }, cursor: 'older', sha, error: null, loading: false, working: false, checking: false, intent: null,
    close: vi.fn(), select: vi.fn(), refresh: vi.fn(), more: vi.fn(), restore: vi.fn() } as unknown as ReturnType<typeof useWorkbookHistory>;
}
afterEach(cleanup);
it('offers only receipt reconciliation in status-only recovery even when the working file exists again', () => {
  const history = { ...fixture(), statusOnly: true, available: true, canOpen: true, intent: {} as never };
  const view = render(<WorkbookHistory history={history} dirty={false} reload={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'Check status' }).hasAttribute('disabled')).toBe(false);
  expect(screen.queryByText(/Restore a saved version/)).toBeNull();
  expect(screen.getByRole('button', { name: 'Version 1' }).hasAttribute('disabled')).toBe(true);
  view.rerender(<WorkbookHistory history={{ ...history, intent: null }} dirty={false} reload={vi.fn()} />);
  expect(screen.queryByRole('button', { name: /^Restore$/ })).toBeNull();
  expect(screen.queryByText('Restore version 1 as a new revision.')).toBeNull();
  expect(screen.queryByText(/Restore a saved version/)).toBeNull();
});
it('uses a compact nonmodal history card with distinct select, pagination and restore actions', () => {
  const history = fixture(); render(<WorkbookHistory history={history} dirty={false} sourceSha256={sha} reload={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Version 1' })); expect(history.select).toHaveBeenCalledWith(history.versions[0]);
  fireEvent.click(screen.getByRole('button', { name: 'Load older' })); expect(history.more).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: /^Restore$/ })); expect(history.restore).toHaveBeenCalledOnce();
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' }); expect(history.close).toHaveBeenCalledOnce();
});
it('blocks restoration for unsaved edits but keeps pending-receipt checks available across a current-source mismatch', () => {
  const history = fixture(); const view = render(<WorkbookHistory history={history} dirty={true} sourceSha256={sha} reload={vi.fn()} />);
  expect(screen.getByRole('button', { name: /^Restore$/ }).hasAttribute('disabled')).toBe(true);
  expect(screen.getByText('Save or discard your edits before restoring.')).toBeTruthy();
  view.rerender(<WorkbookHistory history={{ ...history, intent: {} as never }} dirty={false} sourceSha256={target} reload={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'Check status' }).hasAttribute('disabled')).toBe(false);
});
it('allows raw-SHA recovery without a preview, refuses missing-file resurrection, and hides denied metadata', () => {
  const history = { ...fixture(), available: true, canOpen: true };
  const view = render(<WorkbookHistory history={history} dirty={false} reload={vi.fn()} />);
  expect(screen.getByText('Restore a saved version to recover this file. Local drafts are kept.')).toBeTruthy();
  expect(screen.getByRole('button', { name: /^Restore$/ }).hasAttribute('disabled')).toBe(false);
  view.rerender(<WorkbookHistory history={{ ...history, sha: null }} dirty={false} reload={vi.fn()} />);
  expect(screen.getByText('The current workbook is missing. History restore will not recreate it.')).toBeTruthy();
  expect(screen.getByRole('button', { name: /^Restore$/ }).hasAttribute('disabled')).toBe(true);
  view.rerender(<WorkbookHistory history={{ ...history, canOpen: false }} dirty={false} reload={vi.fn()} />);
  expect(screen.queryByRole('dialog')).toBeNull();
});
it('keeps a retained receipt status check enabled when the current file is missing or a local draft is dirty', () => {
  const history = { ...fixture(), available: true, canOpen: true, sha: null, intent: {} as never };
  render(<WorkbookHistory history={history} dirty={true} reload={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'Check status' }).hasAttribute('disabled')).toBe(false);
  expect(screen.getByText('The current file is missing. Check status only; it will not be recreated.')).toBeTruthy();
});
it('suppresses stale mismatch/reload copy and holds Restore until the fresh head finishes loading', () => {
  const history = { ...fixture(), available: true, canOpen: true, fresh: false, loading: true };
  const reload = vi.fn(); const view = render(<WorkbookHistory history={history} dirty={false} sourceSha256={target} reload={reload} />);
  expect(screen.queryByText('The workbook changed elsewhere. Reload it before restoring.')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Reload current workbook' })).toBeNull();
  expect(screen.getByRole('button', { name: /^Restore$/ }).hasAttribute('disabled')).toBe(true);
  expect(screen.queryByRole('button', { name: 'Version 1' })).toBeNull();
  view.rerender(<WorkbookHistory history={{ ...history, fresh: true, loading: false, sha: target }} dirty={false} sourceSha256={target} reload={reload} />);
  expect(screen.queryByText('The workbook changed elsewhere. Reload it before restoring.')).toBeNull();
  expect(reload).not.toHaveBeenCalled();
});
