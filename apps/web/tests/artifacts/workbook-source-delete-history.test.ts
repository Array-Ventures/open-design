import { CommandType, ICommandService, IUndoRedoService, IUniverInstanceService, LocaleType, Univer, type IWorkbookData } from '@univerjs/core';
import { UniverSheetsPlugin, RemoveSheetCommand, RemoveSheetMutation, InsertSheetMutation, SheetInterceptorService, SetRangeValuesMutation } from '@univerjs/sheets';
import { UniverFormulaEnginePlugin } from '@univerjs/engine-formula';
import { CalculationMode, UniverSheetsFormulaPlugin } from '@univerjs/sheets-formula';
import { FUniver } from '@univerjs/core/facade';
import '@univerjs/sheets/facade';
import English from '@univerjs/sheets/locale/en-US';
import { expect, it } from 'vitest';
import type { WorkbookDocument } from '@open-design/contracts/runtime/workbook';
import { gridWorkbook } from '../../src/components/embedded/workbook/grid-model';
import { seedWorkbookStructureIdentity } from '../../src/components/embedded/workbook/grid-structure-identity';
import { WorkbookWriter, type WorkbookCheckpoint, type WorkbookWriteIntent, type WorkbookWriteResult } from '../../src/components/embedded/workbook/workbook-writer';
import { WorkbookSheetHistoryController } from '../../src/components/embedded/workbook/sheet-history-controller';
import { serializeWorkbookDraft } from '../../src/components/embedded/workbook/draft-store';
import { standInWorkbookResult } from '../helpers/workbook-birth-transport';
import { nativeDeletePayloadIdentity } from '../../src/components/embedded/workbook/native-delete-history';
import { captureWorkbookSourceDeletion, WORKBOOK_SHEET_DELETE_MARKER } from '../../src/components/embedded/workbook/sheet-delete-context';
import { appendRestoredSheetModel } from '../../src/components/embedded/workbook/grid-restored-sheet';

const scope = { viewerId: 'source-delete-person', projectId: '7db8d21a-8877-4d0c-8db3-94f44ce19fa1', fileName: 'Delete.xlsx', draftId: 'df78dfc1-8755-4c18-85e6-af49a940765d' };
function fixture(owned: boolean, options: {
  initial?: IWorkbookData;
  sourceCells?: number;
  save?: (state: WorkbookCheckpoint | null) => Promise<void>;
  current?: () => boolean;
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
    scope, isCurrent: options.current ?? (() => true), validate: state => { serializeWorkbookDraft(scope, state); }, save: options.save ?? (async () => {}),
  });
  const controller = owned ? new WorkbookSheetHistoryController(univer, writer, scope, () => book.save(), options.current ?? (() => true)) : undefined;
  const observer = commands.onCommandExecuted(command => { if (command.type === CommandType.MUTATION) writer.update(book.save()); });
  return { source, initial, univer, book, commands, history, writer, controller, api,
    async close() { await writer.close(); observer.dispose(); controller?.dispose(); univer.dispose(); },
  };
}

it.each([false, true])('matches the original native Delete dependency sequence, survivor data and selection when removed sheet active=%s', async active => {
  const f = fixture(false);
  const owned = fixture(true, { initial: structuredClone(f.initial) });
  try {
    if (active) {
      f.book.setActiveSheet('2');
      owned.book.setActiveSheet('2');
      expect(f.book.getActiveSheet().getSheetId()).toBe('2');
      expect(owned.book.getActiveSheet().getSheetId()).toBe('2');
    }
    f.book.getSheetBySheetId('2')!.getRange('A1').setValue(19);
    owned.book.getSheetBySheetId('2')!.getRange('A1').setValue(19);
    expect(f.commands.syncExecuteCommand(RemoveSheetCommand.id, { unitId: f.book.getId(), subUnitId: '2' })).toBe(true);
    const checkpoint = f.history.getUndoRedoCheckpoint();
    const data = f.history.getUndoRedoMutationData(f.book.getId(), 'undo', checkpoint.undoEntryId!);
    expect(data.redoMutations.some(value => value.id === 'sheet.mutation.set-range-values')).toBe(true);
    await owned.controller!.remove('2');
    const ownedCheckpoint = owned.history.getUndoRedoCheckpoint();
    const ownedData = structuredClone(owned.history.getUndoRedoMutationData(owned.book.getId(), 'undo', ownedCheckpoint.undoEntryId!));
    const insert = ownedData.undoMutations.find(value => value.id === 'sheet.mutation.insert-sheet')!;
    const inserted = (insert.params as { sheet: { custom?: Record<string, unknown> } }).sheet;
    delete inserted.custom![WORKBOOK_SHEET_DELETE_MARKER];
    if (!Object.keys(inserted.custom!).length) delete inserted.custom;
    expect(JSON.parse(nativeDeletePayloadIdentity(ownedData))).toEqual(JSON.parse(nativeDeletePayloadIdentity(data)));
    expect(owned.book.save().sheets).toEqual(f.book.save().sheets);
    expect(owned.book.save().sheetOrder).toEqual(f.book.save().sheetOrder);
    expect(owned.book.getActiveSheet().getSheetId()).toBe(f.book.getActiveSheet().getSheetId());
  } finally { await owned.close(); await f.close(); }
});

it('refuses synchronous or ambiguous owned Delete without scheduling storage or a delayed command', async () => {
  let stores = 0;
  const f = fixture(true, { save: async () => { stores++; } });
  try {
    const before = f.book.save(), history = f.history.getUndoRedoCheckpoint();
    expect(() => f.commands.syncExecuteCommand(RemoveSheetCommand.id, { unitId: f.book.getId(), subUnitId: '2' })).toThrow('asynchronous dispatch');
    await expect(f.commands.executeCommand(RemoveSheetCommand.id, { unitId: f.book.getId(), subUnitId: '2', unexpected: true })).rejects.toThrow('target is invalid');
    await expect(f.commands.executeCommand(RemoveSheetCommand.id)).rejects.toThrow('target is invalid');
    await Promise.resolve();
    expect(f.book.save()).toEqual(before);
    expect(f.history.getUndoRedoCheckpoint()).toEqual(history);
    expect(stores).toBe(0);
  } finally { await f.close(); }
});

it('issues a protected real source Delete and restores removed19 rather than baseline17 without reverting survivor21', async () => {
  const f = fixture(true);
  try {
    f.book.getSheetBySheetId('2')!.getRange('A1').setValue(19);
    await f.controller!.remove('2');
    expect(f.book.save().sheets['2']).toBeUndefined();
    expect(f.book.save().sheets['3']!.cellData![1]![0]!.f).toContain('#REF!');
    await f.api.undo();
    expect(f.book.save().sheets['2']!.cellData![0]![0]!.v).toBe(19);
    expect(f.book.save().sheets['1']!.cellData![0]![0]!.v).toBe(21);
    expect(f.book.save().sheets['3']!.cellData![1]![0]!.f).toBe("='Sheet 2'!A1+'Sheet 1'!A1");
    await f.api.redo();
    expect(f.book.save().sheets['2']).toBeUndefined();
    expect(f.writer.checkpoint().sheetActionConflict).toBeUndefined();
  } finally { await f.close(); }
});

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

it.each(['delete', 'undo', 'redo'] as const)('keeps data and native history untouched when %s protection storage fails, then retries', async stage => {
  let deny = false;
  const f = fixture(true, { save: async () => { if (deny) throw Error('Owned storage denied'); } });
  try {
    if (stage !== 'delete') await f.controller!.remove('2');
    if (stage === 'redo') await f.api.undo();
    const before = f.book.save();
    const history = f.history.getUndoRedoCheckpoint();
    deny = true;
    const execute = () => stage === 'delete' ? f.controller!.remove('2') : stage === 'undo' ? f.api.undo() : f.api.redo();
    await expect(execute()).rejects.toThrow('Owned storage denied');
    expect(f.book.save()).toEqual(before);
    expect(f.history.getUndoRedoCheckpoint()).toEqual(history);
    expect(f.writer.checkpoint().sheetActionConflict).toBeUndefined();
    deny = false;
    await execute();
    expect(Boolean(f.book.save().sheets['2'])).toBe(stage === 'undo');
  } finally { await f.close(); }
});

it.each(['focus', 'lease', 'registration', 'controller'] as const)('refuses %s withdrawal while source Undo awaits storage without pop or quarantine', async withdrawal => {
  const blocked = gate(), release = gate();
  let blocking = false, current = true;
  const f = fixture(true, {
    current: () => current,
    save: async () => { if (blocking) { blocked.resolve(); await release.promise; } },
  });
  let undo: Promise<unknown> | undefined;
  try {
    await f.controller!.remove('2');
    const before = f.book.save(), history = f.history.getUndoRedoCheckpoint();
    blocking = true;
    undo = f.api.undo();
    void undo.catch(() => {});
    await blocked.promise;
    if (withdrawal === 'lease') current = false;
    else if (withdrawal === 'controller') f.controller!.dispose();
    else if (withdrawal === 'focus') {
      const other = f.api.createWorkbook({ id: 'other-delete-owner', sheetOrder: ['x'], sheets: { x: { id: 'x', name: 'Other', rowCount: 10, columnCount: 10 } } });
      f.univer.__getInjector().get(IUniverInstanceService).focusUnit(other.getId());
    } else {
      const { UndoCommand } = await import('@univerjs/core');
      f.commands.unregisterCommand(UndoCommand.id);
      f.commands.registerCommand({ id: UndoCommand.id, type: UndoCommand.type, handler: () => false });
    }
    release.resolve();
    await expect(undo).rejects.toThrow(/changed|lease/);
    expect(f.book.save()).toEqual(before);
    // Focus changes the reported current unit; inspect the original stack counts.
    expect(f.history.getUndoRedoStatus(f.book.getId())).toEqual({ undos: 1, redos: 0 });
    if (withdrawal !== 'focus') expect(f.history.getUndoRedoCheckpoint()).toEqual(history);
    expect(f.writer.checkpoint().sheetActionConflict).toBeUndefined();
  } finally { release.resolve(); await undo?.catch(() => {}); await f.close(); }
});

function deletionResult(source: WorkbookCheckpoint['source'], intent: WorkbookWriteIntent, targetSha256 = 'b'.repeat(64)) {
  const target = structuredClone(source);
  target.sourceSha256 = targetSha256;
  target.model.sheets = target.model.sheets.filter(sheet => intent.plan.sheets!.some(value => value.sheetId === sheet.id));
  for (const edit of intent.plan.edits) {
    const sheet = target.model.sheets.find(value => value.id === edit.sheetId)!;
    sheet.cells = sheet.cells.filter(cell => cell.row !== edit.cell.row || cell.column !== edit.cell.column);
    sheet.cells.push(structuredClone(edit.cell));
  }
  return standInWorkbookResult(scope, intent, target, 'before-source-delete', 'after-source-delete');
}

it('keeps the exact pending deletion during Undo/Redo and restores selected19 against historical17 after its ACK', async () => {
  const started = gate(), release = gate();
  let f!: ReturnType<typeof fixture>;
  f = fixture(true, { write: async (intent, checkpoint) => {
    intent.renderId ??= crypto.randomUUID();
    await checkpoint();
    started.resolve();
    await release.promise;
    return deletionResult(f.source, intent);
  } });
  let saving: Promise<void> | undefined;
  try {
    f.book.getSheetBySheetId('2')!.getRange('A1').setValue(19);
    await f.controller!.remove('2');
    saving = f.writer.flush();
    await started.promise;
    const pending = structuredClone(f.writer.checkpoint().pending);
    await f.api.undo();
    expect(f.book.save().sheets['2']!.cellData![0]![0]!.v).toBe(19);
    expect(f.writer.checkpoint().pending).toEqual(pending);
    await f.api.redo();
    expect(f.writer.checkpoint().pending).toEqual(pending);
    release.resolve();
    await saving;
    expect(f.writer.state().error).toBeNull();
    expect(f.writer.checkpoint().source.sourceSha256).toBe('b'.repeat(64));
    expect(f.writer.checkpoint().sheetDeletions![0]!.baseline.sheet.cells[0]!.value).toBe(17);
    expect(f.writer.checkpoint().sheetDeletions![0]!.removedSheet?.cellData?.[0]?.[0]?.v).toBe(19);
    expect(f.writer.checkpoint().sheetDeletions![0]!.receiptAssociation?.sourceVersionId).toBe('before-source-delete');
    await f.api.undo();
    expect(f.book.save().sheets['2']!.cellData![0]![0]!.v).toBe(19);
    expect(f.book.save().sheets['1']!.cellData![0]![0]!.v).toBe(21);
    expect(f.writer.checkpoint().pending).toBeNull();
    await f.api.redo();
    expect(f.book.save().sheets['2']).toBeUndefined();
  } finally { release.resolve(); await saving; await f.close(); }
});

it('lets a pending deletion ACK complete after Undo and derives the next exact historical restore rather than replacing that pending root', async () => {
  const started = gate(), release = gate();
  let writes = 0;
  let f!: ReturnType<typeof fixture>;
  f = fixture(true, { write: async (intent, checkpoint) => {
    writes++;
    intent.renderId ??= crypto.randomUUID();
    await checkpoint();
    if (writes === 1) {
      started.resolve();
      await release.promise;
      return deletionResult(f.source, intent);
    }
    expect(writes).toBe(2);
    expect(intent.plan.sourceSha256).toBe('b'.repeat(64));
    expect(intent.plan.sheets?.find(sheet => sheet.sheetId === '2')).toMatchObject({ origin: 'restore',
      template: { versionId: 'before-source-delete', versionSha256: 'a'.repeat(64) }, baselineIdentity: { version: 1, sha256: expect.stringMatching(/^[a-f0-9]{64}$/) } });
    expect(intent.plan.edits.find(edit => edit.sheetId === '2' && edit.cell.row === 0 && edit.cell.column === 0)?.cell.value).toBe(19);
    return deletionResult(f.source, intent, 'c'.repeat(64));
  } });
  let saving: Promise<void> | undefined;
  try {
    f.book.getSheetBySheetId('2')!.getRange('A1').setValue(19);
    await f.controller!.remove('2');
    saving = f.writer.flush();
    await started.promise;
    const pending = structuredClone(f.writer.checkpoint().pending);
    await f.api.undo();
    expect(f.writer.checkpoint().pending).toEqual(pending);
    release.resolve();
    await saving;
    expect(f.writer.state().error).toBeNull();
    expect(writes).toBe(2);
    expect(f.writer.checkpoint().source.sourceSha256).toBe('c'.repeat(64));
    expect(f.book.save().sheets['2']!.cellData![0]![0]!.v).toBe(19);
    await f.api.redo();
    expect(f.book.save().sheets['2']).toBeUndefined();
    expect(f.writer.checkpoint().pending).toBeNull();
  } finally { release.resolve(); await saving; await f.close(); }
});

it('uses the normal public command entry so an existing command permission veto never reaches storage or mutation', async () => {
  let stores = 0;
  const f = fixture(true, { save: async () => { stores++; } });
  const guard = f.commands.beforeCommandExecuted(command => {
    if (command.id === RemoveSheetCommand.id) throw Error('Owned permission veto');
  });
  try {
    const before = f.book.save(), history = f.history.getUndoRedoCheckpoint();
    await expect(f.controller!.remove('2')).rejects.toThrow('Owned permission veto');
    expect(stores).toBe(0);
    expect(f.book.save()).toEqual(before);
    expect(f.history.getUndoRedoCheckpoint()).toEqual(history);
  } finally { guard.dispose(); await f.close(); }
});

it('allows two absent theme descriptors without equating absent, defined or unequal themes', async () => {
  const f = fixture(true);
  try {
    const context = captureWorkbookSourceDeletion(scope, f.writer.checkpoint(), '2');
    const current = structuredClone(f.source.model);
    current.sheets = current.sheets.filter(sheet => sheet.id !== '2');
    expect(() => appendRestoredSheetModel(structuredClone(current), context)).not.toThrow();
    const dark = Array<string>(12).fill('FF000000');
    expect(() => appendRestoredSheetModel({ ...structuredClone(current), themeColors: dark }, context)).toThrow('interpretation');
    const withTheme = structuredClone(context);
    withTheme.baseline.themeColors = dark;
    expect(() => appendRestoredSheetModel(structuredClone(current), withTheme)).toThrow('interpretation');
    expect(() => appendRestoredSheetModel({ ...structuredClone(current), themeColors: dark }, withTheme)).not.toThrow();
    expect(() => appendRestoredSheetModel({ ...structuredClone(current), themeColors: Array<string>(12).fill('FFFFFFFF') }, withTheme)).toThrow('interpretation');
  } finally { await f.close(); }
});

it.each(['delete', 'undo', 'redo'] as const)('quarantines unexpected native history changes inside the protected %s callback', async phase => {
  const f = fixture(true);
  let injecting = false;
  const observer = f.commands.onCommandExecuted(command => {
    if (!injecting || command.id !== (phase === 'undo' ? InsertSheetMutation.id : RemoveSheetMutation.id)) return;
    injecting = false;
    f.history.pushUndoRedo({ unitID: f.book.getId(),
      undoMutations: [{ id: SetRangeValuesMutation.id, params: { unitId: f.book.getId(), subUnitId: '1', cellValue: { 0: { 0: { v: 21 } } } } }],
      redoMutations: [{ id: SetRangeValuesMutation.id, params: { unitId: f.book.getId(), subUnitId: '1', cellValue: { 0: { 0: { v: 999 } } } } }],
    });
  });
  try {
    if (phase !== 'delete') await f.controller!.remove('2');
    if (phase === 'redo') await f.api.undo();
    const protectedBefore = f.writer.checkpoint().desired;
    injecting = true;
    const execute = () => phase === 'delete' ? f.controller!.remove('2') : phase === 'undo' ? f.api.undo() : f.api.redo();
    await expect(execute()).rejects.toThrow('needs recovery');
    expect(f.writer.checkpoint().sheetActionConflict).toBe(true);
    expect(f.writer.recoveredSnapshot()).toEqual(protectedBefore);
  } finally { observer.dispose(); await f.close(); }
});

it.each(['async', 'sync'] as const)('delegates an unrelated workbook native %s Delete and history without touching the owned workbook', async mode => {
  const f = fixture(true);
  try {
    const before = f.book.save();
    const other = f.api.createWorkbook({ id: 'unrelated-native-delete', sheetOrder: ['x', 'y'], sheets: {
      x: { id: 'x', name: 'Other first', rowCount: 10, columnCount: 10, cellData: { 0: { 0: { v: 41 } } } },
      y: { id: 'y', name: 'Other removed', rowCount: 10, columnCount: 10, cellData: { 0: { 0: { v: 42 } } } },
    } });
    f.univer.__getInjector().get(IUniverInstanceService).focusUnit(other.getId());
    const params = { unitId: other.getId(), subUnitId: 'y' };
    const result = mode === 'async' ? await f.commands.executeCommand(RemoveSheetCommand.id, params) : f.commands.syncExecuteCommand(RemoveSheetCommand.id, params);
    expect(result).toBe(true);
    expect(other.save().sheets.y).toBeUndefined();
    await f.api.undo();
    expect(other.save().sheets.y!.cellData![0]![0]!.v).toBe(42);
    await f.api.redo();
    expect(other.save().sheets.y).toBeUndefined();
    expect(f.book.save()).toEqual(before);
    expect(f.history.getUndoRedoStatus(f.book.getId())).toEqual({ undos: 0, redos: 0 });
    expect(f.writer.checkpoint().sheetDeletions).toBeUndefined();
    expect(f.writer.checkpoint().sheetActionConflict).toBeUndefined();
  } finally { await f.close(); }
});

it.each(['before', 'during'] as const)('refuses a same-item public native payload alias changed %s Undo storage before pop', async phase => {
  const blocked = gate(), release = gate();
  let blocking = false;
  const f = fixture(true, { save: async () => { if (blocking) { blocked.resolve(); await release.promise; } } });
  let undo: Promise<unknown> | undefined;
  try {
    await f.controller!.remove('2');
    const native = f.history.pitchTopUndoElement()!;
    const insertion = native.undoMutations.find(value => value.id === 'sheet.mutation.insert-sheet')!;
    const alias = insertion.params as { sheet: { cellData: Record<number, Record<number, { v: number }>> } };
    const before = f.book.save(), history = f.history.getUndoRedoCheckpoint();
    if (phase === 'during') {
      blocking = true;
      undo = f.api.undo();
      void undo.catch(() => {});
      await blocked.promise;
    }
    alias.sheet.cellData[0]![0]!.v = 999;
    if (phase === 'before') { undo = f.api.undo(); void undo.catch(() => {}); }
    release.resolve();
    await expect(undo).rejects.toThrow('Delete payload changed');
    expect(f.book.save()).toEqual(before);
    expect(f.history.getUndoRedoCheckpoint()).toEqual(history);
    expect(f.writer.checkpoint().sheetActionConflict).toBeUndefined();
  } finally { release.resolve(); await undo?.catch(() => {}); await f.close(); }
});

it('retains all6001 removed cells and native Undo above the SDK history-clearing threshold, still refusing denied storage', async () => {
  let denied = true;
  const f = fixture(true, { sourceCells: 6001, save: async () => { if (denied) throw Error('Large draft storage denied'); } });
  try {
    const before = f.book.save(), history = f.history.getUndoRedoCheckpoint();
    await expect(f.controller!.remove('2')).rejects.toThrow('Large draft storage denied');
    expect(f.book.save()).toEqual(before);
    expect(f.history.getUndoRedoCheckpoint()).toEqual(history);
    denied = false;
    await f.controller!.remove('2');
    expect(f.history.getUndoRedoStatus(f.book.getId())).toEqual({ undos: 1, redos: 0 });
    await f.api.undo();
    expect(f.book.save().sheets['2']).toEqual(expect.objectContaining({ cellData: before.sheets['2']!.cellData }));
    const cells = Object.values(f.book.save().sheets['2']!.cellData!).flatMap(columns => Object.values(columns!));
    expect(cells).toHaveLength(6001);
    expect(f.book.save().sheets['2']!.cellData![300]![0]!.v).toBe(6017);
  } finally { await f.close(); }
}, 30_000);

it('detaches public interceptor references before storage and refuses copied native items carrying an issued deletion marker', async () => {
  const blocked = gate(), release = gate();
  let blocking = false;
  const f = fixture(true, { save: async () => { if (blocking) { blocked.resolve(); await release.promise; } } });
  let retained: { f: string } | undefined;
  const interceptor = f.univer.__getInjector().get(SheetInterceptorService).interceptCommand({ getMutations: command => {
    if (command.id !== RemoveSheetCommand.id) return { redos: [], undos: [] };
    retained = { f: "=#REF!+'Sheet 1'!A1" };
    return { redos: [{ id: SetRangeValuesMutation.id, params: { unitId: f.book.getId(), subUnitId: '3', cellValue: { 1: { 0: retained } } } }], undos: [] };
  } });
  let removing: Promise<void> | undefined;
  try {
    blocking = true;
    removing = f.controller!.remove('2');
    await blocked.promise;
    retained!.f = '=999';
    release.resolve();
    await removing;
    expect(f.book.save().sheets['3']!.cellData![1]![0]!.f).toBe("=#REF!+'Sheet 1'!A1");
    // The attacker fixture deliberately uses the SDK's public mutable item API;
    // the production owner only reads the detached checkpoint projection.
    const original = structuredClone(f.history.pitchTopUndoElement()!);
    f.history.pushUndoRedo({ unitID: f.book.getId(), undoMutations: original.undoMutations, redoMutations: original.redoMutations });
    const before = f.book.save(), status = f.history.getUndoRedoCheckpoint();
    await expect(f.api.undo()).rejects.toThrow(/Compound|issuer|birth/);
    expect(f.book.save()).toEqual(before);
    expect(f.history.getUndoRedoCheckpoint()).toEqual(status);
    expect(f.writer.checkpoint().sheetActionConflict).toBeUndefined();
  } finally { release.resolve(); await removing?.catch(() => {}); interceptor.dispose(); await f.close(); }
});

it('refuses edit→Undo ABA during source restoration storage even when visible inputs return', async () => {
  const blocked = gate(), release = gate();
  let blocking = false;
  const f = fixture(true, { save: async () => { if (blocking) { blocked.resolve(); await release.promise; } } });
  let undo: Promise<unknown> | undefined;
  try {
    await f.controller!.remove('2');
    const before = f.book.save();
    blocking = true;
    undo = f.api.undo();
    void undo.catch(() => {});
    await blocked.promise;
    f.book.getSheetBySheetId('1')!.getRange('A1').setValue(999);
    await f.api.undo();
    expect(f.book.save()).toEqual(before);
    release.resolve();
    await expect(undo).rejects.toThrow('workbook changed');
    expect(f.book.save()).toEqual(before);
    expect(f.writer.checkpoint().sheetActionConflict).toBeUndefined();
  } finally { release.resolve(); await undo?.catch(() => {}); await f.close(); }
});
