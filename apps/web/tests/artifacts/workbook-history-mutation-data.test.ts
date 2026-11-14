import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { createWorkbookBirthFixture } from '../helpers/workbook-birth-fixture';

const closing: Array<() => void> = [];
afterEach(() => { for (const close of closing.splice(0)) close(); });
function fixture() {
  const f = createWorkbookBirthFixture(); closing.push(() => f.univer.dispose());
  const service = f.history;
  const read = (direction: 'undo'|'redo' = 'undo', entry = f.history.getUndoRedoCheckpoint().undoEntryId!) => {
    expect(service.getUndoRedoMutationData).toBeTypeOf('function');
    return service.getUndoRedoMutationData!(f.book.getId(), direction, entry);
  };
  return { ...f, read, service };
}
it('returns detached frozen generic mutation data bound to exact current entry without stripping trigger', () => {
  const f = fixture();
  const params = { nested: { value:17 }, trigger:'native.command.routing', optional:undefined, zero:-0 };
  f.history.pushUndoRedo({ unitID:f.book.getId(), undoMutations:[{id:'generic.undo',params}], redoMutations:[{id:'generic.redo',params:{other:true}}] });
  const id = f.history.getUndoRedoCheckpoint().undoEntryId!;
  const result = f.read('undo',id);
  expect(result.entryId).toBe(id);
  expect(result.undoMutations[0]!.params).toEqual({nested:{value:17},trigger:'native.command.routing',zero:0});
  expect(Object.isFrozen(result)).toBe(true);
  expect(Object.isFrozen(result.undoMutations)).toBe(true);
  expect(Object.isFrozen(result.undoMutations[0])).toBe(true);
  expect(Object.isFrozen(result.undoMutations[0]!.params)).toBe(true);
  const detached = result.undoMutations[0]!.params as typeof params;
  expect(Object.isFrozen(detached.nested)).toBe(true);
  params.nested.value = 999;
  expect(detached.nested.value).toBe(17);
  expect((f.read('undo',id).undoMutations[0]!.params as typeof params).nested.value).toBe(999);
  expect(f.history.getUndoRedoCheckpoint().undoEntryId).toBe(id);
  expect(() => f.read('undo',id+1)).toThrow();
  expect(() => f.read('redo',id)).toThrow();
});
it('rejects getters, holes, cycles and exotic data without invoking accessors or changing history', () => {
  const f = fixture(); let calls = 0;
  const getter = Object.defineProperty({},'value',{enumerable:true,get(){calls++;return 17;}});
  const cycle: Record<string,unknown> = {}; cycle.self=cycle;
  for (const [params,reason] of [[getter,/data property/],[{value:Array(1)},/dense JSON/],[{value:[undefined]},/dense JSON/],[cycle,/acyclic/],[{value:new Date()},/acyclic/],[{value:NaN},/finite/]] as const) {
    f.history.clearUndoRedo(f.book.getId());
    f.history.pushUndoRedo({unitID:f.book.getId(),undoMutations:[{id:'generic.undo',params}],redoMutations:[]});
    const before = f.history.getUndoRedoCheckpoint();
    expect(() => f.read()).toThrow(reason);
    expect(f.history.getUndoRedoCheckpoint()).toEqual(before);
  }
  expect(calls).toBe(0);
});

it('enforces actual mutation, depth, node and text budgets before native cloning', () => {
  const f = fixture();
  let deep: Record<string,unknown> = {};
  for (let index = 0; index < 65; index++) deep = {value:deep};
  const clone = vi.spyOn(globalThis,'structuredClone');
  try {
    for (const [params,reason] of [[deep,/node\/depth/],[{value:Array(4_000_001)},/node\/depth/],[{value:'x'.repeat(64*1024*1024+1)},/text limit/]] as const) {
      f.history.clearUndoRedo(f.book.getId());
      f.history.pushUndoRedo({unitID:f.book.getId(),undoMutations:[{id:'generic.undo',params}],redoMutations:[]});
      expect(() => f.read()).toThrow(reason);
    }
    f.history.clearUndoRedo(f.book.getId());
    f.history.pushUndoRedo({unitID:f.book.getId(),undoMutations:Array(100_001).fill({id:'generic.undo',params:{}}),redoMutations:[]});
    expect(() => f.read()).toThrow('mutation limit');
    expect(clone).not.toHaveBeenCalled();
  } finally { clone.mockRestore(); }
});
it.each([
  ['Unicode', () => '漢'.repeat(Math.floor(128*1024*1024/3)+1)],
  ['escaped control', () => '\u0001'.repeat(Math.floor(128*1024*1024/6)+1)],
] as const)('counts actual %s JSON bytes rather than JS string length before cloning', (_name, input) => {
  const f = fixture();
  const above = input();
  expect(above.length).toBeLessThan(64*1024*1024);
  f.history.pushUndoRedo({unitID:f.book.getId(),undoMutations:[{id:'generic.undo',params:{value:above}}],redoMutations:[]});
  const clone = vi.spyOn(globalThis,'structuredClone');
  try {
    expect(() => f.read()).toThrow('byte limit');
    expect(clone).not.toHaveBeenCalled();
  } finally { clone.mockRestore(); }
});
it('allows a genuinely bounded large Unicode value with detached containers', () => {
  const f = fixture();
  const below = '漢'.repeat(Math.floor((128*1024*1024-4096)/3));
  const params = {value:below};
  f.history.pushUndoRedo({unitID:f.book.getId(),undoMutations:[{id:'generic.undo',params}],redoMutations:[]});
  const projected = f.read().undoMutations[0]!.params as typeof params;
  expect(projected).not.toBe(params);
  expect(projected.value.length).toBe(below.length);
  expect(Object.isFrozen(projected)).toBe(true);
});
it.each(['lib/es/index.js','lib/cjs/index.js','lib/index.js'])('reads frozen generic data in actual pinned %s', entry => {
  const require = createRequire(import.meta.url), root = resolve(dirname(require.resolve('@univerjs/core')),'../..');
  const output = execFileSync(process.execPath,['--input-type=module','-e',`
import {createRequire} from 'node:module';import {pathToFileURL} from 'node:url';
const entry=process.argv[1],core=entry.includes('/cjs/')?createRequire(import.meta.url)(entry):await import(pathToFileURL(entry).href);
const service=new core.LocalUndoRedoService({focused$:{subscribe(){return{closed:false,unsubscribe(){}}}},getFocusedUnit(){return{getUnitId(){return 'owned'}}}}, {registerCommand(){return{dispose(){}}}}, {getContextValue(){return false}}, {getConfig(){return 50}});
const params={nested:{value:17},trigger:'native.routing'};service.pushUndoRedo({unitID:'owned',undoMutations:[{id:'generic.undo',params}],redoMutations:[{id:'generic.redo',params}]});
const id=service.getUndoRedoCheckpoint().undoEntryId,result=service.getUndoRedoMutationData('owned','undo',id);
if(!Object.isFrozen(result)||!Object.isFrozen(result.undoMutations)||!Object.isFrozen(result.undoMutations[0].params.nested))throw Error('Mutable projection');
if(result.undoMutations[0].params!==result.redoMutations[0].params)throw Error('Lost detached alias');
params.nested.value=999;if(result.undoMutations[0].params.nested.value!==17||result.undoMutations[0].params.trigger!=='native.routing')throw Error('Aliased or filtered data');
let getterCalls=0;Object.defineProperty(params,'accessor',{enumerable:true,get(){getterCalls++;return 1}});let refused=false;try{service.getUndoRedoMutationData('owned','undo',id)}catch{refused=true}
if(!refused||getterCalls)throw Error('Unsafe getter inspection');service.dispose();let closed=false;try{service.getUndoRedoMutationData('owned','undo',id)}catch{closed=true}if(!closed)throw Error('Disposed data accepted');
process.stdout.write(JSON.stringify({frozen:true,detached:true,getterRefused:true,closed}));
`,resolve(root,entry)],{encoding:'utf8'});
  expect(JSON.parse(output)).toEqual({frozen:true,detached:true,getterRefused:true,closed:true});
});

it('freezes actual shared native params and diamond data without rewriting an already frozen clone', () => {
  const f = fixture();
  const child = {value:17};
  const params = {left:child,right:child};
  f.history.pushUndoRedo({unitID:f.book.getId(),undoMutations:[{id:'generic.undo',params}],redoMutations:[{id:'generic.redo',params}]});
  const result = f.read();
  const undo = result.undoMutations[0]!.params as typeof params;
  const redo = result.redoMutations[0]!.params as typeof params;
  expect(undo).toBe(redo);
  expect(undo.left).toBe(undo.right);
  expect(undo).not.toBe(params);
  expect(undo.left).not.toBe(child);
  expect(Object.isFrozen(undo)).toBe(true);
  expect(Object.isFrozen(undo.left)).toBe(true);
  child.value = 999;
  expect(undo.right.value).toBe(17);
});
