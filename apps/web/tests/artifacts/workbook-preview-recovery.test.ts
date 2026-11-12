import { beforeEach, expect, it, vi } from 'vitest';
import { WorkbookHostError, workbookHostRequest } from '../../src/components/embedded/workbook/host-request';
import { loadWorkbookPreview } from '../../src/components/embedded/workbook/preview-transport';
vi.mock('../../src/components/embedded/workbook/host-request', async original => ({ ...await original<object>(), workbookHostRequest: vi.fn() }));
const request = vi.mocked(workbookHostRequest), projectId = '18a8301a-b6e1-4001-8000-c967b1eab222', renderId = '18a8301a-b6e1-4001-8000-c967b1eab223', operationId = '18a8301a-b6e1-4001-8000-c967b1eab224';
const job = { id: renderId, projectId, state: 'ready', error: null, input: { fileName: 'Book.xlsx', format: 'workbook' } };
const preview = { sourceSha256: 'a'.repeat(64), model: { version: 1, date1904: false, activeSheetId: 's', styles: [{}], features: { charts: 0, drawings: 0, externalLinks: 0, macros: false, signed: false }, sheets: [{ id: 's', name: 'Sheet', visibility: 'visible', rowCount: 100, columnCount: 26, cells: [], merges: [], rowDimensions: [], columnDimensions: [], frozenRows: 0, frozenColumns: 0 }] } };
beforeEach(() => vi.resetAllMocks());
it('does not destroy a ready preview after an uncertain read and can recover with the same preparation identity', async () => {
  request.mockResolvedValueOnce(job).mockRejectedValueOnce(new WorkbookHostError('Response lost'));
  await expect(loadWorkbookPreview(projectId, 'Book.xlsx', operationId)).rejects.toThrow('Response lost');
  expect(request.mock.calls.map(call => call[1].action)).toEqual(['prepare', 'read-preview']);
  request.mockResolvedValueOnce(job).mockResolvedValueOnce(preview).mockResolvedValueOnce({});
  await expect(loadWorkbookPreview(projectId, 'Book.xlsx', operationId)).resolves.toEqual(preview);
  expect(request).toHaveBeenLastCalledWith(projectId, { action: 'remove-render', renderId });
  expect(request.mock.calls[0]![1]).toEqual(request.mock.calls[2]![1]);
});
it('retains invalid output for bounded expiry and never returns an unvalidated model', async () => {
  request.mockResolvedValueOnce(job).mockResolvedValueOnce({ ...preview, model: {} });
  await expect(loadWorkbookPreview(projectId, 'Book.xlsx', operationId)).rejects.toMatchObject({ status: 422 });
  expect(request.mock.calls.map(call => call[1].action)).toEqual(['prepare', 'read-preview']);
});
