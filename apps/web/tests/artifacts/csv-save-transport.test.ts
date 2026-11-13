import { beforeEach, expect, it, vi } from 'vitest';
import { workbookHostRequest, WorkbookHostError } from '../../src/components/embedded/workbook/host-request';
import { newWorkbookSaveAttempt, saveWorkbook } from '../../src/components/embedded/workbook/save-transport';
import { prepareWorkbookRestore } from '../../src/components/embedded/workbook/restore-transport';
vi.mock('../../src/components/embedded/workbook/host-request', async original => ({ ...await original<object>(), workbookHostRequest: vi.fn() }));
const request = vi.mocked(workbookHostRequest), projectId = '18a8301a-b6e1-4001-8000-c967b1eab222', renderId = '18a8301a-b6e1-4001-8000-c967b1eab223';
const source = 'a'.repeat(64), target = 'b'.repeat(64), fileName = 'literal.csv';
beforeEach(() => vi.clearAllMocks());
it('uses CSV preparation and reconciles an uncertain save by exact receipt without preparing twice', async () => {
  const intent = newWorkbookSaveAttempt(projectId, fileName, { sourceSha256: source, edits: [{ sheetId: 'csv', cell: { row: 0, column: 0, kind: 'string', value: '001' } }] });
  const receipt = { id: intent.operationId, projectId, renderId, fileName, state: 'applied', sourceSha256: source, targetSha256: target, actualSha256: target, versionId: 'v2' };
  request.mockRejectedValueOnce(new WorkbookHostError('Missing', 404)).mockResolvedValueOnce({ id: renderId, projectId, input: { fileName, format: 'csv' }, state: 'ready', error: null }).mockRejectedValueOnce(new WorkbookHostError('Lost acknowledgement'));
  await expect(saveWorkbook(intent)).rejects.toThrow('Lost acknowledgement');
  expect(request.mock.calls.find(([, input]) => input.action === 'prepare')?.[1]).toMatchObject({ action: 'prepare', body: { fileName, format: 'csv' } });
  request.mockResolvedValueOnce(receipt); await expect(saveWorkbook(intent)).resolves.toMatchObject({ state: 'applied' });
  expect(request.mock.calls.filter(([, input]) => input.action === 'prepare')).toHaveLength(1);
  expect(request.mock.calls.filter(([, input]) => input.action === 'save')).toHaveLength(1);
});
it('requires matching CSV restore output and permits an exact empty CSV revision', async () => {
  const input = { operationId: projectId, fileName, versionId: 'v1', versionSha256: target, sourceSha256: source };
  const job = { id: renderId, projectId, input: { fileName, format: 'csv' }, state: 'ready', error: null, output: { file: 'artifact.csv', mime: 'text/csv', bytes: 0, sha256: target } };
  request.mockResolvedValueOnce(job); await expect(prepareWorkbookRestore(projectId, input)).resolves.toEqual(job);
  for (const output of [{ ...job.output, file: 'artifact.xlsx' }, { ...job.output, mime: 'application/octet-stream' }, { ...job.output, sha256: source }]) {
    request.mockResolvedValueOnce({ ...job, output }); await expect(prepareWorkbookRestore(projectId, input)).rejects.toThrow();
  }
});
it('does not interpret access loss as an absent CSV operation or start a new preparation', async () => {
  const intent = newWorkbookSaveAttempt(projectId, fileName, { sourceSha256: source, edits: [] });
  request.mockRejectedValueOnce(new WorkbookHostError('Access denied', 403)); await expect(saveWorkbook(intent)).rejects.toThrow('Access denied');
  expect(request.mock.calls.map(([, input]) => input.action)).toEqual(['read-save']);
});
