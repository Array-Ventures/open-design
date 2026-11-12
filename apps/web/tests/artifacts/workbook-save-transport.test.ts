import { beforeEach, expect, it, vi } from 'vitest';
import { WorkbookHostError, workbookHostRequest } from '../../src/components/embedded/workbook/host-request';
import { prepareWorkbookJob } from '../../src/components/embedded/workbook/preview-transport';
import { newWorkbookSaveAttempt, saveWorkbook } from '../../src/components/embedded/workbook/save-transport';
vi.mock('../../src/components/embedded/workbook/host-request', async importOriginal => ({ ...await importOriginal<object>(), workbookHostRequest: vi.fn() }));
vi.mock('../../src/components/embedded/workbook/preview-transport', async importOriginal => ({ ...await importOriginal<object>(), prepareWorkbookJob: vi.fn(), workbookPollDelay: vi.fn(async () => {}) }));
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
it('does not admit a prepared candidate until its render identity has been durably checkpointed', async () => {
  const intent = attempt(); request.mockRejectedValueOnce(new WorkbookHostError('Missing', 404));
  prepare.mockResolvedValueOnce({ id: renderId, projectId, input: { fileName, format: 'xlsx' }, state: 'ready', error: null });
  const checkpoint = vi.fn(async () => { expect(intent.renderId).toBe(renderId); throw new Error('Recovery storage unavailable'); });
  await expect(saveWorkbook(intent, undefined, checkpoint)).rejects.toThrow('Recovery storage unavailable');
  expect(request.mock.calls.map(call => call[1].action)).toEqual(['read-save']); expect(checkpoint).toHaveBeenCalledTimes(1);
});

function candidate(id = renderId, state: 'deleted' | 'ready' = 'deleted') { return { id, projectId, input: { fileName, format: 'xlsx' }, state, error: null }; }
it('reprepares only after a tombstone and a second absent receipt, persisting reset before new work', async () => {
  const intent = attempt(); intent.renderId = renderId; const operation = intent.operationId, preparation = intent.preparationId, frozen = structuredClone(intent.plan);
  const replacement = '18a8301a-b6e1-4001-8000-c967b1eab225';
  request.mockRejectedValueOnce(new WorkbookHostError('Missing', 404)).mockResolvedValueOnce(candidate()).mockRejectedValueOnce(new WorkbookHostError('Missing', 404)).mockResolvedValueOnce({ ...receipt(operation), renderId: replacement });
  const journal: Array<{ preparationId: string; renderId?: string }> = [];
  const checkpoint = vi.fn(async () => { journal.push({ preparationId: intent.preparationId, renderId: intent.renderId }); });
  prepare.mockImplementationOnce(async () => {
    expect(journal).toEqual([{ preparationId: intent.preparationId, renderId: undefined }]);
    expect(intent.preparationId).not.toBe(preparation); expect(intent.operationId).toBe(operation); expect(intent.plan).toEqual(frozen);
    return candidate(replacement, 'ready');
  });
  await expect(saveWorkbook(intent, undefined, checkpoint)).resolves.toMatchObject({ renderId: replacement, state: 'applied' });
  expect(request.mock.calls.map(call => call[1].action)).toEqual(['read-save', 'read-render', 'read-save', 'save']);
  expect(journal).toEqual([{ preparationId: intent.preparationId, renderId: undefined }, { preparationId: intent.preparationId, renderId: replacement }]);
  expect(request.mock.calls[3]?.[1]).toEqual({ action: 'save', body: { operationId: operation, renderId: replacement } });
});
it('recovers late admission after the first absent lookup without a second candidate or admission', async () => {
  const intent = attempt(); intent.renderId = renderId;
  request.mockRejectedValueOnce(new WorkbookHostError('Missing', 404)).mockResolvedValueOnce(candidate()).mockResolvedValueOnce(receipt(intent.operationId));
  await expect(saveWorkbook(intent, undefined, vi.fn())).resolves.toMatchObject({ state: 'applied' });
  expect(prepare).not.toHaveBeenCalled(); expect(request.mock.calls.map(call => call[1].action)).toEqual(['read-save', 'read-render', 'read-save']);
});
it('does not mistake a missing, inaccessible or mismatched candidate for a durable tombstone', async () => {
  for (const evidence of [new WorkbookHostError('Missing', 404), new WorkbookHostError('Gone', 410), new WorkbookHostError('Forbidden', 403), { ...candidate(), id: projectId }, { ...candidate(), input: { fileName: 'Other.xlsx', format: 'xlsx' } }, { ...candidate(), input: { fileName, format: 'pdf' } }, { ...candidate(), projectId: renderId }]) {
    request.mockReset(); prepare.mockReset(); const intent = attempt(); intent.renderId = renderId; const original = structuredClone(intent);
    request.mockRejectedValueOnce(new WorkbookHostError('Missing', 404));
    if (evidence instanceof Error) request.mockRejectedValueOnce(evidence); else request.mockResolvedValueOnce(evidence);
    await expect(saveWorkbook(intent, undefined, vi.fn())).rejects.toThrow(); expect(intent).toEqual(original); expect(prepare).not.toHaveBeenCalled();
  }
});
it('keeps the old attempt on failed reset persistence and refuses replacement without persistence support', async () => {
  const intent = attempt(); intent.renderId = renderId; const original = structuredClone(intent);
  for (const checkpoint of [undefined, vi.fn(async () => { throw Error('disk full'); })]) {
    request.mockRejectedValueOnce(new WorkbookHostError('Missing', 404)).mockResolvedValueOnce(candidate()).mockRejectedValueOnce(new WorkbookHostError('Missing', 404));
    await expect(saveWorkbook(intent, undefined, checkpoint)).rejects.toThrow(); expect(intent).toEqual(original); expect(prepare).not.toHaveBeenCalled();
  }
});
it('retains rotated preparation identity after uncertain replacement and recovers a lost new admission receipt', async () => {
  const intent = attempt(); intent.renderId = renderId; const operation = intent.operationId, originalPreparation = intent.preparationId;
  request.mockRejectedValueOnce(new WorkbookHostError('Missing', 404)).mockResolvedValueOnce(candidate()).mockRejectedValueOnce(new WorkbookHostError('Missing', 404));
  prepare.mockRejectedValueOnce(new WorkbookHostError('Preparation response lost'));
  await expect(saveWorkbook(intent, undefined, vi.fn(async () => {}))).rejects.toThrow('Preparation response lost');
  const rotated = intent.preparationId; expect(rotated).not.toBe(originalPreparation); expect(intent.renderId).toBeUndefined(); expect(intent.operationId).toBe(operation);
  const replacement = '18a8301a-b6e1-4001-8000-c967b1eab225';
  request.mockRejectedValueOnce(new WorkbookHostError('Missing', 404)).mockRejectedValueOnce(new WorkbookHostError('Admission response lost'));
  prepare.mockResolvedValueOnce(candidate(replacement, 'ready'));
  await expect(saveWorkbook(intent, undefined, vi.fn(async () => {}))).rejects.toThrow('Admission response lost');
  expect(prepare.mock.calls[1]?.[3]).toBe(rotated);
  request.mockResolvedValueOnce({ ...receipt(operation), renderId: replacement });
  await expect(saveWorkbook(intent, undefined, vi.fn())).resolves.toMatchObject({ state: 'applied', renderId: replacement });
  expect(prepare).toHaveBeenCalledTimes(2); expect(request.mock.calls.filter(call => call[1].action === 'save')).toHaveLength(1);
});
it('keeps a live candidate and refuses uncertain post-tombstone status instead of rotating', async () => {
  const intent = attempt(); intent.renderId = renderId; const preparation = intent.preparationId;
  request.mockRejectedValueOnce(new WorkbookHostError('Missing', 404)).mockResolvedValueOnce(candidate(renderId, 'ready')).mockResolvedValueOnce(receipt(intent.operationId));
  await expect(saveWorkbook(intent, undefined, vi.fn())).resolves.toMatchObject({ state: 'applied' });
  expect(intent.preparationId).toBe(preparation); expect(prepare).not.toHaveBeenCalled();
  for (const status of [0, 401, 403, 500]) {
    request.mockRejectedValueOnce(new WorkbookHostError('Missing', 404)).mockResolvedValueOnce(candidate()).mockRejectedValueOnce(new WorkbookHostError('Uncertain receipt', status));
    await expect(saveWorkbook(intent, undefined, vi.fn())).rejects.toThrow('Uncertain receipt');
    expect(intent.preparationId).toBe(preparation); expect(intent.renderId).toBe(renderId);
  }
});
