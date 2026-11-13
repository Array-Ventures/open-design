import { afterEach, expect, it, vi } from 'vitest';
import { workbookHostRequest } from '../../src/components/embedded/workbook/host-request';
import { cancelWorkbookSavePreparation } from '../../src/components/embedded/workbook/cancel-transport';
import type { WorkbookSaveAttempt } from '../../src/components/embedded/workbook/save-transport';
vi.mock('../../src/components/embedded/workbook/host-request', async original => ({ ...await original<object>(), workbookHostRequest: vi.fn() }));
const attempt: WorkbookSaveAttempt = { projectId: '18a8301a-b6e1-4001-8000-c967b1eab222', operationId: '18a8301a-b6e1-4001-8000-c967b1eab223', preparationId: '18a8301a-b6e1-4001-8000-c967b1eab224', fileName: 'book.xlsx', plan: { sourceSha256: 'a'.repeat(64), edits: [] } as unknown as WorkbookSaveAttempt['plan'] };
const proof = { state: 'unadmitted', projectId: attempt.projectId, operationId: attempt.operationId, preparationId: attempt.preparationId, fileName: attempt.fileName, sourceSha256: attempt.plan.sourceSha256, renderId: null };
afterEach(() => vi.resetAllMocks());
it('uses only explicit cancellation, including a lost initial preparation identity', async () => {
  vi.mocked(workbookHostRequest).mockResolvedValue(proof);
  expect(await cancelWorkbookSavePreparation(attempt)).toEqual(proof);
  expect(await cancelWorkbookSavePreparation(attempt)).toEqual(proof);
  expect(vi.mocked(workbookHostRequest).mock.calls.every(call => call[1].action === 'cancel-preparation')).toBe(true);
});
it('rejects wrong identities and generic errors without declaring the draft discardable', async () => {
  for (const bad of [{ ...proof, operationId: crypto.randomUUID() }, { ...proof, sourceSha256: 'b'.repeat(64) }, { ...proof, projectId: crypto.randomUUID() }, { ...proof, state: 'cancelled' }, { state: 'admitted', save: { state: 'cancelled' } }]) {
    vi.mocked(workbookHostRequest).mockResolvedValueOnce(bad); await expect(cancelWorkbookSavePreparation(attempt)).rejects.toThrow();
  }
});
it('keeps an admitted pending receipt distinct from a no-write proof', async () => {
  const save = { id: attempt.operationId, projectId: attempt.projectId, renderId: crypto.randomUUID(), fileName: attempt.fileName, sourceSha256: attempt.plan.sourceSha256, targetSha256: 'b'.repeat(64), actualSha256: null, versionId: null, state: 'pending' };
  vi.mocked(workbookHostRequest).mockResolvedValue({ state: 'admitted', save });
  const current = { ...attempt };
  expect(await cancelWorkbookSavePreparation(current)).toEqual({ state: 'admitted', save });
  expect(current.renderId).toBe(save.renderId);
});
it('rejects a late proof after Keep Editing aborts the cancellation', async () => {
  const controller = new AbortController();
  vi.mocked(workbookHostRequest).mockImplementation(async () => { controller.abort(); return proof; });
  await expect(cancelWorkbookSavePreparation(attempt, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
});
it('retains the entire frozen sheet plan in cancellation identity without stripping its projection', async () => {
  const current: WorkbookSaveAttempt = { ...attempt, plan: { ...attempt.plan, sheets: [{ sheetId: '1', name: 'Renamed', origin: 'source' }, { sheetId: '2', name: 'Fresh', origin: 'new' }] } };
  vi.mocked(workbookHostRequest).mockResolvedValue(proof);
  await cancelWorkbookSavePreparation(current);
  expect(workbookHostRequest).toHaveBeenCalledWith(current.projectId, { action: 'cancel-preparation', body: { operationId: current.operationId, preparationId: current.preparationId, fileName: current.fileName, workbookEditPlan: JSON.stringify(current.plan) } }, undefined);
});
