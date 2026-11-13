// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import type { WorkbookDocument } from '@open-design/contracts/runtime/workbook';
import { WorkbookSurface } from '../../../src/components/embedded/workbook/WorkbookSurface';
import * as drafts from '../../../src/components/embedded/workbook/draft-store';
import { WorkbookHostError } from '../../../src/components/embedded/workbook/host-request';
const source = vi.hoisted(() => ({ load: vi.fn(), viewer: 'person-one' as string | null, mounts: 0, authorize: vi.fn(), locks: new Set<string>(), lockNames: [] as string[] }));
// These tests predate durable drafts/history. Supply the real guarded recovery
// dependencies rather than bypassing them; only the host/preview boundaries
// and spreadsheet renderer remain deterministic fixture seams.
vi.mock('../../../src/components/embedded/workbook/preview-transport', async original => ({ ...await original<object>(), loadWorkbookPreview: source.load }));
vi.mock('../../../src/components/embedded/workbook/host-request', async original => ({ ...await original<object>(), workbookHostRequest: source.authorize }));
vi.mock('../../../src/components/embedded/workbook/draft-store', async original => {
  const actual = await original<typeof import('../../../src/components/embedded/workbook/draft-store')>();
  return { ...actual, accessWorkbookRestore: vi.fn(actual.accessWorkbookRestore), listWorkbookDrafts: vi.fn(actual.listWorkbookDrafts), readWorkbookDraft: vi.fn(actual.readWorkbookDraft) };
});
vi.mock('../../../src/components/embedded/host-viewer', () => ({ useEmbeddedViewer: () => source.viewer ? { memberId: source.viewer } : null }));
vi.mock('../../../src/components/embedded/workbook/WorkbookGrid', async () => {
  const { useState, useEffect } = await import('react');
  const { gridWorkbook } = await import('../../../src/components/embedded/workbook/grid-model');
  const { CellValueType } = await import('@univerjs/presets');
  type Snapshot = ReturnType<typeof gridWorkbook>['data'];
  return { WorkbookGrid: ({ id, title, model, onReady, onSnapshot }: { id: string; title: string; model: WorkbookDocument; onReady(snapshot: Snapshot): Promise<void>; onSnapshot(snapshot: Snapshot): void }) => {
    const [mount] = useState(() => ++source.mounts);
    useEffect(() => { void onReady(gridWorkbook(model, id, title).data); }, [id, model, onReady]);
    return <div data-testid="loaded-grid">{title}:{mount}<button onClick={() => {
      const changed = gridWorkbook(model, id, title).data;
      const sheet = changed.sheets!.inputs!; sheet.cellData ??= {}; sheet.cellData[0] ??= {}; sheet.cellData[0]![0] = { v: 42, t: CellValueType.NUMBER };
      onSnapshot(changed);
    }}>Edit fixture cell</button></div>;
  } };
});
const model: WorkbookDocument = { version: 1, date1904: false, activeSheetId: 'inputs', styles: [{}], features: { charts: 0, drawings: 0, externalLinks: 0, macros: false, signed: false }, sheets: [{ id: 'inputs', name: 'Inputs', visibility: 'visible', rowCount: 100, columnCount: 26, cells: [], merges: [], rowDimensions: [], columnDimensions: [], frozenRows: 0, frozenColumns: 0 }] };
const props = { projectId: '18a8301a-b6e1-4001-8000-c967b1eab222', fileName: 'book.xlsx', title: 'Revenue', sourceStamp: '1:1200' };
beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('navigator', { locks: { request: async (name: string, _options: unknown, callback: (lock: { name: string } | null) => Promise<unknown>) => {
    expect(name.startsWith('od-workbook-draft:')).toBe(true);
    expect(_options).toMatchObject({ mode: 'exclusive', ifAvailable: true });
    source.lockNames.push(name);
    if (source.locks.has(name)) return callback(null);
    source.locks.add(name);
    try { return await callback({ name }); } finally { source.locks.delete(name); }
  } } });
  source.authorize.mockImplementation(async (projectId, request) => {
    expect(source.viewer).not.toBeNull(); expect(projectId).toBe(props.projectId);
    expect(request.action).toBe('list-history'); expect(request.fileName).toBe(props.fileName);
    return { projectId, fileName: props.fileName, currentSha256: (source.viewer === 'person-two' ? 'b' : 'a').repeat(64), versions: [], nextCursor: null };
  });
});
afterEach(async () => {
  cleanup();
  // A browser-wide lease must remain held until real journal/writer work drains.
  await waitFor(() => expect(source.locks.size).toBe(0));
  vi.resetAllMocks(); vi.unstubAllGlobals(); source.viewer = 'person-one'; source.mounts = 0; source.lockNames = [];
});
it('does not request data before a viewer is bound', () => {
  source.viewer = null; render(<WorkbookSurface {...props} />); expect(source.load).not.toHaveBeenCalled(); expect(source.authorize).not.toHaveBeenCalled(); expect(drafts.accessWorkbookRestore).not.toHaveBeenCalled(); expect(drafts.listWorkbookDrafts).not.toHaveBeenCalled(); expect(screen.getByRole('status')).toHaveTextContent('Loading workbook');
});
it('keeps an unresolved restore distinct from unsaved edits when its preview finishes after reload', async () => {
  const scope = { viewerId: 'person-one', projectId: props.projectId, fileName: props.fileName };
  const intent = { ...scope, version: 1 as const, operationId: '18a8301a-b6e1-4001-8000-c967b1eab223', preparationId: '18a8301a-b6e1-4001-8000-c967b1eab224', versionId: 'retained-v1', versionNumber: 1, sourceSha256: 'a'.repeat(64), versionSha256: 'b'.repeat(64) };
  await drafts.accessWorkbookRestore(scope, { expected: null, value: intent });
  let finish!: (value: { sourceSha256: string; model: WorkbookDocument }) => void;
  source.load.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(<WorkbookSurface {...props} />);
  await screen.findByRole('button', { name: 'Check status' });
  await act(async () => finish({ sourceSha256: 'b'.repeat(64), model }));
  expect(screen.queryByText(/refreshed while you have unsaved changes/)).toBeNull();
  expect(screen.queryByTestId('loaded-grid')).toBeNull();
  expect(screen.getByRole('button', { name: 'Check status' })).toBeTruthy();
  expect(await drafts.accessWorkbookRestore(scope)).toEqual(intent);
  expect(drafts.listWorkbookDrafts).not.toHaveBeenCalled();
});
it('preserves the live grid when refreshed bytes have the same source hash', async () => {
  source.load.mockResolvedValue({ sourceSha256: 'a'.repeat(64), model });
  const firstDirty = vi.fn(), nextDirty = vi.fn();
  const view = render(<WorkbookSurface {...props} onDirtyChange={firstDirty} />); await screen.findByTestId('loaded-grid');
  await waitFor(() => expect(screen.queryByText('Checking restore recovery…')).toBeNull());
  expect(source.authorize.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(drafts.accessWorkbookRestore).mock.invocationCallOrder[0]!);
  view.rerender(<WorkbookSurface {...props} sourceStamp="2:1200" title="Updated" onDirtyChange={nextDirty} />);
  await waitFor(() => expect(source.load).toHaveBeenCalledTimes(2));
  expect(screen.getByTestId('loaded-grid')).toHaveTextContent('Updated:1');
  const firstCalls = firstDirty.mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: 'Edit fixture cell' }));
  await waitFor(() => expect(nextDirty).toHaveBeenLastCalledWith(true));
  expect(firstDirty).toHaveBeenCalledTimes(firstCalls);
  expect(screen.queryByRole('alert')).toBeNull();
  expect(source.lockNames.some(name => name.includes('person-one') && name.includes(props.projectId))).toBe(true);
});
it('aborts old account reads and does not display their late response', async () => {
  let finish!: (value: unknown) => void;
  source.load.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce({ sourceSha256: 'b'.repeat(64), model });
  const view = render(<WorkbookSurface {...props} />), first = source.load.mock.calls[0]![3] as AbortSignal;
  source.viewer = 'person-two'; view.rerender(<WorkbookSurface {...props} />); expect(first.aborted).toBe(true);
  await screen.findByTestId('loaded-grid'); await act(async () => finish({ sourceSha256: 'a'.repeat(64), model }));
  expect(source.mounts).toBe(1);
  expect(vi.mocked(drafts.accessWorkbookRestore).mock.calls.every(([scope]) => scope.viewerId === 'person-two')).toBe(true);
  expect(source.lockNames.some(name => name.includes('person-two'))).toBe(true);
});
it('retries an uncertain read with its original operation and creates a fresh one after known expiry', async () => {
  source.load.mockRejectedValueOnce(new WorkbookHostError('Response lost')).mockRejectedValueOnce(new WorkbookHostError('Expired', 410)).mockResolvedValueOnce({ sourceSha256: 'a'.repeat(64), model });
  render(<WorkbookSurface {...props} />); await screen.findByRole('alert'); fireEvent.click(await screen.findByRole('button', { name: 'Retry loading workbook' }));
  await waitFor(() => expect(source.load).toHaveBeenCalledTimes(2));
  expect(source.load.mock.calls[1]![2]).toBe(source.load.mock.calls[0]![2]);
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Expired'));
  fireEvent.click(screen.getByRole('button', { name: 'Retry loading workbook' })); await screen.findByTestId('loaded-grid');
  expect(source.load.mock.calls[2]![2]).not.toBe(source.load.mock.calls[1]![2]);
});
