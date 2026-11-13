import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { IDBFactory, IDBKeyRange, IDBObjectStore } from 'fake-indexeddb';
import { accessWorkbookRestore, listWorkbookRestoreFileNames } from '../../src/components/embedded/workbook/draft-store';
const projectId = '18a8301a-b6e1-4001-8000-c967b1eab222';
const scope = { viewerId: 'person-one', projectId };
const intent = (fileName: string, owner = scope) => ({ version: 1 as const, ...owner, fileName, operationId: '18a8301a-b6e1-4001-8000-c967b1eab227', preparationId: '18a8301a-b6e1-4001-8000-c967b1eab226', sourceSha256: 'a'.repeat(64), versionSha256: 'b'.repeat(64), versionId: 'v1' });
beforeEach(() => { vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('IDBKeyRange', IDBKeyRange); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('discovers only scoped restore keys with bounded pagination and never reads any payload', async () => {
  for (const fileName of ['a.xlsx', 'b.xlsx', 'nested/c.xlsx']) await accessWorkbookRestore({ ...scope, fileName }, { expected: null, value: intent(fileName) });
  const foreign = [{ ...scope, viewerId: 'person-two' }, { ...scope, projectId: '18a8301a-b6e1-4001-8000-c967b1eab223' }];
  for (const owner of foreign) await accessWorkbookRestore({ ...owner, fileName: 'private.xlsx' }, { expected: null, value: intent('private.xlsx', owner) });
  const get = vi.spyOn(IDBObjectStore.prototype, 'get'), getAll = vi.spyOn(IDBObjectStore.prototype, 'getAll');
  const first = await listWorkbookRestoreFileNames(scope, { limit: 2 }); expect(first.fileNames).toEqual(['a.xlsx', 'b.xlsx']); expect(first.cursor).toBeTruthy();
  const second = await listWorkbookRestoreFileNames(scope, { limit: 2, cursor: first.cursor! }); expect(second).toEqual({ fileNames: ['nested/c.xlsx'], cursor: null });
  expect(get).not.toHaveBeenCalled(); expect(getAll).not.toHaveBeenCalled();
  await expect(listWorkbookRestoreFileNames(foreign[0]!, { cursor: first.cursor! })).rejects.toThrow('Invalid');
  await expect(listWorkbookRestoreFileNames(scope, { limit: 51 })).rejects.toThrow('Invalid');
});

it('discovers a pending CSV restore by scoped key without reading its identity payload', async () => {
  await accessWorkbookRestore({ ...scope, fileName: 'nested/literal.csv' }, { expected: null, value: intent('nested/literal.csv') });
  const get = vi.spyOn(IDBObjectStore.prototype, 'get');
  expect(await listWorkbookRestoreFileNames(scope)).toEqual({ fileNames: ['nested/literal.csv'], cursor: null });
  expect(get).not.toHaveBeenCalled();
});
