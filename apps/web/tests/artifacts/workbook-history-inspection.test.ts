import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { Univer, LocaleType, IUndoRedoService, IUniverInstanceService } from '@univerjs/core';
import { UniverSheetsPlugin, RemoveSheetCommand, InsertSheetMutation } from '@univerjs/sheets';
import { ICommandService } from '@univerjs/core';
import { FUniver } from '@univerjs/core/facade';
import '@univerjs/sheets/facade';
import English from '@univerjs/sheets/locale/en-US';

const closing: (() => void)[] = []; afterEach(() => { for (const close of closing.splice(0)) close(); });
const mutationId = InsertSheetMutation.id, path = ['sheet', 'custom', 'ownedDelete', 'token'];
function fixture() {
  const univer = new Univer({ locale: LocaleType.EN_US, locales: { [LocaleType.EN_US]: English } }); closing.push(() => univer.dispose());
  univer.registerPlugin(UniverSheetsPlugin); const api = FUniver.newAPI(univer);
  const book = api.createWorkbook({ id: 'history-owner', name: 'History', sheetOrder: ['1','2','3'], styles: {}, sheets: Object.fromEntries(['1','2','3'].map(id => [id, {
    id, name: `Sheet ${id}`, rowCount: 100, columnCount: 26, cellData: { 0: { 0: { v: 12, t: 2 } } }, custom: { ownedDelete: { token: `delete-${id}` } },
  }])) });
  univer.__getInjector().get(IUniverInstanceService).focusUnit(book.getId());
  const history = univer.__getInjector().get(IUndoRedoService), commands = univer.__getInjector().get(ICommandService);
  return { univer, api, book, history, commands };
}
// This is the maintained pinned boundary being qualified, not an independent
// history mirror; the interface declaration is supplied by the dependency patch.
function inspect(history: IUndoRedoService, unitId = 'history-owner', metadataPath = path) {
  return history.getUndoRedoMutationStrings(unitId, mutationId, metadataPath);
}
it('reads older actual delete history without moving focus or retaining mutable SDK payloads', async () => {
  const { api, book, history, commands } = fixture();
  expect(commands.syncExecuteCommand(RemoveSheetCommand.id, { unitId: book.getId(), subUnitId: '2' })).toBe(true);
  book.getSheetBySheetId('1')!.getRange('A1').setValue(20);
  expect(history.getUndoRedoStatus(book.getId())).toEqual({ undos: 2, redos: 0 });
  const top = history.pitchTopUndoElement(); expect(top?.undoMutations.some(m => m.id === mutationId)).toBe(false);
  const result = inspect(history); expect(result).toEqual({ undos: ['delete-2'], redos: [] });
  expect(history.pitchTopUndoElement()).toBe(top); expect(inspect(history,'other-unit')).toEqual({ undos: [], redos: [] });
  expect(Object.isFrozen(result)).toBe(true); expect(Object.isFrozen(result.undos)).toBe(true); expect(Object.isFrozen(result.redos)).toBe(true);
  expect(() => (result.undos as string[]).push('changed')).toThrow();
  await api.undo(); await api.undo(); expect(book.getSheetBySheetId('2')).toBeTruthy();
  expect(inspect(history)).toEqual({ undos: [], redos: ['delete-2'] });
  await api.redo(); expect(book.getSheetBySheetId('2')).toBeNull(); expect(inspect(history)).toEqual({ undos: ['delete-2'], redos: [] });
});
it('follows real grouped entries, default history trimming, clear and disposal', async () => {
  const { api, book, history, commands, univer } = fixture();
  const group = history.beginUndoRedoGroup(book.getId(), 'two-deletes', 'append');
  commands.syncExecuteCommand(RemoveSheetCommand.id, { unitId: book.getId(), subUnitId: '2' });
  commands.syncExecuteCommand(RemoveSheetCommand.id, { unitId: book.getId(), subUnitId: '3' }); group.dispose();
  expect(history.getUndoRedoStatus(book.getId()).undos).toBe(1); expect([...inspect(history).undos].sort()).toEqual(['delete-2','delete-3']);
  expect(history.getUndoRedoMutationStrings(book.getId(), mutationId, ['sheet','custom','ownedDelete','token'], 'top')).toEqual(inspect(history));
  await api.undo(); expect([...inspect(history).redos].sort()).toEqual(['delete-2','delete-3']); await api.redo();
  for (let value = 0; value < 50; value++) book.getSheetBySheetId('1')!.getRange('A1').setValue(100 + value);
  expect(history.getUndoRedoStatus(book.getId()).undos).toBe(50); expect(inspect(history)).toEqual({ undos: [], redos: [] });
  history.clearUndoRedo(book.getId()); expect(inspect(history)).toEqual({ undos: [], redos: [] });
  univer.dispose(); expect(() => inspect(history)).toThrow('disposed');
});
it('never invokes accessors and refuses corrupt primitive selections without changing history', () => {
  const { history } = fixture(); let reads = 0;
  const params = Object.defineProperty({}, 'sheet', { get() { reads++; return { custom: { ownedDelete: { token: 'unsafe' } } }; } });
  history.pushUndoRedo({ unitID: 'history-owner', undoMutations: [{ id: mutationId, params }], redoMutations: [] });
  expect(() => inspect(history)).toThrow('data property'); expect(reads).toBe(0); expect(history.getUndoRedoStatus('history-owner').undos).toBe(1);
  history.clearUndoRedo('history-owner');
  for (const token of [null, {}, 12, 'x'.repeat(513)]) {
    history.pushUndoRedo({ unitID: 'history-owner', undoMutations: [{ id: mutationId, params: { sheet: { custom: { ownedDelete: { token } } } } }], redoMutations: [] });
    expect(() => inspect(history)).toThrow(); history.clearUndoRedo('history-owner');
  }
  for (const query of [[], ['__proto__'], ['constructor'], Array(17).fill('sheet')]) expect(() => inspect(history,'history-owner',query)).toThrow();
  const accessorPath = Object.defineProperty(['sheet'],0,{ get() { reads++; return 'sheet'; } });
  expect(() => inspect(history,'history-owner',accessorPath)).toThrow('data property'); expect(reads).toBe(0);
});
it('refuses finite inspection budgets without truncating or pruning reachable SDK entries', () => {
  const { history } = fixture();
  const mutation = { id: mutationId, params: { sheet: { custom: { ownedDelete: { token: 'retained' } } } } };
  history.pushUndoRedo({ unitID: 'history-owner', undoMutations: Array(4097).fill(mutation), redoMutations: [] });
  expect(() => inspect(history)).toThrow('limit');
  expect(() => history.getUndoRedoMutationStrings('history-owner', mutationId, ['sheet','custom','ownedDelete','token'], 'top')).toThrow('limit');
  expect(history.getUndoRedoStatus('history-owner').undos).toBe(1);
  expect(history.pitchTopUndoElement()?.undoMutations).toHaveLength(4097);
  history.clearUndoRedo('history-owner'); history.pushUndoRedo({ unitID: 'history-owner', undoMutations: Array(100001).fill({ id: 'other', params: {} }), redoMutations: [] });
  expect(() => inspect(history)).toThrow('limit'); expect(history.pitchTopUndoElement()?.undoMutations).toHaveLength(100001);
});


it.each(['lib/es/index.js','lib/cjs/index.js','lib/index.js'])('loads the frozen primitive boundary from the actual pinned %s entry', entry => {
  const require = createRequire(import.meta.url), root = resolve(dirname(require.resolve('@univerjs/core')), '../..');
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', `
import {createRequire} from 'node:module';import {pathToFileURL} from 'node:url';
const entry=process.argv[1],core=entry.includes('/cjs/')?createRequire(import.meta.url)(entry):await import(pathToFileURL(entry).href);
const service=new core.LocalUndoRedoService({focused$:{subscribe(){return{closed:false,unsubscribe(){}}}},getFocusedUnit(){return{getUnitId(){return 'variant'}}}}, {registerCommand(){return{dispose(){}}}}, {getContextValue(){return false}}, {getConfig(){return 50}});
service.pushUndoRedo({unitID:'variant',undoMutations:[{id:'fixture.mutation',params:{owned:{token:'retained'}}}],redoMutations:[]});
const result=service.getUndoRedoMutationStrings('variant','fixture.mutation',['owned','token']);
service.pushUndoRedo({unitID:'variant',undoMutations:[{id:'other.mutation',params:{}}],redoMutations:[]});
const top=service.getUndoRedoMutationStrings('variant','fixture.mutation',['owned','token'],'top');
if(top.undos.length||top.redos.length||!Object.isFrozen(top)||!Object.isFrozen(top.undos))throw Error('Top history query included buried tokens');
if(!Object.isFrozen(result)||!Object.isFrozen(result.undos)||!Object.isFrozen(result.redos))throw Error('Unfrozen history projection');
service.dispose();let closed=false;try{service.getUndoRedoMutationStrings('variant','fixture.mutation',['owned','token'])}catch{closed=true}
process.stdout.write(JSON.stringify({...result,closed}));
`, resolve(root,entry)], { encoding: 'utf8' });
  expect(JSON.parse(output)).toEqual({ undos: ['retained'], redos: [], closed: true });
});

it('distinguishes the actual top entry from buried tokens while preserving whole-history retention', async () => {
  const { api, book, history, commands } = fixture();
  commands.syncExecuteCommand(RemoveSheetCommand.id, { unitId: book.getId(), subUnitId: '2' });
  book.getSheetBySheetId('1')!.getRange('A1').setValue(20);
  const top = () => history.getUndoRedoMutationStrings(book.getId(), mutationId, ['sheet', 'custom', 'ownedDelete', 'token'], 'top');
  expect(inspect(history)).toEqual({ undos: ['delete-2'], redos: [] });
  const status = history.getUndoRedoStatus(book.getId());
  expect(top()).toEqual({ undos: [], redos: [] });
  expect(() => history.getUndoRedoMutationStrings(book.getId(), mutationId, ['sheet','custom','ownedDelete','token'], 'invalid' as 'top')).toThrow('position');
  expect(history.getUndoRedoStatus(book.getId())).toEqual(status);
  await api.undo();
  expect(top()).toEqual({ undos: ['delete-2'], redos: [] });
  await api.undo();
  const restored = top();
  expect(restored).toEqual({ undos: [], redos: ['delete-2'] });
  expect(Object.isFrozen(restored)).toBe(true);
  expect(Object.isFrozen(restored.redos)).toBe(true);
  await api.redo();
  expect(top()).toEqual({ undos: ['delete-2'], redos: [] });
});
