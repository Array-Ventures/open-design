// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import type { IWorkbookData } from '@univerjs/presets';
import type { WorkbookDocument } from '@open-design/contracts/runtime/workbook';
import { WorkbookSurface } from '../../../src/components/embedded/workbook/WorkbookSurface';
import { gridWorkbook } from '../../../src/components/embedded/workbook/grid-model';
import { WorkbookWriter } from '../../../src/components/embedded/workbook/workbook-writer';
import { WorkbookHostError } from '../../../src/components/embedded/workbook/host-request';
import * as drafts from '../../../src/components/embedded/workbook/draft-store';
const host = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../../../src/components/embedded/host-viewer', () => ({ useEmbeddedViewer: () => ({ memberId: 'person' }) }));
vi.mock('../../../src/components/embedded/workbook/host-request', async original => ({ ...await original<object>(), workbookHostRequest: host.request }));
vi.mock('../../../src/components/embedded/workbook/draft-store', async original => {
  const actual = await original<typeof import('../../../src/components/embedded/workbook/draft-store')>();
  return { ...actual, listWorkbookDrafts: vi.fn(actual.listWorkbookDrafts), readWorkbookDraft: vi.fn(actual.readWorkbookDraft) };
});
// The spreadsheet library is not under test here. Its absent mount on corrupt
// bytes and the guarded transition into draft recovery are the relevant seam.
vi.mock('../../../src/components/embedded/workbook/WorkbookGrid', () => ({ WorkbookGrid: () => <div>Recovered grid</div> }));
const projectId = '18a8301a-b6e1-4001-8000-c967b1eab222', fileName = 'book.xlsx';
const scope = { viewerId: 'person', projectId, fileName, draftId: '18a8301a-b6e1-4001-8000-c967b1eab229' };
const corruptSha = 'a'.repeat(64), restoredSha = 'b'.repeat(64);
const model: WorkbookDocument = { version: 1, date1904: false, activeSheetId: 's', styles: [{}], features: { charts: 0, drawings: 0, externalLinks: 0, macros: false, signed: false }, sheets: [{ id: 's', name: 'Sheet', visibility: 'visible', rowCount: 100, columnCount: 26, cells: [{ row: 0, column: 0, kind: 'number', value: 1 }], merges: [], rowDimensions: [], columnDimensions: [], frozenRows: 0, frozenColumns: 0 }] };
beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('navigator', { locks: { request: vi.fn((_name, _options, callback) => Promise.resolve(callback({ name: 'owned-fixture-lock' }))) } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.resetAllMocks(); vi.unstubAllGlobals(); });

it('uses real history/restore transports and protected storage to recover corrupt bytes while retaining an existing editable draft', async () => {
  const initial = gridWorkbook(model, `${projectId}:${fileName}`, 'Forecast').data as IWorkbookData;
  const writer = new WorkbookWriter({ sourceSha256: 'c'.repeat(64), model }, initial, vi.fn(), vi.fn());
  const edited = structuredClone(initial); edited.sheets.s!.cellData![0]![0]!.v = 98765; writer.update(edited);
  const checkpoint = writer.checkpoint(); await drafts.saveWorkbookDraft(scope, checkpoint);
  let currentSha = corruptSha;
  let receipt: object | null = null;
  const prepared = new Map<string, { id: string; projectId: string; input: { fileName: string; format: string }; state: string; error: string | null; output?: object }>();
  host.request.mockImplementation(async (_project, request) => {
    if (request.action === 'list-history') return { projectId, fileName, currentSha256: currentSha, versions: [{ id: 'immutable-v1', fileName, version: 1, label: 'Known good', createdAt: 1, source: 'manual', size: 100, current: currentSha === restoredSha, contentDigest: restoredSha }], nextCursor: null };
    if (request.action === 'read-save') { if (receipt) return receipt; throw new WorkbookHostError('No receipt', 404); }
    if (request.action === 'prepare') {
      const job = { id: request.body.operationId, projectId, input: { fileName, format: request.body.format }, state: currentSha === corruptSha ? 'failed' : 'ready', error: currentSha === corruptSha ? 'The current XLSX is corrupt.' : null };
      prepared.set(job.id, job); return job;
    }
    if (request.action === 'prepare-restore') {
      expect(request.body).toMatchObject({ fileName, sourceSha256: corruptSha, versionId: 'immutable-v1', versionSha256: restoredSha });
      const protectedIntent = await drafts.accessWorkbookRestore(scope);
      expect(protectedIntent).toMatchObject({ preparationId: request.body.operationId, sourceSha256: corruptSha, versionId: 'immutable-v1', versionSha256: restoredSha });
      const job = { id: request.body.operationId, projectId, input: { fileName, format: 'xlsx' }, state: 'ready', error: null,
        output: { file: 'artifact.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', bytes: 100, sha256: restoredSha } };
      prepared.set(job.id, job); return job;
    }
    if (request.action === 'save') {
      const protectedIntent = await drafts.accessWorkbookRestore(scope);
      expect(protectedIntent).toMatchObject({ operationId: request.body.operationId, renderId: request.body.renderId });
      currentSha = restoredSha;
      receipt = { id: request.body.operationId, projectId, fileName, renderId: request.body.renderId, state: 'applied', sourceSha256: corruptSha, targetSha256: restoredSha, actualSha256: restoredSha, versionId: 'new-v2', restoreFromVersionId: 'immutable-v1' }; return receipt;
    }
    if (request.action === 'read-preview') return { sourceSha256: currentSha, model };
    if (request.action === 'remove-render') return { ...prepared.get(request.renderId), state: 'deleted' };
    throw Error(`Unexpected fixture action ${request.action}`);
  });
  const post = vi.spyOn(window, 'postMessage');
  render(<WorkbookSurface projectId={projectId} fileName={fileName} title="Forecast" sourceStamp="corrupt-current" />);
  await screen.findByText('The current XLSX is corrupt.');
  await waitFor(() => expect(post.mock.calls.some(([message]) => message.type === 'studio:workbook-state' && !message.restoring)).toBe(true));
  expect(drafts.listWorkbookDrafts).not.toHaveBeenCalled(); expect(drafts.readWorkbookDraft).not.toHaveBeenCalled();
  const message = post.mock.calls.map(([value]) => value).filter(value => value.type === 'studio:workbook-state').at(-1)!;
  act(() => window.dispatchEvent(new MessageEvent('message', { source: window, origin: window.location.origin, data: { type: 'studio:workbook-control', projectId, controllerId: message.controllerId, action: 'history' } })));
  fireEvent.click(await screen.findByRole('button', { name: 'Version 1' }));
  expect(screen.getByText('Restore a saved version to recover this file. Local drafts are kept.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /^Restore$/ }));
  await screen.findByRole('heading', { name: 'Unsaved drafts' });
  expect(host.request.mock.calls.filter(([, request]) => request.action === 'save')).toHaveLength(1);
  expect(await drafts.accessWorkbookRestore(scope)).toBeNull();
  expect(await drafts.readWorkbookDraft(scope)).toEqual(checkpoint);
  expect((await drafts.listWorkbookDrafts(scope)).map(item => item.draftId)).toContain(scope.draftId);
});
