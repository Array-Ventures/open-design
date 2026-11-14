import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { InsertSheetCommand, RemoveSheetCommand, SetWorksheetNameCommand } from '@univerjs/sheets';
import { createWorkbookBirthFixture } from '../helpers/workbook-birth-fixture';

it('finds buried actual Add, Rename and Delete items through native Undo/Redo without running them during inspection', async () => {
  const f = createWorkbookBirthFixture();
  try {
    const read = () => f.history.getUndoRedoEntryIds(f.book.getId());
    expect(read().undos).toEqual([]);
    expect(f.commands.syncExecuteCommand(InsertSheetCommand.id, { unitId: f.book.getId(), index: 1, sheet: { id: '2', name: 'Born', rowCount: 100, columnCount: 26 } })).toBe(true);
    const birth = f.history.getUndoRedoCheckpoint().undoEntryId!;
    expect(f.commands.syncExecuteCommand(SetWorksheetNameCommand.id, { unitId: f.book.getId(), subUnitId: '2', name: 'Renamed' })).toBe(true);
    const rename = f.history.getUndoRedoCheckpoint().undoEntryId!;
    expect(f.commands.syncExecuteCommand(RemoveSheetCommand.id, { unitId: f.book.getId(), subUnitId: '2' })).toBe(true);
    const deletion = f.history.getUndoRedoCheckpoint().undoEntryId!;
    const before = f.book.save(), checkpoint = f.history.getUndoRedoCheckpoint();
    expect(read()).toEqual({ unitId: f.book.getId(), revision: checkpoint.revision, undos: [birth, rename, deletion], redos: [] });
    expect(f.book.save()).toEqual(before); expect(f.history.getUndoRedoCheckpoint()).toEqual(checkpoint);
    await f.api.undo(); await f.api.undo();
    expect(read().undos).toEqual([birth]); expect(read().redos).toEqual([deletion, rename]);
    await f.api.redo(); expect(read().undos).toEqual([birth, rename]); expect(read().redos).toEqual([deletion]);
  } finally { f.univer.dispose(); }
});

it.each(['lib/es/index.js', 'lib/cjs/index.js', 'lib/index.js'])('inspects existing IDs with bounded, frozen, nonallocating ownership in actual %s', entry => {
  const require = createRequire(import.meta.url), root = resolve(dirname(require.resolve('@univerjs/core')), '../..');
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', `
import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {pathToFileURL} from 'node:url';
const entry=process.argv[1],core=entry.includes('/cjs/')?createRequire(import.meta.url)(entry):await import(pathToFileURL(entry).href);
let focused='owned',limit=50,executed=0;
const service=new core.LocalUndoRedoService({focused$:{subscribe(){return{closed:false,unsubscribe(){}}}},getFocusedUnit(){return focused?{getUnitId(){return focused}}:null}}, {registerCommand(){return{dispose(){}}},executeCommand(){executed++}}, {getContextValue(){return false}}, {getConfig(){return limit}});
const push=(name='owned')=>{const item={unitID:name,undoMutations:[],redoMutations:[{id:'noop',params:{}}]};service.pushUndoRedo(item);return item;};
const read=()=>service.getUndoRedoEntryIds('owned');
const empty=read();assert.deepEqual(empty,{unitId:'owned',revision:0,undos:[],redos:[]});assert(Object.isFrozen(empty)&&Object.isFrozen(empty.undos)&&Object.isFrozen(empty.redos));
const first=push(),a=service.getUndoRedoCheckpoint().undoEntryId;push();const b=service.getUndoRedoCheckpoint().undoEntryId;
const before=read(),revision=before.revision;assert.deepEqual(before.undos,[a,b]);service.popUndoToRedo();assert.deepEqual(read().undos,[a]);assert.deepEqual(read().redos,[b]);service.popRedoToUndo();assert.deepEqual(read().undos,[a,b]);assert.deepEqual(before.undos,[a,b]);assert.equal(before.revision,revision);
const nativeSet=service._historyEntryIds.set;let allocated=0;service._historyEntryIds.set=function(...args){allocated++;return Reflect.apply(nativeSet,this,args)};
const checkpoint=service.getUndoRedoCheckpoint(),status=service.getUndoRedoStatus('owned');for(let i=0;i<3;i++)assert.deepEqual(read(),read());assert.equal(allocated,0);assert.equal(executed,0);assert.deepEqual(service.getUndoRedoCheckpoint(),checkpoint);assert.deepEqual(service.getUndoRedoStatus('owned'),status);service._historyEntryIds.set=nativeSet;
service._historyLimit=2;push();const trimmed=read();assert.equal(trimmed.undos.length,2);assert(!trimmed.undos.includes(a));service.popUndoToRedo();assert.equal(read().redos.length,1);push();assert.deepEqual(read().redos,[]);
focused='other';push('other');assert.throws(read,/owner/);assert.equal(service.getUndoRedoEntryIds('other').undos.length,1);focused='owned';for(const bad of ['',42,'x'.repeat(601)])assert.throws(()=>service.getUndoRedoEntryIds(bad));assert.throws(()=>service.getUndoRedoEntryIds('unknown'),/owner/);
service.clearUndoRedo('owned');const item=push();let getterCalls=0;const unit=Object.getOwnPropertyDescriptor(item,'unitID');Object.defineProperty(item,'unitID',{get(){getterCalls++;return 'owned'},configurable:true});assert.throws(read,/data property/);assert.equal(getterCalls,0);Object.defineProperty(item,'unitID',unit);
Object.defineProperty(item,'undoMutations',{get(){getterCalls++;throw Error('payload read')},configurable:true});assert.equal(read().undos.length,1);assert.equal(getterCalls,0);
const revisionValue=service._historyCheckpointRevision;for(const invalid of [-1,NaN,Number.MAX_SAFE_INTEGER]){service._historyCheckpointRevision=invalid;assert.throws(read,/revision/)}service._historyCheckpointRevision=revisionValue;
const stack=service._undoStacks.get('owned'),original=stack[0],id=service._historyEntryIds.get(item),stamp=service.getUndoRedoCheckpoint();
stack[0]={unitID:'owned'};assert.throws(read,/identity/);stack[0]=original;assert.deepEqual(service.getUndoRedoCheckpoint(),stamp);
delete stack[0];assert.throws(read,/owner/);stack[0]=original;
Object.defineProperty(stack,'0',{get(){getterCalls++;return original},configurable:true});assert.throws(read,/data property/);assert.equal(getterCalls,0);Object.defineProperty(stack,'0',{value:original,writable:true,configurable:true,enumerable:true});
for(const bad of [0,NaN,Number.MAX_SAFE_INTEGER]){service._historyEntryIds.set(item,bad);assert.throws(read,/identity/)}service._historyEntryIds.set(item,id);
item.unitID='other';assert.throws(read,/owner/);item.unitID='owned';stack.push(item);assert.throws(read,/identity/);stack.pop();assert.deepEqual(service.getUndoRedoCheckpoint(),stamp);
service.clearUndoRedo('owned');service._historyLimit=5000;for(let i=0;i<4096;i++)push();assert.equal(read().undos.length,4096);service.popUndoToRedo();assert.equal(read().undos.length+read().redos.length,4096);service.popRedoToUndo();push();const over=service.getUndoRedoCheckpoint();assert.throws(read,/limit/);assert.deepEqual(service.getUndoRedoCheckpoint(),over);assert.equal(service.getUndoRedoStatus('owned').undos,4097);
service.clearUndoRedo('owned');assert.deepEqual(read().undos,[]);assert.equal(executed,0);service.dispose();assert.throws(read);
process.stdout.write(JSON.stringify({frozen:true,moved:true,trimmed:true,redoCleared:true,owned:true,noAccessors:true,noAllocation:true,bounded:true,stable:true}));
`, resolve(root, entry)], { encoding: 'utf8' });
  expect(JSON.parse(output)).toEqual({ frozen: true, moved: true, trimmed: true, redoCleared: true, owned: true, noAccessors: true, noAllocation: true, bounded: true, stable: true });
});
