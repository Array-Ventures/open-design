import { afterEach, expect, it, vi } from 'vitest';
import { workbookHostRequest } from '../../src/components/embedded/workbook/host-request';
import { prepareWorkbookRestore } from '../../src/components/embedded/workbook/restore-transport';
vi.mock('../../src/components/embedded/workbook/host-request', async original => ({ ...await original<object>(), workbookHostRequest: vi.fn() }));
const projectId = '18a8301a-b6e1-4001-8000-c967b1eab222', id = '18a8301a-b6e1-4001-8000-c967b1eab223';
const input = { operationId: '18a8301a-b6e1-4001-8000-c967b1eab224', fileName: 'book.xlsx', versionId: 'v1', sourceSha256: 'a'.repeat(64), versionSha256: 'b'.repeat(64) };
const ready = { id, projectId, input: { fileName: input.fileName, format: 'xlsx' }, state: 'ready', error: null, output: { file: 'artifact.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', bytes: 5, sha256: input.versionSha256 } };
afterEach(() => vi.resetAllMocks());
it('prepares only the stable source-bound revision and validates its exact output identity', async () => {
  vi.mocked(workbookHostRequest).mockResolvedValueOnce(ready);
  expect(await prepareWorkbookRestore(projectId, input)).toEqual(ready);
  expect(workbookHostRequest).toHaveBeenCalledExactlyOnceWith(projectId, { action: 'prepare-restore', body: input }, undefined);
});
it('never admits a mismatched output or turns a failed preparation into an implicit write', async () => {
  for (const bad of [{ ...ready, output: { ...ready.output, sha256: input.sourceSha256 } }, { ...ready, input: { ...ready.input, fileName: 'other.xlsx' } }, { ...ready, state: 'failed', error: 'Unsupported workbook' }]) {
    vi.mocked(workbookHostRequest).mockResolvedValueOnce(bad); await expect(prepareWorkbookRestore(projectId, input)).rejects.toThrow();
  }
  expect(vi.mocked(workbookHostRequest).mock.calls.every(call => call[1].action === 'prepare-restore')).toBe(true);
});

it('recovers an admitted restore through its exact receipt without preparing or submitting again', async () => {
  const { restoreWorkbookVersion } = await import('../../src/components/embedded/workbook/restore-transport');
  const intent = { version: 1 as const, viewerId: 'human', projectId, fileName: input.fileName, operationId: input.operationId, preparationId: '18a8301a-b6e1-4001-8000-c967b1eab225', sourceSha256: input.sourceSha256, versionId: input.versionId, versionSha256: input.versionSha256 };
  const receipt = { id: intent.operationId, projectId, fileName: input.fileName, renderId: id, state: 'applied', sourceSha256: input.sourceSha256, targetSha256: input.versionSha256, actualSha256: input.versionSha256, versionId: 'restored-v2', restoreFromVersionId: intent.versionId };
  vi.mocked(workbookHostRequest).mockResolvedValueOnce(receipt);
  expect(await restoreWorkbookVersion(intent, vi.fn())).toEqual(receipt);
  expect(workbookHostRequest).toHaveBeenCalledExactlyOnceWith(projectId, { action: 'read-save', saveId: intent.operationId }, undefined);
});
it('protects the prepared identity before admitting an exact restore, retaining IDs after a lost acknowledgement', async () => {
  const { restoreWorkbookVersion } = await import('../../src/components/embedded/workbook/restore-transport');
  const { WorkbookHostError } = await import('../../src/components/embedded/workbook/host-request');
  const intent = { version: 1 as const, viewerId: 'human', projectId, fileName: input.fileName, operationId: input.operationId, preparationId: '18a8301a-b6e1-4001-8000-c967b1eab225', sourceSha256: input.sourceSha256, versionId: input.versionId, versionSha256: input.versionSha256, renderId: undefined as string | undefined };
  vi.mocked(workbookHostRequest).mockRejectedValueOnce(new WorkbookHostError('Missing', 404)).mockResolvedValueOnce(ready).mockRejectedValueOnce(Error('Connection lost'));
  const protectedIds: string[] = [];
  await expect(restoreWorkbookVersion(intent, async () => { protectedIds.push(intent.renderId!); })).rejects.toThrow('Connection lost');
  expect(protectedIds).toEqual([id]); expect(intent.renderId).toBe(id);
  const save = vi.mocked(workbookHostRequest).mock.calls.find(call => call[1].action === 'save');
  expect(save?.[1]).toEqual({ action: 'save', body: { operationId: intent.operationId, renderId: id } });
});
it('does not admit a restore when its identity cannot be protected or its receipt targets different bytes', async () => {
  const { restoreWorkbookVersion } = await import('../../src/components/embedded/workbook/restore-transport');
  const { WorkbookHostError } = await import('../../src/components/embedded/workbook/host-request');
  const intent = { version: 1 as const, viewerId: 'human', projectId, fileName: input.fileName, operationId: input.operationId, preparationId: '18a8301a-b6e1-4001-8000-c967b1eab225', sourceSha256: input.sourceSha256, versionId: input.versionId, versionSha256: input.versionSha256 };
  vi.mocked(workbookHostRequest).mockRejectedValueOnce(new WorkbookHostError('Missing', 404)).mockResolvedValueOnce(ready);
  await expect(restoreWorkbookVersion(intent, async () => { throw Error('Disk full'); })).rejects.toThrow('Disk full');
  expect(vi.mocked(workbookHostRequest).mock.calls.some(call => call[1].action === 'save')).toBe(false);
  vi.mocked(workbookHostRequest).mockResolvedValueOnce({ id: intent.operationId, projectId, fileName: input.fileName, renderId: id, state: 'applied', sourceSha256: input.sourceSha256, targetSha256: 'c'.repeat(64), actualSha256: 'c'.repeat(64), versionId: 'wrong' });
  await expect(restoreWorkbookVersion(intent, vi.fn())).rejects.toThrow('selected revision');
});

it('rejects missing or different restore lineage in every receipt state even when all hashes match', async () => {
  const { checkedWorkbookRestoreReceipt, WorkbookRestoreFinishedError } = await import('../../src/components/embedded/workbook/restore-transport');
  const intent = { version: 1 as const, viewerId: 'human', projectId, fileName: input.fileName, operationId: input.operationId, preparationId: '18a8301a-b6e1-4001-8000-c967b1eab225', sourceSha256: input.sourceSha256, versionId: input.versionId, versionSha256: input.versionSha256 };
  for (const state of ['pending', 'applied', 'conflict', 'cancelled']) {
    const receipt = { id: intent.operationId, projectId, fileName: input.fileName, renderId: id, state, sourceSha256: input.sourceSha256, targetSha256: input.versionSha256,
      actualSha256: state === 'applied' || state === 'conflict' ? input.versionSha256 : null, versionId: state === 'applied' ? 'restored-v2' : null };
    for (const lineage of [undefined, 'another-version']) {
      let failure: unknown;
      try { checkedWorkbookRestoreReceipt({ ...receipt, ...(lineage ? { restoreFromVersionId: lineage } : {}) }, intent); } catch (error) { failure = error; }
      expect(failure).toBeInstanceOf(Error);
      expect(failure).not.toBeInstanceOf(WorkbookRestoreFinishedError);
    }
    expect(checkedWorkbookRestoreReceipt({ ...receipt, restoreFromVersionId: input.versionId }, intent).restoreFromVersionId).toBe(input.versionId);
  }
});
