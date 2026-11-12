// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import type { IWorkbookData } from '@univerjs/presets';
import type { WorkbookDocument } from '@open-design/contracts/runtime/workbook';
import { ArtifactSurface } from '../../../src/components/embedded/ArtifactSurface';
import type { Project } from '../../../src/types';
import { WorkbookSurface } from '../../../src/components/embedded/workbook/WorkbookSurface';
import { gridWorkbook } from '../../../src/components/embedded/workbook/grid-model';
import { WorkbookWriter } from '../../../src/components/embedded/workbook/workbook-writer';
import { WorkbookHostError } from '../../../src/components/embedded/workbook/host-request';
import * as drafts from '../../../src/components/embedded/workbook/draft-store';
const host = vi.hoisted(() => ({ request: vi.fn(), artifact: vi.fn() }));
vi.mock('../../../src/components/FileViewer', () => ({ FileViewer: () => <div>Other live artifact</div>, LiveArtifactViewer: () => <div>Other dashboard</div> }));
vi.mock('../../../src/components/embedded/document/DocumentSurface', () => ({ DocumentSurface: () => <div>Other document</div> }));
vi.mock('../../../src/components/embedded/useMotionTransport', () => ({ useMotionTransport: () => {} }));
vi.mock('../../../src/components/embedded/useArtifactHostState', async original => { const actual = await original<typeof import('../../../src/components/embedded/useArtifactHostState')>(); return { useArtifactHostState: vi.fn((...args: Parameters<typeof actual.useArtifactHostState>) => { host.artifact(...args); return actual.useArtifactHostState(...args); }) }; });
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
const baseScope = { viewerId: 'person', projectId, fileName, draftId: '18a8301a-b6e1-4001-8000-c967b1eab229' };
const corruptSha = 'a'.repeat(64), restoredSha = 'b'.repeat(64);
const baseModel: WorkbookDocument = { version: 1, date1904: false, activeSheetId: 's', styles: [{}], features: { charts: 0, drawings: 0, externalLinks: 0, macros: false, signed: false }, sheets: [{ id: 's', name: 'Sheet', visibility: 'visible', rowCount: 100, columnCount: 26, cells: [{ row: 0, column: 0, kind: 'number', value: 1 }], merges: [], rowDimensions: [], columnDimensions: [], frozenRows: 0, frozenColumns: 0 }] };
beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('IDBKeyRange', IDBKeyRange);
  vi.stubGlobal('navigator', { locks: { request: vi.fn((_name, _options, callback) => Promise.resolve(callback({ name: 'owned-fixture-lock' }))) } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.resetAllMocks(); vi.unstubAllGlobals(); });

it.each(['xlsx', 'csv'].flatMap(extension => [false, true, 'transient'].map(lostThenDeleted => ({ extension, lostThenDeleted }))))('recovers $extension through real transports while retaining drafts (lost acknowledgement then deleted file: $lostThenDeleted)', async ({ extension, lostThenDeleted }) => {
  const fileName = `book.${extension}`, scope = { ...baseScope, fileName }, model = structuredClone(baseModel);
  if (extension === 'csv') { model.sourceFormat = 'csv'; model.styles = [{ numberFormat: '@' }]; model.sheets[0]!.id = model.activeSheetId = 'csv'; model.sheets[0]!.cells = [{ row: 0, column: 0, kind: 'string', value: '001', style: 0 }]; }
  const initial = gridWorkbook(model, `${projectId}:${fileName}`, 'Forecast').data as IWorkbookData;
  const writer = new WorkbookWriter({ sourceSha256: 'c'.repeat(64), model }, initial, vi.fn(), vi.fn());
  const edited = structuredClone(initial); edited.sheets[model.activeSheetId]!.cellData![0]![0]!.v = extension === 'csv' ? '98765' : 98765; writer.update(edited);
  const checkpoint = writer.checkpoint(); await drafts.saveWorkbookDraft(scope, checkpoint);
  let currentSha: string | null = corruptSha;
  let receipt: object | null = null, failRecoveryOnce = false;
  const prepared = new Map<string, { id: string; projectId: string; input: { fileName: string; format: string }; state: string; error: string | null; output?: object }>();
  host.request.mockImplementation(async (_project, request) => {
    if (request.action === 'list-history' && failRecoveryOnce) { failRecoveryOnce = false; throw new WorkbookHostError('Temporary history outage'); }
    if (request.action === 'list-history') return { projectId, fileName, currentSha256: currentSha, versions: [{ id: 'immutable-v1', fileName, version: 1, label: 'Known good', createdAt: 1, source: 'manual', size: 100, current: currentSha === restoredSha, contentDigest: restoredSha }], nextCursor: null };
    if (request.action === 'read-save') { if (receipt) return receipt; throw new WorkbookHostError('No receipt', 404); }
    if (request.action === 'prepare') {
      if (currentSha === null) throw new WorkbookHostError('The working file is missing.', 404);
      const job = { id: request.body.operationId, projectId, input: { fileName, format: request.body.format }, state: currentSha === corruptSha ? 'failed' : 'ready', error: currentSha === corruptSha ? 'The current XLSX is corrupt.' : null };
      prepared.set(job.id, job); return job;
    }
    if (request.action === 'prepare-restore') {
      expect(request.body).toMatchObject({ fileName, sourceSha256: corruptSha, versionId: 'immutable-v1', versionSha256: restoredSha });
      const protectedIntent = await drafts.accessWorkbookRestore(scope);
      expect(protectedIntent).toMatchObject({ preparationId: request.body.operationId, sourceSha256: corruptSha, versionId: 'immutable-v1', versionSha256: restoredSha });
      const job = { id: request.body.operationId, projectId, input: { fileName, format: extension }, state: 'ready', error: null,
        output: { file: `artifact.${extension}`, mime: extension === 'csv' ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', bytes: 100, sha256: restoredSha } };
      prepared.set(job.id, job); return job;
    }
    if (request.action === 'save') {
      const protectedIntent = await drafts.accessWorkbookRestore(scope);
      expect(protectedIntent).toMatchObject({ operationId: request.body.operationId, renderId: request.body.renderId });
      currentSha = lostThenDeleted ? null : restoredSha;
      receipt = { id: request.body.operationId, projectId, fileName, renderId: request.body.renderId, state: 'applied', sourceSha256: corruptSha, targetSha256: restoredSha, actualSha256: restoredSha, versionId: 'new-v2', restoreFromVersionId: 'immutable-v1' };
      if (lostThenDeleted) throw new WorkbookHostError('Lost restore acknowledgement.');
      return receipt;
    }
    if (request.action === 'read-preview') return { sourceSha256: currentSha, model };
    if (request.action === 'remove-render') return { ...prepared.get(request.renderId), state: 'deleted' };
    throw Error(`Unexpected fixture action ${request.action}`);
  });
  const post = vi.spyOn(window, 'postMessage');
  render(<WorkbookSurface projectId={projectId} fileName={fileName} title="Forecast" sourceStamp="corrupt-current" />);
  await screen.findByText('The current XLSX is corrupt.');
  expect(await screen.findByRole('button', { name: 'Retry loading workbook' })).toBeTruthy();
  await waitFor(() => expect(post.mock.calls.some(([message]) => message.type === 'studio:workbook-state' && !message.restoring)).toBe(true));
  expect(drafts.listWorkbookDrafts).not.toHaveBeenCalled(); expect(drafts.readWorkbookDraft).not.toHaveBeenCalled();
  const message = post.mock.calls.map(([value]) => value).filter(value => value.type === 'studio:workbook-state').at(-1)!;
  act(() => window.dispatchEvent(new MessageEvent('message', { source: window, origin: window.location.origin, data: { type: 'studio:workbook-control', projectId, controllerId: message.controllerId, action: 'history' } })));
  fireEvent.click(await screen.findByRole('button', { name: 'Version 1' }));
  expect(screen.queryByRole('button', { name: 'Retry loading workbook' })).toBeNull();
  expect(screen.getByText('Restore a saved version to recover this file. Local drafts are kept.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /^Restore$/ }));
  if (lostThenDeleted) {
    await screen.findByText('Lost restore acknowledgement.');
    expect(screen.queryByRole('button', { name: 'Retry loading workbook' })).toBeNull();
    const protectedIntent = await drafts.accessWorkbookRestore(scope); expect(protectedIntent).not.toBeNull();
    cleanup();
    const reloadedAt = host.request.mock.calls.length; failRecoveryOnce = lostThenDeleted === 'transient';
    render(<ArtifactSurface project={{ id: projectId, name: 'Forecast', metadata: { embeddedArtifactKind: 'workbook' } } as Project} files={[]} dashboards={[]} fileName={null} generation={2} onRefresh={async () => {}} feedback={{}} />);
    if (lostThenDeleted === 'transient') {
      const retry = await screen.findByRole('button', { name: 'Retry workbook recovery' });
      expect(screen.queryByRole('button', { name: `Open restore status for ${fileName}` })).toBeNull();
      expect(await drafts.accessWorkbookRestore(scope)).toEqual(protectedIntent);
      fireEvent.click(retry);
    }
    fireEvent.click(await screen.findByRole('button', { name: `Open restore status for ${fileName}` }));
    expect(screen.queryByText('Agent is cooking')).toBeNull();
    const check = await screen.findByRole('button', { name: 'Check status' });
    expect(check.hasAttribute('disabled')).toBe(false);
    expect(host.request.mock.calls.slice(reloadedAt).every(([, request]) => request.action === 'list-history')).toBe(true);
    expect(host.artifact).toHaveBeenLastCalledWith(projectId, null, false);
    const callsBeforeCheck = host.request.mock.calls.length;
    fireEvent.click(check);
    const completion = 'The restore completed, but the current file is now missing. It was not recreated.';
    const notice = await screen.findByText(completion);
    expect(notice.getAttribute('role')).toBe('status');
    expect(screen.getAllByText(completion)).toHaveLength(1);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText('The current workbook is missing. History restore will not recreate it.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close workbook history' }));
    expect(screen.getAllByText(completion)).toHaveLength(1);
    expect(screen.getByText(completion).getAttribute('role')).toBe('status');
    expect(host.request.mock.calls.slice(callsBeforeCheck).every(([, request]) => ['read-save', 'list-history'].includes(request.action))).toBe(true);
    expect(drafts.listWorkbookDrafts).not.toHaveBeenCalled(); expect(drafts.readWorkbookDraft).not.toHaveBeenCalled();
  } else await screen.findByRole('heading', { name: 'Unsaved drafts' });
  expect(host.request.mock.calls.filter(([, request]) => request.action === 'save')).toHaveLength(1);
  expect(await drafts.accessWorkbookRestore(scope)).toBeNull();
  expect(await drafts.readWorkbookDraft(scope)).toEqual(checkpoint);
  expect((await drafts.listWorkbookDrafts(scope)).map(item => item.draftId)).toContain(scope.draftId);
});
