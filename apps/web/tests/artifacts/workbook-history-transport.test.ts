import { afterEach, expect, it, vi } from 'vitest';
import { workbookHostRequest } from '../../src/components/embedded/workbook/host-request';
import { listWorkbookHistory } from '../../src/components/embedded/workbook/history-transport';
vi.mock('../../src/components/embedded/workbook/host-request', async original => ({ ...await original<object>(), workbookHostRequest: vi.fn() }));
const request = vi.mocked(workbookHostRequest), projectId = '18a8301a-b6e1-4001-8000-c967b1eab222', fileName = 'reports/book.xlsx';
const version = { id: 'v1', fileName, version: 1, label: 'Saved', source: 'manual', createdAt: 1, size: 5, current: true, contentDigest: 'a'.repeat(64) };
const history = { projectId, fileName, versions: [version] };
afterEach(() => vi.resetAllMocks());
it('requests only passive scoped history and validates retained revision metadata', async () => {
  const controller = new AbortController(); request.mockResolvedValueOnce(history);
  expect(await listWorkbookHistory(projectId, fileName, controller.signal)).toEqual([version]);
  expect(request).toHaveBeenCalledExactlyOnceWith(projectId, { action: 'list-history', fileName }, controller.signal);
});
it('rejects foreign or malformed history without inventing restore operations', async () => {
  for (const bad of [{ ...history, projectId: crypto.randomUUID() }, { ...history, fileName: 'other.xlsx' }, { ...history, versions: [version, version] }, { ...history, versions: [{ ...version, contentDigest: 'wrong' }] }]) {
    request.mockResolvedValueOnce(bad); await expect(listWorkbookHistory(projectId, fileName)).rejects.toThrow();
  }
  expect(request.mock.calls.every(call => call[1].action === 'list-history')).toBe(true);
});
