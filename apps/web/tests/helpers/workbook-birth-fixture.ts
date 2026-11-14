import { ICommandService, IUndoRedoService, IUniverInstanceService, LocaleType, Univer, type IWorkbookData } from '@univerjs/core';
import { UniverSheetsPlugin } from '@univerjs/sheets';
import { FUniver } from '@univerjs/core/facade';
import '@univerjs/sheets/facade';
import English from '@univerjs/sheets/locale/en-US';
import type { WorkbookDocument } from '@open-design/contracts/runtime/workbook';
import { gridWorkbook } from '../../src/components/embedded/workbook/grid-model';
import { seedWorkbookStructureIdentity } from '../../src/components/embedded/workbook/grid-structure-identity';
import type { WorkbookCheckpoint } from '../../src/components/embedded/workbook/workbook-writer';

export const birthScope = { viewerId: 'birth-person', projectId: '52c04efa-93b7-49cc-8d9c-d19fd7e9cac7', fileName: 'Book.xlsx', draftId: '2874ed3d-7de0-4d21-b194-930201022428' };
export function createWorkbookBirthFixture(id = '1', rows = 100, additionalSheets: WorkbookDocument['sheets'] = []) {
  const univer = new Univer({ locale: LocaleType.EN_US, locales: { [LocaleType.EN_US]: English } });
  univer.registerPlugin(UniverSheetsPlugin);
  const api = FUniver.newAPI(univer);
  const model: WorkbookDocument = {
    version: 1, date1904: false, activeSheetId: id, styles: [{}],
    worksheetStructureEditable: true, worksheetMembershipEditable: true, calculationMetadata: 'verified',
    features: { charts: 0, drawings: 0, externalLinks: 0, macros: false, signed: false },
    sheets: [{ id, name: 'Existing', visibility: 'visible', rowCount: rows, columnCount: 26,
      cells: [{ row: 0, column: 0, kind: 'number', value: 12 }], merges: [],
      rowDimensions: [], columnDimensions: [], frozenRows: 0, frozenColumns: 0, arrayFormulas: [] }, ...structuredClone(additionalSheets)],
  };
  const source = { sourceSha256: 'a'.repeat(64), model };
  const initial = seedWorkbookStructureIdentity(gridWorkbook(model, `${birthScope.projectId}:${birthScope.fileName}`, 'Workbook').data as IWorkbookData, source.sourceSha256);
  const book = api.createWorkbook(initial);
  univer.__getInjector().get(IUniverInstanceService).focusUnit(book.getId());
  const checkpoint: WorkbookCheckpoint = { version: 1, source, acknowledged: book.save(), desired: book.save(), pending: null };
  return { univer, api, book, source, initial, checkpoint,
    commands: univer.__getInjector().get(ICommandService), history: univer.__getInjector().get(IUndoRedoService) };
}

