import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import type { IWorkbookData } from '@univerjs/presets';
import type { WorkbookDocument } from '@open-design/contracts/runtime/workbook';
import { gridWorkbook } from '../../src/components/embedded/workbook/grid-model';
import { WorkbookWriter, type WorkbookCheckpoint } from '../../src/components/embedded/workbook/workbook-writer';
import { readWorkbookDraft, saveWorkbookDraft, listWorkbookDrafts, WORKBOOK_DRAFT_DATABASE } from '../../src/components/embedded/workbook/draft-store';
import { workbookDraftKey, decodeWorkbookDraft, encodeWorkbookDraft } from '../../src/components/embedded/workbook/workbook-checkpoint';

const scope = { viewerId: 'person-one', projectId: '18a8301a-b6e1-4001-8000-c967b1eab222', fileName: 'Forecast.xlsx', draftId: '18a8301a-b6e1-4001-8000-c967b1eab224' };
function fixture() {
  const model: WorkbookDocument = { version: 1, date1904: false, activeSheetId: 's', styles: [{}], features: { charts: 0, drawings: 0, externalLinks: 0, macros: false, signed: false }, sheets: [{ id: 's', name: 'Sheet', visibility: 'visible', rowCount: 100, columnCount: 26, cells: [{ row: 0, column: 0, kind: 'number', value: 1 }], merges: [], rowDimensions: [], columnDimensions: [], frozenRows: 0, frozenColumns: 0 }] };
  const initial = gridWorkbook(model, `${scope.projectId}:${scope.fileName}`, 'Forecast').data as IWorkbookData;
  const writer = new WorkbookWriter({ sourceSha256: 'a'.repeat(64), model }, initial, vi.fn(), () => {});
  const changed = structuredClone(initial); changed.sheets.s!.cellData![0]![0]!.v = 2; writer.update(changed);
  return { writer, checkpoint: writer.checkpoint() };
}
beforeEach(() => vi.stubGlobal('indexedDB', new IDBFactory()));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('restores the exact draft across separate database connections and separates people, projects and files', async () => {
  const { checkpoint } = fixture(); await saveWorkbookDraft(scope, checkpoint);
  expect(await readWorkbookDraft(scope)).toEqual(checkpoint);
  for (const other of [{ ...scope, viewerId: 'person-two' }, { ...scope, projectId: '18a8301a-b6e1-4001-8000-c967b1eab223' }, { ...scope, fileName: 'Other.xlsx' }]) expect(await readWorkbookDraft(other)).toBeNull();
  await saveWorkbookDraft(scope, null); expect(await readWorkbookDraft(scope)).toBeNull();
});
it('rejects a mismatched account or grid identity without deleting the original draft', async () => {
  const { checkpoint } = fixture(); await saveWorkbookDraft(scope, checkpoint);
  expect(() => decodeWorkbookDraft(encodeWorkbookDraft(scope, checkpoint), { ...scope, viewerId: 'person-two' })).toThrow('another account');
  const invalid = structuredClone(checkpoint); invalid.desired.id = 'wrong-grid';
  await expect(saveWorkbookDraft(scope, invalid)).rejects.toThrow('identity'); expect(await readWorkbookDraft(scope)).toEqual(checkpoint);
});
it('preserves an uncertain save identity and refuses a plan that differs from its frozen snapshot', async () => {
  const { writer } = fixture(); const pending: { value: WorkbookCheckpoint | null } = { value: null };
  const protectedWriter = new WorkbookWriter(writer.checkpoint().source, writer.checkpoint().acknowledged, async () => { throw new Error('Response lost'); }, () => {}, undefined, { save: async value => { pending.value = value; if (value) await saveWorkbookDraft(scope, value); } });
  protectedWriter.update(writer.recoveredSnapshot()); await protectedWriter.flush();
  const restored = await readWorkbookDraft(scope); expect(restored?.pending?.intent).toEqual(pending.value?.pending?.intent);
  const invalid = structuredClone(restored!); invalid.pending!.intent.plan.edits[0]!.cell.value = 99;
  await expect(saveWorkbookDraft(scope, invalid)).rejects.toThrow('does not match'); expect((await readWorkbookDraft(scope))?.pending?.intent).toEqual(restored?.pending?.intent);
});
it('leaves corrupt stored records intact for explicit recovery instead of silently replacing them', async () => {
  const request = indexedDB.open(WORKBOOK_DRAFT_DATABASE, 1);
  request.onupgradeneeded = () => request.result.createObjectStore('workbooks');
  const database = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  await new Promise<void>((resolve, reject) => { const tx = database.transaction('workbooks', 'readwrite'); tx.objectStore('workbooks').put('{broken json', workbookDraftKey(scope)); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); }); database.close();
  await expect(readWorkbookDraft(scope)).rejects.toThrow(); await expect(readWorkbookDraft(scope)).rejects.toThrow();
});
it('reports unavailable storage instead of claiming that a draft was protected', async () => {
  vi.stubGlobal('indexedDB', undefined); await expect(saveWorkbookDraft(scope, fixture().checkpoint)).rejects.toThrow();
});

it('keeps independent tabs as separate recoverable drafts and deletes only the acknowledged one', async () => {
  const { checkpoint } = fixture(), other = { ...scope, draftId: '18a8301a-b6e1-4001-8000-c967b1eab225' };
  await saveWorkbookDraft(scope, checkpoint); await saveWorkbookDraft(other, checkpoint);
  expect(await listWorkbookDrafts(scope)).toHaveLength(2);
  expect(await listWorkbookDrafts({ ...scope, viewerId: 'person-two' })).toEqual([]);
  await saveWorkbookDraft(scope, null); expect(await listWorkbookDrafts(scope)).toHaveLength(1); expect(await readWorkbookDraft(other)).toEqual(checkpoint);
});
it('commits the recovery index and draft bytes atomically when a write throws synchronously', async () => {
  const put = IDBObjectStore.prototype.put;
  const failing = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
    if (this.name === 'workbooks') throw new DOMException('Cannot clone fixture', 'DataCloneError');
    return put.call(this, value, key);
  });
  await expect(saveWorkbookDraft(scope, fixture().checkpoint)).rejects.toThrow(); failing.mockRestore();
  expect(await readWorkbookDraft(scope)).toBeNull(); expect(await listWorkbookDrafts(scope)).toEqual([]);
});

it('refuses invalid coordinates and inconsistent sheet identities before replacing an existing draft', async () => {
  const { checkpoint } = fixture(); await saveWorkbookDraft(scope, checkpoint);
  for (const mutate of [
    (value: WorkbookCheckpoint) => { value.desired.sheets.s!.cellData![100] = { 0: { v: 99 } }; },
    (value: WorkbookCheckpoint) => { value.desired.sheets.s!.id = 'different'; },
    (value: WorkbookCheckpoint) => { value.desired.sheetOrder.push('s'); },
  ]) {
    const changed = structuredClone(checkpoint); mutate(changed); await expect(saveWorkbookDraft(scope, changed)).rejects.toThrow();
  }
  expect(await readWorkbookDraft(scope)).toEqual(checkpoint);
});

it('keeps a restore identity account-scoped and compare-and-set without altering editable drafts', async () => {
  const { accessWorkbookRestore } = await import('../../src/components/embedded/workbook/draft-store');
  const { checkpoint } = fixture(); await saveWorkbookDraft(scope, checkpoint);
  const intent = { version: 1 as const, viewerId: scope.viewerId, projectId: scope.projectId, fileName: scope.fileName, operationId: '18a8301a-b6e1-4001-8000-c967b1eab229', preparationId: '18a8301a-b6e1-4001-8000-c967b1eab228', versionId: 'v1', sourceSha256: 'a'.repeat(64), versionSha256: 'b'.repeat(64) };
  await accessWorkbookRestore(scope, { expected: null, value: intent });
  expect(await accessWorkbookRestore(scope)).toEqual(intent);
  expect(await accessWorkbookRestore({ ...scope, viewerId: 'another' })).toBeNull();
  await expect(accessWorkbookRestore(scope, { expected: null, value: { ...intent, operationId: '18a8301a-b6e1-4001-8000-c967b1eab227' } })).rejects.toThrow('unresolved');
  await expect(accessWorkbookRestore(scope, { expected: 'wrong', value: null })).rejects.toThrow('unresolved');
  expect(await readWorkbookDraft(scope)).toEqual(checkpoint);
  await accessWorkbookRestore(scope, { expected: intent.operationId, value: null });
  expect(await accessWorkbookRestore(scope)).toBeNull(); expect(await readWorkbookDraft(scope)).toEqual(checkpoint);
});
