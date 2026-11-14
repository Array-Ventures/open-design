/** Explicit local acceptance entrypoint only. Never imported by the product.
 * The .cts carrier keeps all actual pinned SDK imports on one require branch. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { Univer, LocaleType, ICommandService, IUniverInstanceService, UniverInstanceType, type Workbook, type IWorkbookData } from '@univerjs/core';
import { UniverSheetsPlugin, RemoveSheetCommand, SetWorksheetNameCommand } from '@univerjs/sheets';
import { UniverFormulaEnginePlugin } from '@univerjs/engine-formula';
import { CalculationMode, UniverSheetsFormulaPlugin } from '@univerjs/sheets-formula';
import { FUniver } from '@univerjs/core/facade';
import '@univerjs/sheets/facade';
import English from '@univerjs/sheets/locale/en-US';
import { workbookEditPlanSchema, workbookPreviewSchema } from '@open-design/contracts/runtime/workbook';
import { canonicalCommentJson } from '@open-design/contracts/runtime/workbook-sheet-baseline';
import { workbookDraftScopeSchema } from '../../src/components/embedded/workbook/workbook-draft-schema';
import { gridWorkbook } from '../../src/components/embedded/workbook/grid-model';
import { seedWorkbookStructureIdentity } from '../../src/components/embedded/workbook/grid-structure-identity';
import { captureWorkbookSourceDeletion, stampWorkbookSourceDeletion, associateWorkbookSourceDeletion } from '../../src/components/embedded/workbook/sheet-delete-context';
import { bindWorkbookSourceSnapshot } from '../../src/components/embedded/workbook/source-snapshot-binding';
import { assertWorkbookSourceSnapshotInputs } from '../../src/components/embedded/workbook/source-snapshot-inputs';
import { checkedWorkbookSaveAcknowledgement } from '../../src/components/embedded/workbook/save-provenance';
import { Save } from '../../src/components/embedded/workbook/save-identity';
import { workbookGridPlan } from '../../src/components/embedded/workbook/grid-plan';

const Input = z.object({
  phase: z.enum(['delete', 'restore']), scope: workbookDraftScopeSchema,
  historical: workbookPreviewSchema, current: workbookPreviewSchema.optional(),
  receipt: Save.optional(), deletionPlan: workbookEditPlanSchema.optional(),
}).strict();

async function main() {
  const [inputFile, outputFile] = process.argv.slice(2);
  assert.ok(inputFile && outputFile, 'Supply explicit local acceptance input and output files');
  const input = Input.parse(JSON.parse(await readFile(inputFile, 'utf8')));
  const { historical, scope } = input, unitId = `${scope.projectId}:${scope.fileName}`;
  assert.deepEqual(historical.model.sheets.map(sheet => [sheet.id, sheet.name]), [['1', 'Rich cells'], ['2', 'Retained sheet']]);
  const initial = seedWorkbookStructureIdentity(gridWorkbook(historical.model, unitId, 'Workbook').data as IWorkbookData, historical.sourceSha256);
  const univer = new Univer({ locale: LocaleType.EN_US, locales: { [LocaleType.EN_US]: English } });
  univer.registerPlugin(UniverFormulaEnginePlugin, { notExecuteFormula: true });
  univer.registerPlugin(UniverSheetsPlugin);
  univer.registerPlugin(UniverSheetsFormulaPlugin, { notExecuteFormula: false, initialFormulaComputing: CalculationMode.NO_CALCULATION });
  try {
    const api = FUniver.newAPI(univer), book = api.createWorkbook(initial);
    const instances = univer.__getInjector().get(IUniverInstanceService), commands = univer.__getInjector().get(ICommandService);
    instances.focusUnit(unitId);
    const acknowledged = book.save();
    book.getSheetBySheetId('2')!.getRange('A1').setValue(20);
    book.getSheetBySheetId('2')!.getRange('A1').setFontSize(22.25);
    assert.equal(commands.syncExecuteCommand(SetWorksheetNameCommand.id, { unitId, subUnitId: '2', name: 'Current survivor' }), true);
    book.getSheetBySheetId('1')!.getRange('B2').setValue(19);
    let context = captureWorkbookSourceDeletion(scope, { version: 1, source: historical, acknowledged, desired: book.save(), pending: null }, '1');
    const unit = instances.getUnit<Workbook>(unitId, UniverInstanceType.UNIVER_SHEET)!;
    stampWorkbookSourceDeletion(unit.getSheetBySheetId('1')!, context.descriptor);
    assert.equal(commands.syncExecuteCommand(RemoveSheetCommand.id, { unitId, subUnitId: '1' }), true);
    const deleted = book.save();
    const deletionPlan = workbookGridPlan(historical.model, historical.sourceSha256, acknowledged, deleted, { scope, deletions: [context] });
    if (input.phase === 'delete') {
      await writeFile(outputFile, JSON.stringify(deletionPlan));
      return;
    }
    const { current, receipt, deletionPlan: frozen } = input;
    assert.ok(current && receipt && frozen, 'Restore requires actual current preview, checked server receipt and frozen deletion plan');
    assert.equal(canonicalCommentJson(deletionPlan), canonicalCommentJson(frozen), 'Regenerated native deletion must exactly match the committed declared plan');
    assertWorkbookSourceSnapshotInputs(gridWorkbook(current.model, unitId, 'Workbook').data as IWorkbookData, deleted, unitId);
    const acknowledgement = checkedWorkbookSaveAcknowledgement(receipt, {
      operationId: receipt.id, renderId: receipt.renderId, projectId: scope.projectId, fileName: scope.fileName,
      preparationId: scope.draftId, plan: frozen,
    }, current.sourceSha256);
    context = associateWorkbookSourceDeletion(context, acknowledgement);
    const binding = bindWorkbookSourceSnapshot(scope, current, deleted, acknowledgement);
    assert.ok(binding, 'The applied receipt must carry real source/target history versions');
    await api.undo();
    assert.equal(book.save().sheets['1']!.cellData![1]![1]!.v, 19);
    assert.equal(book.save().sheets['2']!.cellData![0]![0]!.v, 20);
    const plan = workbookGridPlan(current.model, current.sourceSha256, deleted, book.save(), {
      scope, deletions: [context], sourceOwner: { scope, acknowledgement, binding },
    });
    await writeFile(outputFile, JSON.stringify(workbookEditPlanSchema.parse(plan)));
  } finally { univer.dispose(); }
}
main().catch(error => { process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`); process.exitCode = 1; });
