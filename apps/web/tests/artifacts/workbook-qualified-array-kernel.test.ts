import { expect, it, vi } from 'vitest';
import { ICommandService, Univer, isNodeEnv } from '@univerjs/core';
import { FUniver } from '@univerjs/core/facade';
import { SetFormulaCalculationStartMutation } from '@univerjs/engine-formula';
import type { WorkbookDocument } from '@open-design/contracts/runtime/workbook';
import { qualifiedArrayKernel } from '../../src/components/embedded/workbook/qualified-array-kernel';
import { workbookGridEdits } from '../../src/components/embedded/workbook/grid-edits';
const sha = 'a'.repeat(64);
function model(formula='=SEQUENCE(A1,1,10)', mode:'dynamic'|'fixed'='dynamic'): WorkbookDocument {
 return {version:1,calculationMetadata:'verified',date1904:false,activeSheetId:'s',styles:[{}],features:{charts:0,drawings:0,externalLinks:0,macros:false,signed:false},sheets:[{id:'s',name:'Inputs',visibility:'visible',rowCount:100,columnCount:20,frozenRows:0,frozenColumns:0,rowDimensions:[],columnDimensions:[],merges:[],arrayFormulas:[{kind:'array',calculation:mode,row:2,column:3,range:{startRow:2,endRow:4,startColumn:3,endColumn:3}}],cells:[{row:0,column:0,kind:'number',value:3},{row:2,column:3,kind:'number',value:10,formula},{row:3,column:3,kind:'number',value:11},{row:4,column:3,kind:'number',value:12},{row:0,column:5,kind:'number',value:111,formula:'=D4+100'}]}]};
}
it('calculates actual array followers after input edits without materializing derived writer inputs',async()=>{
 const source=model(), kernel=qualifiedArrayKernel(source,'array-live',sha), current=structuredClone(kernel.initial);current.sheets.s!.cellData![0]![0]!.v=4;
 const result=await kernel.calculate(current,1);expect(result.cells.s?.[5]?.[3]).toEqual({kind:'number',value:13});expect(result.cells.s?.[0]?.[5]).toEqual({kind:'number',value:111});
 expect(current.sheets.s!.cellData?.[5]?.[3]).toBeUndefined();expect(workbookGridEdits(source,sha,kernel.initial,current).edits).toEqual([{sheetId:'s',cell:{row:0,column:0,kind:'number',value:4}}]);
});
it('shrinks and preserves real input42 after owner removal',async()=>{
 const source=model(),kernel=qualifiedArrayKernel(source,'array-live',sha),current=structuredClone(kernel.initial);current.sheets.s!.cellData![0]![0]!.v=1;
 expect((await kernel.calculate(current,1)).owners[0]!.range.endRow).toBe(2);
 current.sheets.s!.cellData![2]![3]={};(current.sheets.s!.cellData![3]??={})[3]={v:42,t:2};const next=await kernel.calculate(current,2);expect(next.cells.s?.[0]?.[5]?.value).toBe(142);expect(next.owners).toEqual([]);
 expect(workbookGridEdits(source,sha,kernel.initial,current).edits.some(edit=>edit.cell.row===3&&edit.cell.column===3&&edit.cell.value===42)).toBe(true);
});
it('preserves original unsupported caches and their follower-dependent closure',async()=>{
 const kernel=qualifiedArrayKernel(model('=MISSING(A1)'),'array-live',sha),current=structuredClone(kernel.initial);current.sheets.s!.cellData![0]![0]!.v=4;current.sheets.s!.cellData![2]![3]!.v=999;
 const result=await kernel.calculate(current,1);expect(result.cells.s?.[2]?.[3]?.value).toBe(10);expect(result.cells.s?.[3]?.[3]?.value).toBe(11);expect(result.cells.s?.[0]?.[5]?.value).toBe(111);expect(result.stored).toContain('["s",2,3]');
});
it('calculates reverse-order follower consumers and true spill collisions without altering inputs',async()=>{
 const source=model(),kernel=qualifiedArrayKernel(source,'array-live',sha),current=structuredClone(kernel.initial);
 current.sheets.s!.cellData![0]![5]!.f='=D6+100';current.sheets.s!.cellData![0]![0]!.v=4;
 expect((await kernel.calculate(current,1)).cells.s?.[0]?.[5]?.value).toBe(113);
 (current.sheets.s!.cellData![5]??={})[3]={v:99,t:2};const blocked=await kernel.calculate(current,2);
 expect(blocked.cells.s?.[2]?.[3]).toEqual({kind:'error',value:'#SPILL!'});expect(blocked.owners[0]!.range.endRow).toBe(2);expect(current.sheets.s!.cellData![5]![3]!.v).toBe(99);
});
it('honors fixed source shape and refuses old/unsupported source proof',async()=>{
 const source=model('=SEQUENCE(A1,1,10)','fixed'),kernel=qualifiedArrayKernel(source,'array-live',sha),current=structuredClone(kernel.initial);current.sheets.s!.cellData![0]![0]!.v=4;
 await expect(kernel.calculate(current,1)).rejects.toThrow('fixed source array');
 const old=model();delete old.calculationMetadata;expect(()=>qualifiedArrayKernel(old,'array-live',sha)).toThrow('Verified');
 const unknown=model();unknown.sheets[0]!.arrayFormulas![0]!.calculation='unsupported';expect(()=>qualifiedArrayKernel(unknown,'array-live',sha)).toThrow('identity');
});
it('refuses preallocation broadcasts and bounds overflow instead of publishing synthetic errors',async()=>{
 const source=model(),kernel=qualifiedArrayKernel(source,'array-live',sha),current=structuredClone(kernel.initial);
 current.sheets.s!.cellData![2]![3]!.f='=SEQUENCE(100,1)*SEQUENCE(1,100)';await expect(kernel.calculate(current,1)).rejects.toThrow();
 current.sheets.s!.cellData![2]![3]!.f='=SEQUENCE(1000000)';await expect(kernel.calculate(current,2)).rejects.toThrow('registered live worksheet bounds');
});
it('rejects stale generations and never promotes a forged current cache into stored authority',async()=>{
 const source=model('=MISSING(A1)'),kernel=qualifiedArrayKernel(source,'array-live',sha),current=structuredClone(kernel.initial);
 const pending=kernel.calculate(current,1);kernel.invalidate();await expect(pending).rejects.toThrow('superseded');
 current.sheets.s!.cellData![2]![3]!.f='=NEWUNKNOWN(A1)';current.sheets.s!.cellData![2]![3]!.v=7777;
 const changed=await kernel.calculate(current,2);expect(changed.unavailable).toContain('["s",2,3]');expect(changed.cells.s?.[2]?.[3]).toBeUndefined();expect(changed.cells.s?.[0]?.[5]?.value).toBe(111);
});
it('undo/input identity and display-only theme changes retain source and calculated ownership independently',async()=>{
 const source=model(),kernel=qualifiedArrayKernel(source,'array-live',sha),current=structuredClone(kernel.initial);current.sheets.s!.cellData![0]![0]!.v=4;
 const first=await kernel.calculate(current,1);current.styles={...current.styles,theme:{cl:{rgb:'#ffffff'}}};const themed=await kernel.calculate(current,2);expect(themed.workbookCalculation.inputSha256).toBe(first.workbookCalculation.inputSha256);
 current.sheets.s!.cellData![0]![0]!.v=3;const undo=await kernel.calculate(current,3);expect(undo.owners[0]!.range.endRow).toBe(4);expect(kernel.original.sheets.s!.cellData![4]![3]!.v).toBe(12);
});

it('distinguishes genuine singleton arrays, ordinary references and blank reference-array anchors', async () => {
 const source=model();source.sheets[0]!.arrayFormulas=[];source.sheets[0]!.cells=source.sheets[0]!.cells.filter(cell=>cell.column!==3&&cell.column!==5);
 source.sheets[0]!.cells.push({row:1,column:0,kind:'number',value:2},{row:2,column:0,kind:'number',value:3});
 const kernel=qualifiedArrayKernel(source,'array-live',sha), current=structuredClone(kernel.initial);
 current.sheets.s!.cellData![0]![0]={};current.sheets.s!.cellData![0]![4]={f:'=A1:A3'};current.sheets.s!.cellData![0]![6]={f:'=A2'};current.sheets.s!.cellData![0]![8]={f:'=SEQUENCE(1)'};
 const result=await kernel.calculate(current,1);
 expect(result.cells.s?.[0]?.[4]).toEqual({kind:'blank',value:null});expect(result.cells.s?.[2]?.[4]).toEqual({kind:'number',value:3});
 expect(result.owners.map(owner=>owner.column).sort((a,b)=>a-b)).toEqual([4,8]);expect(result.cells.s?.[0]?.[6]).toEqual({kind:'number',value:2});
 current.sheets.s!.cellData![0]![8]!.f='=SEQUENCE(2)';expect((await kernel.calculate(current,2)).cells.s?.[1]?.[8]).toEqual({kind:'number',value:2});
});

it('keeps typed error-looking strings distinct from genuine errors and booleans', async () => {
 const kernel=qualifiedArrayKernel(model(),'array-live',sha), current=structuredClone(kernel.initial);
 current.sheets.s!.cellData![2]![3]!.f='=IF(SEQUENCE(2)=1,"#SPILL!",NA())';
 const result=await kernel.calculate(current,1);expect(result.cells.s?.[2]?.[3]).toEqual({kind:'string',value:'#SPILL!'});expect(result.cells.s?.[3]?.[3]).toEqual({kind:'error',value:'#N/A'});
 current.sheets.s!.cellData![2]![3]!.f='=SEQUENCE(2)>1';const booleans=await kernel.calculate(current,2);expect(booleans.cells.s?.[2]?.[3]).toEqual({kind:'boolean',value:false});expect(booleans.cells.s?.[3]?.[3]).toEqual({kind:'boolean',value:true});
});

it('requires dependency evidence when the worker has no UI controller to request it', async () => {
 const newAPI = FUniver.newAPI;
 const missingUi = vi.spyOn(FUniver, 'newAPI').mockImplementation(univer => {
  const injector = univer instanceof Univer ? univer.__getInjector() : univer;
  const api = newAPI.call(FUniver, univer), create = api.createWorkbook.bind(api);
  vi.spyOn(api, 'createWorkbook').mockImplementation((...args) => {
   const book = create(...args);
   // Model the actual worker boundary after workbook/UI startup: no UI
   // controller copied the dependency flag into the calculation request.
   injector.get(ICommandService).beforeCommandExecuted(command => {
    if (command.id === SetFormulaCalculationStartMutation.id) Object.assign(command.params ?? {}, { isCalculateTreeModel: false });
   });
   return book;
  });
  return api;
 });
 try {
  const kernel = qualifiedArrayKernel(model(), 'array-worker-boundary', sha);
  const result = await kernel.calculate(kernel.initial, 1);
  expect(result.cells.s?.[3]?.[3]).toEqual({ kind: 'number', value: 11 });
  expect(result.cells.s?.[0]?.[5]).toEqual({ kind: 'number', value: 111 });
  expect(result.unavailable).toEqual([]);
 } finally { missingUi.mockRestore(); }
});

it('calculates with the real non-Node headless worker lifecycle', async () => {
 const node = Object.getOwnPropertyDescriptor(process.versions, 'node')!;
 // Keep the process runtime intact, but enter the SDK branch used by an actual
 // browser worker: no Node-only eager controller and no rendered UI stage.
 Object.defineProperty(process.versions, 'node', { ...node, value: undefined });
 try {
  expect(isNodeEnv()).toBe(false);
  const kernel = qualifiedArrayKernel(model(), 'array-browser-worker', sha);
  const result = await kernel.calculate(kernel.initial, 1);
  expect(result.cells.s?.[3]?.[3]).toEqual({ kind: 'number', value: 11 });
  expect(result.cells.s?.[0]?.[5]).toEqual({ kind: 'number', value: 111 });
  expect(result.unavailable).toEqual([]);
 } finally { Object.defineProperty(process.versions, 'node', node); }
});
