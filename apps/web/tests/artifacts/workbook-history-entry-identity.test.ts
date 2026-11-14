import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createWorkbookBirthFixture } from '../helpers/workbook-birth-fixture';

const closing: Array<() => void> = [];
afterEach(() => { for (const close of closing.splice(0)) close(); });
function fixture() {
  const f = createWorkbookBirthFixture(); closing.push(() => f.univer.dispose());
  const checkpoint = () => f.history.getUndoRedoCheckpoint();
  return { ...f, checkpoint };
}
it('retains exact native entry identity across Undo/Redo while distinguishing a copied entry with identical data', async () => {
  const f = fixture();
  f.book.getActiveSheet().getRange('A1').setValue(17);
  const original = f.checkpoint();
  expect(original.undoEntryId).toBeTypeOf('number');
  expect(original.redoEntryId).toBeNull();
  await f.api.undo();
  expect(f.checkpoint().redoEntryId).toBe(original.undoEntryId);
  expect(f.checkpoint().undoEntryId).toBeNull();
  await f.api.redo();
  expect(f.checkpoint().undoEntryId).toBe(original.undoEntryId);
  const data = { unitID:f.book.getId(),undoMutations:[],redoMutations:[] };
  f.history.pushUndoRedo(data);
  const first = f.checkpoint().undoEntryId;
  f.history.pushUndoRedo(structuredClone(data));
  expect(f.checkpoint().undoEntryId).not.toBe(first);
});
it('revokes same-object push and grouped replacement identities instead of trusting payload object identity', () => {
  const f = fixture(), item = { unitID:'',undoMutations:[],redoMutations:[] };
  item.unitID = f.book.getId();
  f.history.pushUndoRedo(item);
  const first = f.checkpoint().undoEntryId;
  expect(first).toBeTypeOf('number');
  f.history.clearUndoRedo(f.book.getId()); f.history.pushUndoRedo(item);
  expect(f.checkpoint().undoEntryId).not.toBe(first);
  f.history.clearUndoRedo(f.book.getId());
  const group = f.history.beginUndoRedoGroup(f.book.getId(),'same-group','replace');
  try {
    f.book.getActiveSheet().getRange('A1').setValue(17);
    const before = f.checkpoint().undoEntryId;
    f.book.getActiveSheet().getRange('A1').setValue(19);
    expect(f.history.getUndoRedoStatus(f.book.getId()).undos).toBe(1);
    expect(f.checkpoint().undoEntryId).not.toBe(before);
  } finally { group.dispose(); }
});

it('revokes batched payload changes while preserving other unit identities and empty focus', () => {
  const f = fixture();
  const batch = f.history.__tempBatchingUndoRedo(f.book.getId());
  try {
    f.book.getActiveSheet().getRange('A1').setValue(17);
    const before = f.checkpoint();
    f.book.getActiveSheet().getRange('A1').setValue(19);
    const batched = f.checkpoint();
    expect(f.history.getUndoRedoStatus(f.book.getId()).undos).toBe(1);
    expect(batched.undoEntryId).not.toBe(before.undoEntryId);
    f.history.pushUndoRedo({ unitID:'another-unit',undoMutations:[],redoMutations:[] });
    expect(f.checkpoint().undoEntryId).toBe(batched.undoEntryId);
    expect(f.checkpoint().revision).toBeGreaterThan(batched.revision);
  } finally { batch.dispose(); }
});
it.each(['lib/es/index.js','lib/cjs/index.js','lib/index.js'])('keeps exact entry identities in the actual pinned %s', entry => {
  const require = createRequire(import.meta.url);
  const root = resolve(dirname(require.resolve('@univerjs/core')), '../..');
  const result = execFileSync(process.execPath, ['--input-type=module', '-e', `
import {createRequire} from 'node:module';import {pathToFileURL} from 'node:url';
const entry=process.argv[1],core=entry.includes('/cjs/')?createRequire(import.meta.url)(entry):await import(pathToFileURL(entry).href);
let focused='owned';const service=new core.LocalUndoRedoService({focused$:{subscribe(){return{closed:false,unsubscribe(){}}}},getFocusedUnit(){return focused?{getUnitId(){return focused}}:null}}, {registerCommand(){return{dispose(){}}}}, {getContextValue(){return false}}, {getConfig(){return 50}});
const item={unitID:'owned',undoMutations:[],redoMutations:[{id:'noop',params:{}}]};service.pushUndoRedo(item);
const first=service.getUndoRedoCheckpoint();if(!Number.isSafeInteger(first.undoEntryId)||first.redoEntryId!==null||!Object.isFrozen(first))throw Error('Missing primitive identity');
service.popUndoToRedo();if(service.getUndoRedoCheckpoint().redoEntryId!==first.undoEntryId)throw Error('Undo movement reissued identity');
service.popRedoToUndo();if(service.getUndoRedoCheckpoint().undoEntryId!==first.undoEntryId)throw Error('Redo movement reissued identity');
service.clearUndoRedo('owned');service.pushUndoRedo(item);if(service.getUndoRedoCheckpoint().undoEntryId===first.undoEntryId)throw Error('Same-object push kept identity');
const group=service.beginUndoRedoGroup('owned','group','replace');service.pushUndoRedo(item);const grouped=service.getUndoRedoCheckpoint().undoEntryId;
service.pushUndoRedo(item);if(service.getUndoRedoCheckpoint().undoEntryId===grouped)throw Error('Group replacement kept identity');group.dispose();
service.pushUndoRedo({unitID:'',undoMutations:[],redoMutations:[]});focused='';const empty=service.getUndoRedoCheckpoint();if(empty.undoEntryId!==null||empty.redoEntryId!==null||empty.undoAvailable||empty.redoAvailable)throw Error('Empty focus leaked identity');
service.dispose();process.stdout.write(JSON.stringify({moved:true,repushed:true,grouped:true,empty:true}));
`, resolve(root,entry)], { encoding: 'utf8' });
  expect(JSON.parse(result)).toEqual({ moved:true,repushed:true,grouped:true,empty:true });
});
