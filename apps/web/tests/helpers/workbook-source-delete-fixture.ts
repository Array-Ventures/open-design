import { CommandType, ICommandService, IUndoRedoService, IUniverInstanceService, LocaleType, Univer, type IWorkbookData } from '@univerjs/core';
import { UniverSheetsPlugin } from '@univerjs/sheets';
import { UniverFormulaEnginePlugin } from '@univerjs/engine-formula';
import { CalculationMode, UniverSheetsFormulaPlugin } from '@univerjs/sheets-formula';
import { FUniver } from '@univerjs/core/facade';
import '@univerjs/sheets/facade';
import English from '@univerjs/sheets/locale/en-US';
import type { WorkbookDocument } from '@open-design/contracts/runtime/workbook';
import { gridWorkbook } from '../../src/components/embedded/workbook/grid-model';
import { seedWorkbookStructureIdentity } from '../../src/components/embedded/workbook/grid-structure-identity';
import { WorkbookWriter, type WorkbookCheckpoint, type WorkbookWriteIntent, type WorkbookWriteResult } from '../../src/components/embedded/workbook/workbook-writer';
import { WorkbookSheetHistoryController } from '../../src/components/embedded/workbook/sheet-history-controller';
import { serializeWorkbookDraft } from '../../src/components/embedded/workbook/draft-store';
import type { WorkbookProtectedSheetSequence } from '../../src/components/embedded/workbook/sheet-calculation-permit';

export const sourceDeleteScope = { viewerId: 'source-delete-person', projectId: '7db8d21a-8877-4d0c-8db3-94f44ce19fa1', fileName: 'Delete.xlsx', draftId: 'df78dfc1-8755-4c18-85e6-af49a940765d' };
const scope = sourceDeleteScope;
export function createSourceDeleteHistoryFixture(owned: boolean, options: {
  initial?: IWorkbookData;
  sourceCells?: number;
  save?: (state: WorkbookCheckpoint | null) => Promise<void>;
  saveGuarded?: (state: WorkbookCheckpoint, guard: () => void) => Promise<void>;
  current?: () => boolean;
  runProtectedSequence?: WorkbookProtectedSheetSequence;
  write?: (intent: WorkbookWriteIntent, checkpoint: () => Promise<void>) => Promise<WorkbookWriteResult>;
} = {}) {
  const model: WorkbookDocument = {
    version: 1, date1904: false, activeSheetId: '1', styles: [{}], worksheetMembershipEditable: true,
    worksheetStructureEditable: true, calculationMetadata: 'verified',
    features: { charts: 0, drawings: 0, externalLinks: 0, macros: false, signed: false },
    sheets: ['1', '2', '3'].map(id => ({ id, name: `Sheet ${id}`, visibility: 'visible', rowCount: 100, columnCount: 26,
      cells: [{ row: 0, column: 0, kind: 'number', value: id === '2' ? 17 : 21 }],
      merges: [], rowDimensions: [], columnDimensions: [], frozenRows: 0, frozenColumns: 0, arrayFormulas: [] })),
  };
  model.sheets[2]!.cells.push({ row: 1, column: 0, kind: 'number', value: 38, formula: "='Sheet 2'!A1+'Sheet 1'!A1" });
  if (options.sourceCells) {
    model.sheets[1]!.rowCount = Math.max(100, Math.ceil(options.sourceCells / 20));
    model.sheets[1]!.cells = Array.from({ length: options.sourceCells }, (_, index) => ({ row: Math.floor(index / 20), column: index % 20, kind: 'number', value: index + 17 }));
  }
  const source = { model, sourceSha256: 'a'.repeat(64) };
  const univer = new Univer({ locale: LocaleType.EN_US, locales: { [LocaleType.EN_US]: English } });
  univer.registerPlugin(UniverFormulaEnginePlugin, { notExecuteFormula: true });
  univer.registerPlugin(UniverSheetsPlugin);
  univer.registerPlugin(UniverSheetsFormulaPlugin, { initialFormulaComputing: CalculationMode.NO_CALCULATION });
  const api = FUniver.newAPI(univer);
  const initial = options.initial ?? seedWorkbookStructureIdentity(gridWorkbook(model, `${scope.projectId}:${scope.fileName}`, 'Workbook').data as IWorkbookData, source.sourceSha256);
  const book = api.createWorkbook(initial);
  univer.__getInjector().get(IUniverInstanceService).focusUnit(book.getId());
  const commands = univer.__getInjector().get(ICommandService);
  const history = univer.__getInjector().get(IUndoRedoService);
  const writer = new WorkbookWriter(source, book.save(), options.write ?? (async () => { throw Error('Unexpected transport'); }), () => {}, undefined, {
    scope, isCurrent: options.current ?? (() => true), validate: state => { serializeWorkbookDraft(scope, state); }, save: options.save ?? (async () => {}), ...(options.saveGuarded ? { saveGuarded: options.saveGuarded } : {}),
  });
  const controller = owned ? new WorkbookSheetHistoryController(univer, writer, scope, () => book.save(), options.current ?? (() => true), options.runProtectedSequence) : undefined;
  const observer = commands.onCommandExecuted(command => {
    const params = command.params as { unitId?: unknown } | undefined;
    if (command.type === CommandType.MUTATION && params?.unitId === book.getId()) writer.update(book.save());
  });
  return { source, initial, univer, book, commands, history, writer, controller, api,
    async close() { await writer.close(); observer.dispose(); controller?.dispose(); univer.dispose(); },
  };
}
