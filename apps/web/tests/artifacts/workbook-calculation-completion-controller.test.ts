import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import type { WorkbookDocument } from '@open-design/contracts/runtime/workbook';
import type { IWorkbookData } from '@univerjs/core';
import { attachWorkbookCalculation } from '../../src/components/embedded/workbook/grid-calculation';
import { ownWorkbookCalculationWorker } from '../../src/components/embedded/workbook/calculation-worker-owner';
import { gridWorkbook } from '../../src/components/embedded/workbook/grid-model';
import { ownWorkbookAxisIdentity, seedWorkbookStructureIdentity } from '../../src/components/embedded/workbook/grid-structure-identity';
import { WORKBOOK_INPUT_EPOCH_OPTION, workbookCalculationInputSha256 } from '../../src/components/embedded/workbook/formula-input-provenance';
const pinned = createRequire(realpathSync(fileURLToPath(new URL('../../node_modules/@univerjs/preset-sheets-core/package.json', import.meta.url))));
import * as core from '@univerjs/core';
import * as engine from '@univerjs/engine-formula';
import * as sheets from '@univerjs/sheets';
import * as formula from '@univerjs/sheets-formula';
import { FUniver } from '@univerjs/core/facade';
import '@univerjs/sheets/facade';
import '@univerjs/engine-formula/facade';
const closers: (() => void)[] = [];
afterEach(() => { closers.splice(0).reverse().forEach(close => close()); vi.useRealTimers(); });
class Channel extends EventTarget { terminate = vi.fn(); send(value: object) { this.dispatchEvent(new MessageEvent('message', { data: { type: 'studio:workbook-calculation-worker', ...value } })); } }
async function fixture() {
  vi.useFakeTimers();
  const channel = new Channel(), unavailable = vi.fn(), owner = ownWorkbookCalculationWorker(unavailable, () => channel as unknown as Worker); closers.push(() => owner.dispose()); channel.send({ kind: 'ready' }); await owner.loaded;
  const English = pinned('@univerjs/preset-sheets-core/locales/en-US'), univer = new core.Univer({ locale: core.LocaleType.EN_US, locales: { [core.LocaleType.EN_US]: English.default ?? English } }); closers.push(() => univer.dispose());
  let book: ReturnType<FUniver['createWorkbook']> | undefined;
  const identities = ownWorkbookAxisIdentity(univer, () => book?.save(), () => true); closers.push(() => identities.dispose());
  univer.registerPlugin(engine.UniverFormulaEnginePlugin, { notExecuteFormula: true }); univer.registerPlugin(sheets.UniverSheetsPlugin); univer.registerPlugin(formula.UniverSheetsFormulaPlugin, { initialFormulaComputing: formula.CalculationMode.NO_CALCULATION });
  const api = FUniver.newAPI(univer), model: WorkbookDocument = { version: 1, worksheetStructureEditable: true, calculationMetadata: 'verified', date1904: false, activeSheetId: 's', styles: [{}], features: { charts: 0, drawings: 0, externalLinks: 0, macros: false, signed: false }, sheets: [{ id: 's', name: 'Inputs', rowCount: 100, columnCount: 26, visibility: 'visible', frozenRows: 0, frozenColumns: 0, merges: [], rowDimensions: [], columnDimensions: [], arrayFormulas: [], cells: [{ row: 0, column: 0, kind: 'number', value: 2 }, { row: 0, column: 2, kind: 'number', value: 999, formula: '=A1+3' }] }] };
  book = api.createWorkbook(seedWorkbookStructureIdentity(gridWorkbook(model, 'completion', 'Completion').data as IWorkbookData, 'a'.repeat(64))); book.setEditable(true); univer.__getInjector().get(core.IUniverInstanceService).focusUnit(book.getId());
  const original = book.save(), phases: string[] = [], calculation = attachWorkbookCalculation(univer, api, model, original, original, () => book!.save(), owner, state => phases.push(state.phase)); closers.push(() => calculation.dispose());
  const commands = univer.__getInjector().get(core.ICommandService); let epoch = 0;
  const observe = commands.onCommandExecuted((_command, options) => { if (typeof options?.[WORKBOOK_INPUT_EPOCH_OPTION] === 'number') epoch = options[WORKBOOK_INPUT_EPOCH_OPTION] as number; }); closers.push(() => observe.dispose());
  const edit = (value: number, column = 3) => commands.syncExecuteCommand(sheets.SetRangeValuesMutation.id, { unitId: book!.getId(), subUnitId: 's', cellValue: { 0: { [column]: { v: value, t: 2, ...(column === 2 ? { f: null } : {}) } } } });
  const tag = (generation: number) => ({ version: 1 as const, unitId: book!.getId(), inputSha256: workbookCalculationInputSha256(book!.save()), generation, inputEpoch: epoch, valid: true });
  const graph = (proof: ReturnType<typeof tag>) => channel.send({ kind: 'graph', workbookCalculation: proof, result: [{ treeId: 1, unitId: book!.getId(), subUnitId: 's', row: 0, column: 2, formula: '=A1+3', parents: [] }] });
  const complete = (proof: ReturnType<typeof tag>) => channel.send({ kind: 'complete', outcome: 'not-executed', workbookCalculation: proof });
  const insert = () => commands.syncExecuteCommand(sheets.InsertRowByRangeCommand.id, { unitId: book!.getId(), subUnitId: 's', range: { startRow: 1, endRow: 1, startColumn: 0, endColumn: 25 }, direction: core.Direction.UP });
  return { owner, channel, unavailable, phases, calculation, commands, book, edit, tag, graph, complete, insert };
}
it('rejects an old never-settled A pass after real A-B-A mutations despite an identical input digest', async () => {
  const f = await fixture(); f.edit(77); const old = f.tag(1); f.edit(78); f.edit(77); const current = f.tag(2);
  expect(old.inputSha256).toBe(current.inputSha256); expect(current.inputEpoch).toBe(3);
  f.graph(old); f.complete(old); expect(f.phases.at(-1)).toBe('pending');
  f.complete(current); expect(f.phases.at(-1)).toBe('pending'); f.graph(current); expect(f.phases.at(-1)).toBe('stored');
  await vi.advanceTimersByTimeAsync(5001); expect(f.unavailable).not.toHaveBeenCalled(); expect(f.owner.ready).toBe(true);
});
it('does not evict an eligible queued terminal with late stale, wrong-input or invalid messages', async () => {
  const f = await fixture(); f.edit(77); const current = f.tag(3); f.complete(current);
  f.complete({ ...current, generation: 2 }); f.complete({ ...current, generation: 99, valid: false }); f.complete({ ...current, generation: 99, inputEpoch: 0 }); f.complete({ ...current, generation: 99, inputSha256: '0'.repeat(64) });
  expect(f.phases.at(-1)).toBe('pending'); f.graph(current); expect(f.phases.at(-1)).toBe('stored');
  expect(f.calculation.status('s', 0, 2)?.result).toBe('stored'); await vi.advanceTimersByTimeAsync(5001); expect(f.unavailable).not.toHaveBeenCalled();
});
it('keeps the newest matching graph when an older graph arrives before its terminal', async () => {
  const f = await fixture(); f.edit(77); const current = f.tag(3); f.graph(current); f.graph({ ...current, generation: 2 }); f.complete(current);
  expect(f.phases.at(-1)).toBe('stored'); await vi.advanceTimersByTimeAsync(5001); expect(f.unavailable).not.toHaveBeenCalled();
});
it('requires fresh scalar proof after structural changes even when a matching no-result terminal and graph arrive', async () => {
  const f = await fixture(); f.insert(); const proof = f.tag(1); f.complete(proof); f.graph(proof); expect(f.phases.at(-1)).toBe('pending');
  f.commands.syncExecuteCommand(engine.SetFormulaCalculationResultMutation.id, { workbookCalculation: proof, unitData: { completion: { s: { 0: { 2: { v: 5, t: 2 } } } } }, sourceFormulaData: { completion: { s: { 0: { 2: { f: '=A1+3' } } } } }, unitOtherData: {} });
  expect(f.calculation.status('s', 0, 2)?.result).toBe('calculated'); expect(f.phases.at(-1)).not.toBe('pending');
  await vi.advanceTimersByTimeAsync(5001); expect(f.unavailable).not.toHaveBeenCalled();
});
it('ends structural liveness accounting when the last formula is actually removed', async () => {
  const f = await fixture(); f.insert(); f.edit(77, 2); expect(f.phases.at(-1)).toBe('live');
  await vi.advanceTimersByTimeAsync(5001); expect(f.unavailable).not.toHaveBeenCalled(); expect(f.owner.ready).toBe(true);
});
