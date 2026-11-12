// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import type { IWorkbookData } from '@univerjs/presets';
import type { WorkbookDocument } from '@open-design/contracts/runtime/workbook';
import { gridWorkbook } from '../../src/components/embedded/workbook/grid-model';
import { downloadWorkbookDraft } from '../../src/components/embedded/workbook/download-draft';
import type { WorkbookCheckpoint } from '../../src/components/embedded/workbook/workbook-writer';
const scope = { viewerId: 'evebot:person', projectId: '66a28381-a8cf-40cd-91d2-b1f9cd696ac0', fileName: 'Reports/Forecast.xlsx', draftId: '66a28381-a8cf-40cd-91d2-b1f9cd696ac1' };
function checkpoint(): WorkbookCheckpoint {
  const model: WorkbookDocument = { version: 1, date1904: false, activeSheetId: 's', styles: [{}], features: { charts: 0, drawings: 0, externalLinks: 0, macros: false, signed: false }, sheets: [{ id: 's', name: 'Sheet', visibility: 'visible', rowCount: 100, columnCount: 26, cells: [], merges: [], rowDimensions: [], columnDimensions: [], frozenRows: 0, frozenColumns: 0 }] };
  const data = gridWorkbook(model, `${scope.projectId}:${scope.fileName}`, 'Forecast').data as IWorkbookData;
  return { version: 1, source: { sourceSha256: 'a'.repeat(64), model }, acknowledged: data, desired: structuredClone(data), pending: null };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
it('downloads validated recovery JSON with a safe explicit filename and releases its object URL', async () => {
  vi.useFakeTimers(); const create = vi.fn((_blob: Blob) => 'blob:recovery'), revoke = vi.fn();
  vi.stubGlobal('URL', class extends URL { static createObjectURL = create; static revokeObjectURL = revoke; });
  const clicked: HTMLAnchorElement[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clicked.push(this); });
  downloadWorkbookDraft(scope, checkpoint());
  expect(create).toHaveBeenCalledOnce(); const blob = create.mock.calls[0]?.[0] as Blob;
  expect(blob.type).toBe('application/json'); expect(blob.size).toBeGreaterThan(100);
  expect(clicked[0]?.download).toBe('Reports-Forecast.xlsx.recovery.json'); expect(clicked[0]?.isConnected).toBe(false);
  expect(revoke).not.toHaveBeenCalled(); await vi.runAllTimersAsync(); expect(revoke).toHaveBeenCalledWith('blob:recovery');
});
it('refuses an inconsistent draft before exposing any download bytes', () => {
  const create = vi.fn(); vi.stubGlobal('URL', class extends URL { static createObjectURL = create; });
  const state = checkpoint(); state.desired.id = 'different-artifact';
  expect(() => downloadWorkbookDraft(scope, state)).toThrow('identity'); expect(create).not.toHaveBeenCalled();
});
