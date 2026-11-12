// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { WorkbookDocument } from '@open-design/contracts/runtime/workbook';
import { WorkbookSurface } from '../../../src/components/embedded/workbook/WorkbookSurface';
import { WorkbookHostError } from '../../../src/components/embedded/workbook/host-request';
const source = vi.hoisted(() => ({ load: vi.fn(), viewer: 'person-one' as string | null, mounts: 0 }));
vi.mock('../../../src/components/embedded/workbook/preview-transport', () => ({ loadWorkbookPreview: source.load }));
vi.mock('../../../src/components/embedded/host-viewer', () => ({ useEmbeddedViewer: () => source.viewer ? { memberId: source.viewer } : null }));
vi.mock('../../../src/components/embedded/workbook/WorkbookGrid', async () => {
  const { useState } = await import('react');
  return { WorkbookGrid: ({ title }: { title: string }) => { const [mount] = useState(() => ++source.mounts); return <div data-testid="loaded-grid">{title}:{mount}</div>; } };
});
const model: WorkbookDocument = { version: 1, date1904: false, activeSheetId: 'inputs', styles: [{}], features: { charts: 0, drawings: 0, externalLinks: 0, macros: false, signed: false }, sheets: [{ id: 'inputs', name: 'Inputs', visibility: 'visible', rowCount: 100, columnCount: 26, cells: [], merges: [], rowDimensions: [], columnDimensions: [], frozenRows: 0, frozenColumns: 0 }] };
const props = { projectId: '18a8301a-b6e1-4001-8000-c967b1eab222', fileName: 'book.xlsx', title: 'Revenue', sourceStamp: '1:1200' };
afterEach(() => { cleanup(); vi.resetAllMocks(); source.viewer = 'person-one'; source.mounts = 0; });
it('does not request data before a viewer is bound', () => {
  source.viewer = null; render(<WorkbookSurface {...props} />); expect(source.load).not.toHaveBeenCalled(); expect(screen.getByRole('status')).toHaveTextContent('Loading workbook');
});
it('preserves the live grid when refreshed bytes have the same source hash', async () => {
  source.load.mockResolvedValue({ sourceSha256: 'a'.repeat(64), model });
  const view = render(<WorkbookSurface {...props} />); await screen.findByTestId('loaded-grid');
  view.rerender(<WorkbookSurface {...props} sourceStamp="2:1200" title="Updated" />);
  await waitFor(() => expect(source.load).toHaveBeenCalledTimes(2));
  expect(screen.getByTestId('loaded-grid')).toHaveTextContent('Updated:1');
});
it('aborts old account reads and does not display their late response', async () => {
  let finish!: (value: unknown) => void;
  source.load.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce({ sourceSha256: 'b'.repeat(64), model });
  const view = render(<WorkbookSurface {...props} />), first = source.load.mock.calls[0]![3] as AbortSignal;
  source.viewer = 'person-two'; view.rerender(<WorkbookSurface {...props} />); expect(first.aborted).toBe(true);
  await screen.findByTestId('loaded-grid'); await act(async () => finish({ sourceSha256: 'a'.repeat(64), model }));
  expect(source.mounts).toBe(1);
});
it('retries an uncertain read with its original operation and creates a fresh one after known expiry', async () => {
  source.load.mockRejectedValueOnce(new WorkbookHostError('Response lost')).mockRejectedValueOnce(new WorkbookHostError('Expired', 410)).mockResolvedValueOnce({ sourceSha256: 'a'.repeat(64), model });
  render(<WorkbookSurface {...props} />); await screen.findByRole('alert'); fireEvent.click(screen.getByRole('button', { name: 'Retry loading workbook' }));
  await waitFor(() => expect(source.load).toHaveBeenCalledTimes(2));
  expect(source.load.mock.calls[1]![2]).toBe(source.load.mock.calls[0]![2]);
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Expired'));
  fireEvent.click(screen.getByRole('button', { name: 'Retry loading workbook' })); await screen.findByTestId('loaded-grid');
  expect(source.load.mock.calls[2]![2]).not.toBe(source.load.mock.calls[1]![2]);
});
