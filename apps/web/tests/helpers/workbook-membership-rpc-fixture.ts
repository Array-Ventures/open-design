import English from '@univerjs/sheets/locale/en-US';
import * as core from '@univerjs/core';
import * as engine from '@univerjs/engine-formula';
import * as sheets from '@univerjs/sheets';
import * as formula from '@univerjs/sheets-formula';
import * as rpc from '@univerjs/rpc';
import { FUniver } from '@univerjs/core/facade';
import '@univerjs/sheets/facade';
import '@univerjs/engine-formula/facade';
import '@univerjs/sheets-formula/facade';
import type { WorkbookDocument } from '@open-design/contracts/runtime/workbook';
import { NodeWorkbookWorker } from './workbook-node-worker';
import { ownWorkbookCalculationWorker } from '../../src/components/embedded/workbook/calculation-worker-owner';
import { attachWorkbookCalculation } from '../../src/components/embedded/workbook/grid-calculation';
import { gridWorkbook } from '../../src/components/embedded/workbook/grid-model';
import { seedWorkbookStructureIdentity } from '../../src/components/embedded/workbook/grid-structure-identity';
import { WorkbookWriter } from '../../src/components/embedded/workbook/workbook-writer';
import { WorkbookSheetHistoryController } from '../../src/components/embedded/workbook/sheet-history-controller';
import { serializeWorkbookDraft } from '../../src/components/embedded/workbook/draft-store';
import type { WorkbookCalculationState } from '../../src/components/embedded/workbook/calculation-state';

export async function createWorkbookMembershipRpcFixture(formulas = true, sourceRows = 100) {
  const scope = { viewerId: 'rpc-person', projectId: 'e15f57b8-c463-4ff6-a469-ddc985e034b1', fileName: 'Membership.xlsx', draftId: crypto.randomUUID() };
  const model: WorkbookDocument = { version: 1, date1904: false, activeSheetId: '1', styles: [{}], calculationMetadata: 'verified', worksheetMembershipEditable: true, worksheetStructureEditable: true,
    features: { charts: 0, drawings: 0, externalLinks: 0, macros: false, signed: false },
    sheets: ['1', '2', '3'].map(id => ({ id, name: `Sheet ${id}`, visibility: 'visible', rowCount: id === '2' ? sourceRows : 100, columnCount: 26, cells: [{ row: 0, column: 0, kind: 'number', value: id === '2' ? 17 : 21 }], merges: [], rowDimensions: [], columnDimensions: [], frozenRows: 0, frozenColumns: 0, arrayFormulas: [] })) };
  if (formulas) model.sheets[2]!.cells.push({ row: 1, column: 0, kind: 'number', value: 38, formula: "='Sheet 2'!A1+'Sheet 1'!A1" });
  const worker = new NodeWorkbookWorker(true, false, false, true);
  let failed = false;
  const owner = ownWorkbookCalculationWorker(() => { failed = true; }, () => worker as unknown as Worker);
  if (!await owner.loaded) { await worker.thread.terminate(); throw Error('Owned membership worker did not become ready.'); }
  const id = `${scope.projectId}:${scope.fileName}`, sourceSha256 = 'a'.repeat(64);
  await owner.configureMembership({ version: 1, unitId: id, kernelGeneration: crypto.randomUUID(), sourceCapability: sourceSha256 });
  const univer = new core.Univer({ locale: core.LocaleType.EN_US, locales: { [core.LocaleType.EN_US]: English } });
  univer.registerPlugin(rpc.UniverRPCMainThreadPlugin, { workerURL: worker as unknown as Worker });
  univer.registerPlugin(engine.UniverFormulaEnginePlugin, { notExecuteFormula: true });
  univer.registerPlugin(sheets.UniverSheetsPlugin, { notExecuteFormula: true });
  univer.registerPlugin(formula.UniverSheetsFormulaPlugin, { notExecuteFormula: true, initialFormulaComputing: formula.CalculationMode.NO_CALCULATION });
  const api = FUniver.newAPI(univer), initial = seedWorkbookStructureIdentity(gridWorkbook(model, id, 'Membership').data as core.IWorkbookData, sourceSha256);
  const book = api.createWorkbook(initial), commands = univer.__getInjector().get(core.ICommandService);
  univer.__getInjector().get(core.IUniverInstanceService).focusUnit(id);
  const statuses: WorkbookCalculationState[] = [];
  const calculation = attachWorkbookCalculation(univer, api, model, initial, book.save(), () => book.save(), owner, value => statuses.push(value), () => !failed);
  const writer = new WorkbookWriter({ model, sourceSha256 }, book.save(), async () => { throw Error('Unexpected remote write'); }, () => {}, undefined, { scope, isCurrent: () => true, validate: checkpoint => { serializeWorkbookDraft(scope, checkpoint); }, save: async () => {} });
  const controller = new WorkbookSheetHistoryController(univer, writer, scope, () => book.save(), () => owner.ready, calculation.runProtectedSequence);
  const observer = commands.onCommandExecuted(command => { if (command.type === core.CommandType.MUTATION) writer.update(book.save()); });
  await univer.__getInjector().get(rpc.IRemoteInstanceService).whenReady();
  return { scope, model, worker, owner, univer, api, book, commands, statuses, calculation, writer, controller, get failed() { return failed; },
    async close() {
      await writer.close(); observer.dispose();
      const before = JSON.stringify(book.save());
      // The pinned host progress timer outlives a terminated replica unless its
      // existing STOP notification is delivered. This clears only host UI
      // progress, after all genuine success/failure assertions; no values or
      // worker results are synthesized. Match the existing RPC stall fixture.
      commands.syncExecuteCommand(engine.SetFormulaCalculationNotificationMutation.id, { functionsExecutedState: engine.FormulaExecutedStateType.STOP_EXECUTION }, { onlyLocal: true });
      if (JSON.stringify(book.save()) !== before) throw Error('Progress cleanup changed workbook data.');
      controller.dispose(); calculation.dispose(); owner.dispose(); univer.dispose(); await worker.thread.terminate();
    },
  };
}
