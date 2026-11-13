import type { WorkbookDocument } from '@open-design/contracts/runtime/workbook';
import type { IWorkbookData } from '@univerjs/presets';
import { gridWorkbook } from '../../src/components/embedded/workbook/grid-model';
import type { WorkbookCheckpoint } from '../../src/components/embedded/workbook/workbook-writer';

export function workbookRecoveryFixture(projectId: string, fileName: string): WorkbookCheckpoint {
  const model: WorkbookDocument = { version: 1, date1904: false, activeSheetId: 's', styles: [{}], features: { charts: 0, drawings: 0, externalLinks: 0, macros: false, signed: false }, sheets: [{ id: 's', name: 'Sheet', visibility: 'visible', rowCount: 100, columnCount: 26, cells: [], merges: [], rowDimensions: [], columnDimensions: [], frozenRows: 0, frozenColumns: 0 }] };
  const data = gridWorkbook(model, `${projectId}:${fileName}`, 'Forecast').data as IWorkbookData;
  return { version: 1, source: { sourceSha256: 'a'.repeat(64), model }, acknowledged: data, desired: structuredClone(data), pending: null };
}
