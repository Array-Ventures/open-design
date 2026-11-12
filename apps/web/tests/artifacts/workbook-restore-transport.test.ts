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
