import { beforeEach, expect, it, vi } from 'vitest';
import { WorkbookHostError, workbookHostRequest } from '../../src/components/embedded/workbook/host-request';
import { prepareWorkbookJob } from '../../src/components/embedded/workbook/preview-transport';
import { newWorkbookSaveAttempt, saveWorkbook } from '../../src/components/embedded/workbook/save-transport';
vi.mock('../../src/components/embedded/workbook/host-request', async importOriginal => ({ ...await importOriginal<object>(), workbookHostRequest: vi.fn() }));
vi.mock('../../src/components/embedded/workbook/preview-transport', () => ({ prepareWorkbookJob: vi.fn(), workbookPollDelay: vi.fn(async () => {}) }));
const projectId = '18a8301a-b6e1-4001-8000-c967b1eab222', renderId = '18a8301a-b6e1-4001-8000-c967b1eab223';
const source = 'a'.repeat(64), target = 'b'.repeat(64), fileName = 'Forecast.xlsx';
const request = vi.mocked(workbookHostRequest), prepare = vi.mocked(prepareWorkbookJob);
function attempt() { return newWorkbookSaveAttempt(projectId, fileName, { sourceSha256: source, edits: [{ sheetId: 's1', cell: { row: 0, column: 0, kind: 'number', value: 20 } }] }); }
function receipt(id: string, state = 'applied') { return { id, projectId, renderId, fileName, state, sourceSha256: source, targetSha256: target, actualSha256: state === 'applied' ? target : null, versionId: state === 'applied' ? 'v2' : null }; }
beforeEach(() => { vi.clearAllMocks(); });
it('probes status before preparing once and waits for the durable applied receipt', async () => {
  const intent = attempt(); request.mockRejectedValueOnce(new WorkbookHostError('Missing', 404)).mockResolvedValueOnce(receipt(intent.operationId, 'pending')).mockResolvedValueOnce(receipt(intent.operationId));
  prepare.mockResolvedValueOnce({ id: renderId, projectId, input: { fileName, format: 'xlsx' }, state: 'ready', error: null });
  expect(await saveWorkbook(intent)).toMatchObject({ state: 'applied', targetSha256: target });
  expect(prepare).toHaveBeenCalledWith(projectId, fileName, 'xlsx', intent.preparationId, undefined, JSON.stringify(intent.plan));
  expect(request.mock.calls.map(call => call[1].action)).toEqual(['read-save', 'save', 'read-save']);
});
it('recovers a lost admission response by status without preparing or writing again', async () => {
  const intent = attempt(); request.mockRejectedValueOnce(new WorkbookHostError('Missing', 404)).mockRejectedValueOnce(new WorkbookHostError('Timeout'));
  prepare.mockResolvedValueOnce({ id: renderId, projectId, input: { fileName, format: 'xlsx' }, state: 'ready', error: null });
  await expect(saveWorkbook(intent)).rejects.toThrow('Timeout');
  request.mockResolvedValueOnce(receipt(intent.operationId));
  await expect(saveWorkbook(intent)).resolves.toMatchObject({ state: 'applied' });
  expect(prepare).toHaveBeenCalledTimes(1); expect(request.mock.calls.filter(call => call[1].action === 'save')).toHaveLength(1);
});
it('retains preparation identity when preparation itself has an uncertain result', async () => {
  const intent = attempt(); request.mockRejectedValue(new WorkbookHostError('Missing', 404)); prepare.mockRejectedValue(new WorkbookHostError('Timeout'));
  await expect(saveWorkbook(intent)).rejects.toThrow('Timeout'); await expect(saveWorkbook(intent)).rejects.toThrow('Timeout');
  expect(prepare.mock.calls[0]?.[3]).toBe(prepare.mock.calls[1]?.[3]);
});
it('does not treat access or transport failures as an absent operation', async () => {
  for (const status of [0, 401, 403, 500]) { request.mockRejectedValueOnce(new WorkbookHostError('Unavailable', status)); await expect(saveWorkbook(attempt())).rejects.toThrow('Unavailable'); }
  expect(prepare).not.toHaveBeenCalled();
});
it('refuses a mismatched or inconsistent receipt and retains conflicts as explicit errors', async () => {
  const intent = attempt();
  for (const bad of [{ ...receipt(intent.operationId), sourceSha256: target }, { ...receipt(intent.operationId), fileName: 'Other.xlsx' }, { ...receipt(intent.operationId), actualSha256: source }]) {
    request.mockResolvedValueOnce(bad); await expect(saveWorkbook(intent)).rejects.toThrow('identity');
  }
  request.mockResolvedValueOnce(receipt(intent.operationId, 'conflict')); await expect(saveWorkbook(intent)).rejects.toMatchObject({ status: 409 });
  expect(prepare).not.toHaveBeenCalled();
});
it('resumes a pending save on retry and forwards cancellation without starting another preparation', async () => {
  const intent = attempt(), controller = new AbortController();
  request.mockResolvedValueOnce(receipt(intent.operationId, 'pending')).mockRejectedValueOnce(new DOMException('Aborted', 'AbortError'));
  await expect(saveWorkbook(intent, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(request).toHaveBeenNthCalledWith(2, projectId, { action: 'read-save', saveId: intent.operationId }, controller.signal);
  request.mockResolvedValueOnce(receipt(intent.operationId)); await expect(saveWorkbook(intent)).resolves.toMatchObject({ state: 'applied' });
  expect(prepare).not.toHaveBeenCalled(); expect(request.mock.calls.every(call => call[1].action === 'read-save')).toBe(true);
});
it('refuses a different render identity after an attempt has been bound to its candidate', async () => {
  const intent = attempt(); intent.renderId = renderId;
  request.mockResolvedValueOnce({ ...receipt(intent.operationId), renderId: projectId });
  await expect(saveWorkbook(intent)).rejects.toThrow('identity'); expect(intent.renderId).toBe(renderId);
  request.mockResolvedValueOnce(receipt(intent.operationId, 'cancelled'));
  await expect(saveWorkbook(intent)).rejects.toMatchObject({ status: 410 });
});
