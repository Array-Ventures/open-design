import { afterEach, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { IUniverInstanceService } from '@univerjs/core';
import { createWorkbookBirthFixture } from '../helpers/workbook-birth-fixture';

interface Checkpoint {
  readonly unitId: string;
  readonly revision: number;
  readonly undoAvailable: boolean;
  readonly redoAvailable: boolean;
  readonly undoEntryId: number | null;
  readonly redoEntryId: number | null;
}
const closing: Array<() => void> = [];
afterEach(() => { for (const close of closing.splice(0)) close(); });
function fixture() {
  const f = createWorkbookBirthFixture();
  closing.push(() => f.univer.dispose());
  const service = f.history;
  const checkpoint = () => {
    expect(service.getUndoRedoCheckpoint, 'Native history must provide a read-only revision checkpoint').toBeTypeOf('function');
    return service.getUndoRedoCheckpoint!();
  };
  return { ...f, checkpoint };
}
it('distinguishes native Undo→Redo ABA even when the exact original top and counts return', async () => {
  const f = fixture();
  f.book.getActiveSheet().getRange('A1').setValue(17);
  const before = f.checkpoint();
  expect(Object.isFrozen(before)).toBe(true);
  await f.api.undo();
  const undone = f.checkpoint();
  await f.api.redo();
  const returned = f.checkpoint();
  expect(returned.unitId).toBe(before.unitId);
  expect(returned.undoAvailable).toBe(before.undoAvailable);
  expect(returned.redoAvailable).toBe(before.redoAvailable);
  expect(undone.revision).toBeGreaterThan(before.revision);
  expect(returned.revision).toBeGreaterThan(undone.revision);
  expect(f.book.getActiveSheet().getRange('A1').getValue()).toBe(17);
});
it('detects same-count grouped replacement and rollback without relying on status emissions', () => {
  const f = fixture();
  const group = f.history.beginUndoRedoGroup(f.book.getId(), 'same-top', 'replace');
  try {
    f.book.getActiveSheet().getRange('A1').setValue(17);
    const before = f.checkpoint();
    f.book.getActiveSheet().getRange('A1').setValue(19);
    const replaced = f.checkpoint();
    expect(f.history.getUndoRedoStatus(f.book.getId()).undos).toBe(1);
    expect(replaced.revision).toBeGreaterThan(before.revision);
  } finally { group.dispose(); }
  f.history.pushUndoRedo({ unitID: f.book.getId(), id: 'owned-rollback', undoMutations: [], redoMutations: [] });
  const beforeRollback = f.checkpoint();
  let notifications = 0;
  const sub = f.history.undoRedoStatus$.subscribe(() => { notifications++; });
  const originalNotifications = notifications;
  try {
    f.history.rollback('owned-rollback', f.book.getId());
    expect(notifications).toBe(originalNotifications);
    expect(f.checkpoint().revision).toBeGreaterThan(beforeRollback.revision);
  } finally { sub.unsubscribe(); }
});
it('reports the native focused unit, refuses after disposal and never exposes entry payloads', () => {
  const f = fixture();
  const before = f.checkpoint();
  const other = f.api.createWorkbook({ id: 'another-owned-unit', sheetOrder: ['1'], sheets: {
    '1': { id: '1', name: 'Other', rowCount: 100, columnCount: 26 },
  } });
  f.univer.__getInjector().get(IUniverInstanceService).focusUnit(other.getId());
  // Use the same public focus service as native history.
  const next = f.checkpoint();
  expect(next.unitId).toBe(other.getId());
  expect(next.unitId).not.toBe(before.unitId);
  expect(Object.keys(next).sort()).toEqual(['redoAvailable','redoEntryId','revision','undoAvailable','undoEntryId','unitId']);
  f.univer.dispose();
  expect(() => f.checkpoint()).toThrow();
});

it.each(['lib/es/index.js','lib/cjs/index.js','lib/index.js'])('keeps the actual %s checkpoint frozen, bounded and editor-aware', entry => {
  const require = createRequire(import.meta.url);
  const root = resolve(dirname(require.resolve('@univerjs/core')), '../..');
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', `
import {createRequire} from 'node:module';import {pathToFileURL} from 'node:url';
const entry=process.argv[1], core=entry.includes('/cjs/')?createRequire(import.meta.url)(entry):await import(pathToFileURL(entry).href);
let focused=null;const flags=new Set();
const service=new core.LocalUndoRedoService({focused$:{subscribe(){return{closed:false,unsubscribe(){}}}},getFocusedUnit(){return focused},getCurrentUnitOfType(){return null}}, {registerCommand(){return{dispose(){}}}}, {getContextValue(key){return flags.has(key)}}, {getConfig(){return 50}});
const empty=service.getUndoRedoCheckpoint();if(empty.unitId!==''||empty.undoAvailable||empty.redoAvailable||!Object.isFrozen(empty))throw Error('Invalid empty checkpoint');
focused={getUnitId(){return 'owned'}};service.pushUndoRedo({unitID:'owned',id:'rollback',undoMutations:[],redoMutations:[]});
const before=service.getUndoRedoCheckpoint();service.rollback('rollback','owned');const after=service.getUndoRedoCheckpoint();
if(after.revision<=before.revision||after.undoAvailable)throw Error('Rollback lost revision');
flags.add(core.FOCUSING_SHEET);flags.add(core.FOCUSING_FX_BAR_EDITOR);flags.add(core.EDITOR_ACTIVATED);
if(service.getUndoRedoCheckpoint().unitId!==core.DOCS_FORMULA_BAR_EDITOR_UNIT_ID_KEY)throw Error('Lost formula editor ownership');
// Test-only fault injection of the SDK-local counter, never an application API.
Object.defineProperty(service,'_historyCheckpointRevision',{value:Number.MAX_SAFE_INTEGER,writable:true});
let queryRefused=false,writeRefused=false;try{service.getUndoRedoCheckpoint()}catch{queryRefused=true}
try{service.pushUndoRedo({unitID:'owned',undoMutations:[],redoMutations:[]})}catch{writeRefused=true}
if(!queryRefused||!writeRefused||service.getUndoRedoStatus('owned').undos!==0)throw Error('Overflow mutated history');
service.dispose();let closed=false;try{service.getUndoRedoCheckpoint()}catch{closed=true}if(!closed)throw Error('Disposed inspection accepted');
process.stdout.write(JSON.stringify({queryRefused,writeRefused,closed}));
`, resolve(root, entry)], { encoding: 'utf8' });
  expect(JSON.parse(output)).toEqual({ queryRefused: true, writeRefused: true, closed: true });
});
