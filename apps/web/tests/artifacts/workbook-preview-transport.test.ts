import { beforeEach, expect, it, vi } from 'vitest';
import { workbookHostRequest, WorkbookHostError } from '../../src/components/embedded/workbook/host-request';
import { prepareWorkbookJob, WorkbookPreparationGoneError } from '../../src/components/embedded/workbook/preview-transport';
vi.mock('../../src/components/embedded/workbook/host-request', async importOriginal => ({ ...await importOriginal<object>(), workbookHostRequest: vi.fn() }));
const request = vi.mocked(workbookHostRequest);
const projectId = '18a8301a-b6e1-4001-8000-c967b1eab222', id = '18a8301a-b6e1-4001-8000-c967b1eab223', preparation = '18a8301a-b6e1-4001-8000-c967b1eab224';
const job = { id, projectId, input: { fileName: 'Forecast.xlsx', format: 'xlsx' }, state: 'deleted', error: null };
beforeEach(() => vi.resetAllMocks());
it('retains the validated exact deleted job identity from preparation replay', async () => {
  request.mockResolvedValueOnce(job);
  const failure = await prepareWorkbookJob(projectId, 'Forecast.xlsx', 'xlsx', preparation).catch(error => error);
  expect(failure).toBeInstanceOf(WorkbookPreparationGoneError); expect(failure.job).toEqual(job); expect(failure.status).toBe(410);
});
it('never turns unrelated identity, transport errors or other terminal states into tombstone evidence', async () => {
  for (const result of [{ ...job, projectId: id }, { ...job, input: { fileName: 'Other.xlsx', format: 'xlsx' } }, { ...job, state: 'failed' }, { ...job, state: 'cancelled' }]) {
    request.mockResolvedValueOnce(result);
    const failure = await prepareWorkbookJob(projectId, 'Forecast.xlsx', 'xlsx', preparation).catch(error => error);
    expect(failure).toBeInstanceOf(WorkbookHostError); expect(failure).not.toBeInstanceOf(WorkbookPreparationGoneError);
  }
  request.mockRejectedValueOnce(new WorkbookHostError('Gone', 410));
  await expect(prepareWorkbookJob(projectId, 'Forecast.xlsx', 'xlsx', preparation)).rejects.not.toBeInstanceOf(WorkbookPreparationGoneError);
});
