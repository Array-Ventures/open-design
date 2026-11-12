import { afterEach, expect, it, vi } from 'vitest';
import { CommandType, ICommandService, IUniverInstanceService, LocaleType, Univer, UniverInstanceType, type IWorkbookData, type Workbook } from '@univerjs/core';
import English from '@univerjs/sheets/locale/en-US';
import type { FUniver } from '@univerjs/core/facade';
import { CalculationMode, UniverSheetsFormulaPlugin } from '@univerjs/sheets-formula';
import { FormulaDataModel, UniverFormulaEnginePlugin } from '@univerjs/engine-formula';
import { SetRangeValuesCommand, SetStyleCommand, SetRangeValuesMutation, UniverSheetsPlugin } from '@univerjs/sheets';
import { WORKBOOK_MODEL_LIMITS } from '@open-design/contracts/runtime/workbook';
import type { WorkbookDocument } from '@open-design/contracts/runtime/workbook';
import { ownArrayInputNormalization } from '../../src/components/embedded/workbook/array-input-normalization';
import { attachWorkbookArrayCalculation } from '../../src/components/embedded/workbook/grid-array-calculation';
import { qualifiedArrayKernel, type QualifiedArrayProjection } from '../../src/components/embedded/workbook/qualified-array-kernel';
import type { ownArrayProjectionWorker } from '../../src/components/embedded/workbook/array-projection-owner';
import { prepareWorkbookArrayLiveSource } from '../../src/components/embedded/workbook/array-live-source';
import { workbookGridEdits } from '../../src/components/embedded/workbook/grid-edits';
const sha='a'.repeat(64);
const source: WorkbookDocument={version:1,calculationMetadata:'verified',date1904:false,activeSheetId:'s',styles:[{}],features:{charts:0,drawings:0,externalLinks:0,macros:false,signed:false},sheets:[{id:'s',name:'Inputs',visibility:'visible',rowCount:100,columnCount:20,frozenRows:0,frozenColumns:0,rowDimensions:[],columnDimensions:[],merges:[],arrayFormulas:[{kind:'array',calculation:'dynamic',row:2,column:3,range:{startRow:2,endRow:4,startColumn:3,endColumn:3}}],cells:[{row:0,column:0,kind:'number',value:3},{row:2,column:3,kind:'number',value:10,formula:'=SEQUENCE(A1,1,10)'},{row:3,column:3,kind:'number',value:11},{row:4,column:3,kind:'number',value:12},{row:0,column:5,kind:'number',value:111,formula:'=D4+100'}]}]};
let cleanup=()=>{};afterEach(()=>cleanup());
function setup(model: WorkbookDocument = source, render = { ready: Promise.resolve(), available: () => true }, beforePlugins?: (commands: ReturnType<Univer['__getInjector']>) => void) {
 const kernel=qualifiedArrayKernel(model,'unit',sha),univer=new Univer({locale:LocaleType.EN_US,locales:{[LocaleType.EN_US]:English}}),input=ownArrayInputNormalization(univer);beforePlugins?.(univer.__getInjector());univer.registerPlugin(UniverFormulaEnginePlugin,{notExecuteFormula:true});univer.registerPlugin(UniverSheetsPlugin,{notExecuteFormula:true});univer.registerPlugin(UniverSheetsFormulaPlugin,{initialFormulaComputing:CalculationMode.NO_CALCULATION});
 const core=univer.createUnit<IWorkbookData,Workbook>(UniverInstanceType.UNIVER_SHEET,structuredClone(kernel.initial)),commands=univer.__getInjector().get(ICommandService),listeners=new Set<(result:QualifiedArrayProjection)=>void>();
 univer.__getInjector().get(IUniverInstanceService).setCurrentUnitForType(core.getUnitId());univer.__getInjector().get(IUniverInstanceService).focusUnit(core.getUnitId());
 const baseline=structuredClone(core.getSnapshot()),snapshot=()=>structuredClone(core.getSnapshot()),repaint=vi.fn(),states:unknown[]=[];let generation=0,pending=Promise.resolve(),active=true;
 const owner={calculate(input:IWorkbookData){const ticket=++generation;pending=kernel.calculate(input,ticket).then(result=>{if(active)for(const listener of listeners)listener(result);});return ticket;},onResult(listener:(result:QualifiedArrayProjection)=>void){listeners.add(listener);return()=>listeners.delete(listener);},fail:vi.fn()} as unknown as ReturnType<typeof ownArrayProjectionWorker>;
 const api={getActiveWorkbook:()=>({getSheets:()=>[{refreshCanvas:repaint}]})} as unknown as FUniver;
 const calculation=attachWorkbookArrayCalculation(univer,api,model,kernel.original,snapshot(),sha,snapshot,owner,state=>states.push(state),render,input);
 cleanup=()=>{active=false;calculation.dispose();univer.dispose();};
 return {core,commands,snapshot,baseline,kernel,calculation,repaint,states,formulaData:()=>structuredClone(univer.__getInjector().get(FormulaDataModel).getFormulaData()),flush:()=>pending,owner};
}
it('runs main-kernel input, private array calculation, real cell interception and undo without follower journal writes',async()=>{
 const live=setup();await live.flush();const sheet=live.core.getSheetBySheetId('s')!;
 expect(sheet.getCell(3,3)?.v).toBe(11);expect(sheet.getCellRaw(3,3)?.v).toBeUndefined();
 const change=(value:number)=>live.commands.syncExecuteCommand(SetRangeValuesCommand.id,{unitId:'unit',subUnitId:'s',range:{startRow:0,endRow:0,startColumn:0,endColumn:0},value:{v:value,t:2}});
 expect(change(4)).toBe(true);await live.flush();expect(sheet.getCell(5,3)?.v).toBe(13);expect(sheet.getCellRaw(5,3)?.v).toBeUndefined();
 expect(workbookGridEdits(source,sha,live.baseline,live.snapshot()).edits).toEqual([{sheetId:'s',cell:{row:0,column:0,kind:'number',value:4}}]);
 expect(live.commands.syncExecuteCommand('univer.command.undo')).toBe(true);await live.flush();expect(sheet.getCell(5,3)?.v).toBeUndefined();expect(sheet.getCell(3,3)?.v).toBe(11);
 expect(live.commands.syncExecuteCommand('univer.command.redo')).toBe(true);await live.flush();expect(sheet.getCell(5,3)?.v).toBe(13);expect(live.repaint).toHaveBeenCalled();
});
it('protects proven followers but permits simultaneous owner removal and genuine input42',async()=>{
 const live=setup();await live.flush();const sheet=live.core.getSheetBySheetId('s')!;
 expect(()=>live.commands.syncExecuteCommand(SetRangeValuesMutation.id,{unitId:'unit',subUnitId:'s',cellValue:{3:{3:{v:42,t:2}}}})).toThrow('array owner');expect(sheet.getCellRaw(3,3)?.v).toBeUndefined();
 live.commands.syncExecuteCommand(SetRangeValuesMutation.id,{unitId:'unit',subUnitId:'s',cellValue:{2:{3:{f:null,v:null}},3:{3:{v:42,t:2}}}});await live.flush();
 expect(sheet.getCell(3,3)?.v).toBe(42);expect(sheet.getCell(0,5)?.v).toBe(142);expect(workbookGridEdits(source,sha,live.baseline,live.snapshot()).edits.some(edit=>edit.cell.row===3&&edit.cell.column===3&&edit.cell.value===42)).toBe(true);
});

it('admits source-bound interactive recovery but preserves unknown and legacy raw cache drafts unchanged', () => {
 const kernel=qualifiedArrayKernel(source,'unit',sha), before=structuredClone(kernel.original);
 expect(prepareWorkbookArrayLiveSource(source,kernel.original,sha)).toEqual(kernel.initial);
 expect(prepareWorkbookArrayLiveSource(source,kernel.original,sha,kernel.initial)).toEqual(kernel.initial);
 expect(prepareWorkbookArrayLiveSource(source,kernel.original,sha,kernel.original)).toBeUndefined();expect(kernel.original).toEqual(before);
 const unknown=structuredClone(source);delete unknown.calculationMetadata;expect(prepareWorkbookArrayLiveSource(unknown,kernel.original,sha)).toBeUndefined();
 expect(prepareWorkbookArrayLiveSource(source,kernel.original,undefined)).toBeUndefined();
 const retired=structuredClone(kernel.initial);retired.sheets.s!.cellData![2]![3]={};(retired.sheets.s!.cellData![3]??={})[3]={v:42,t:2};expect(prepareWorkbookArrayLiveSource(source,kernel.original,sha,retired)).toBeDefined();expect(retired.sheets.s!.cellData![3]![3]!.v).toBe(42);
});

it('permits native formatting on a projected follower without creating a literal or invalidating calculation identity', async () => {
 const live=setup();await live.flush();const sheet=live.core.getSheetBySheetId('s')!;
 expect(live.commands.syncExecuteCommand(SetStyleCommand.id,{unitId:'unit',subUnitId:'s',range:{startRow:3,endRow:3,startColumn:3,endColumn:3},style:{type:'bl',value:1}})).toBe(true);
 expect(sheet.getCell(3,3)?.v).toBe(11);expect(sheet.getCellRaw(3,3)?.v).toBeUndefined();
 const plan=workbookGridEdits(source,sha,live.baseline,live.snapshot());expect(plan.edits).toEqual([]);expect(plan.styles).toEqual([{sheetId:'s',row:3,column:3,bold:true}]);
});

function ordinarySource(): WorkbookDocument {
 const model=structuredClone(source);model.sheets[0]!.arrayFormulas=[];model.sheets[0]!.cells=model.sheets[0]!.cells.filter(cell=>cell.column!==3);model.sheets[0]!.cells.find(cell=>cell.column===5)!.value=100;return model;
}
it('discovers new arrays in a verified-empty ordinary workbook through native create, undo and redo', async()=>{
 const model=ordinarySource(),live=setup(model);await live.flush();const sheet=live.core.getSheetBySheetId('s')!;
 expect(prepareWorkbookArrayLiveSource(model,live.kernel.original,sha)).toBeDefined();
 expect(live.commands.syncExecuteCommand(SetRangeValuesCommand.id,{unitId:'unit',subUnitId:'s',range:{startRow:2,endRow:2,startColumn:3,endColumn:3},value:{f:'=SEQUENCE(A1,1,10)',v:null,t:null}})).toBe(true);await live.flush();
 expect(sheet.getCell(3,3)?.v).toBe(11);expect(sheet.getCell(0,5)?.v).toBe(111);expect(sheet.getCellRaw(3,3)?.v).toBeUndefined();
 const plan=workbookGridEdits(model,sha,live.baseline,live.snapshot());expect(plan.edits).toHaveLength(1);expect(plan.edits[0]!.cell.formula).toBe('=SEQUENCE(A1,1,10)');
 expect(live.commands.syncExecuteCommand('univer.command.undo')).toBe(true);await live.flush();expect(sheet.getCell(3,3)?.v).toBeUndefined();expect(sheet.getCell(0,5)?.v).toBe(100);
 expect(live.commands.syncExecuteCommand('univer.command.redo')).toBe(true);await live.flush();expect(sheet.getCell(3,3)?.v).toBe(11);
});
it('keeps real42 after removing a newly created owner and preserves genuine error/collision types', async()=>{
 const model=ordinarySource(),live=setup(model);await live.flush();const sheet=live.core.getSheetBySheetId('s')!;
 const write=(cellValue:unknown)=>live.commands.syncExecuteCommand(SetRangeValuesMutation.id,{unitId:'unit',subUnitId:'s',cellValue});
 write({2:{3:{f:'=SEQUENCE(A1,1,10)',v:null}},0:{6:{f:'=1/0',v:null}}});await live.flush();expect(sheet.getCell(0,6)?.v).toBe('#DIV/0!');
 write({5:{3:{v:99,t:2}}});await live.flush();write({0:{0:{v:4,t:2}}});await live.flush();expect(sheet.getCell(2,3)?.v).toBe('#SPILL!');expect(sheet.getCell(3,3)?.v).toBeUndefined();expect(sheet.getCellRaw(5,3)?.v).toBe(99);
 write({2:{3:{f:null,v:null}},3:{3:{v:42,t:2}}});await live.flush();expect(sheet.getCell(0,5)?.v).toBe(142);const plan=workbookGridEdits(model,sha,live.baseline,live.snapshot());expect(plan.edits.some(edit=>edit.cell.row===3&&edit.cell.column===3&&edit.cell.value===42)).toBe(true);
});
it('rebinds an acknowledged new source owner without accepting a projection from the previous source',async()=>{
 const ordinary=ordinarySource(),kernel=qualifiedArrayKernel(ordinary,'unit',sha),current=structuredClone(kernel.initial);(current.sheets.s!.cellData![2]??={})[3]={f:'=SEQUENCE(A1,1,10)'};const old=await kernel.calculate(current,1);
 const acknowledged=structuredClone(source),nextSha='b'.repeat(64),next=qualifiedArrayKernel(acknowledged,'unit',nextSha);
 const display=new (await import('../../src/components/embedded/workbook/array-projection-display')).ArrayProjectionDisplay(acknowledged,next.original,next.initial,nextSha);
 expect(display.accept(old)).toBe(false);expect(display.accept(await next.calculate(next.initial,1))).toBe(true);expect(display.display('s',3,3,{}).v).toBe(11);expect(next.initial.sheets.s!.cellData?.[3]?.[3]?.v).toBeUndefined();display.dispose();
});

it('coalesces actual projection updates until Rendered and never paints after disposal or without a render unit', async()=>{
 let rendered!:()=>void;const ready=new Promise<void>(resolve=>{rendered=resolve;}),available=vi.fn(()=>true),live=setup(source,{ready,available});
 expect(live.repaint).not.toHaveBeenCalled();await live.flush();expect(live.repaint).not.toHaveBeenCalled();
 live.commands.syncExecuteCommand(SetRangeValuesMutation.id,{unitId:'unit',subUnitId:'s',cellValue:{0:{0:{v:1,t:2}}}});await live.flush();expect(live.repaint).not.toHaveBeenCalled();expect(available).not.toHaveBeenCalled();
 rendered();await ready;await Promise.resolve();expect(live.repaint).toHaveBeenCalledTimes(1);expect(live.core.getSheetBySheetId('s')!.getCell(3,3)?.v).toBeUndefined();
 cleanup();let late!:()=>void;const later=new Promise<void>(resolve=>{late=resolve;}),closed=setup(source,{ready:later,available:()=>true});await closed.flush();closed.calculation.dispose();late();await later;await Promise.resolve();expect(closed.repaint).not.toHaveBeenCalled();
 cleanup();const headless=setup(source,{ready:Promise.resolve(),available:()=>false});await headless.flush();expect(headless.repaint).not.toHaveBeenCalled();
});


it('normalizes an existing source owner edit/removal and undo through the actual formula plugin', async () => {
 const live=setup();await live.flush();const sheet=live.core.getSheetBySheetId('s')!;
 const write=(value:unknown)=>live.commands.syncExecuteCommand(SetRangeValuesCommand.id,{unitId:'unit',subUnitId:'s',range:{startRow:2,endRow:2,startColumn:3,endColumn:3},value});
 expect(write({f:'=SEQUENCE(A1,1,20)',v:null,t:null})).toBe(true);await live.flush();
 expect(sheet.getCell(3,3)?.v).toBe(21);expect(sheet.getCell(0,5)?.v).toBe(121);expect(sheet.getCellRaw(3,3)?.v).toBeUndefined();
 expect(live.commands.syncExecuteCommand('univer.command.undo')).toBe(true);await live.flush();expect(sheet.getCell(3,3)?.v).toBe(11);
 expect(write({f:null,v:42,t:2})).toBe(true);await live.flush();expect(sheet.getCellRaw(2,3)?.v).toBe(42);expect(sheet.getCell(3,3)?.v).toBeUndefined();
 expect(live.commands.syncExecuteCommand('univer.command.undo')).toBe(true);await live.flush();expect(sheet.getCell(3,3)?.v).toBe(11);
});

it('rejects follower and out-of-bounds input before the SDK changes its formula metadata', async () => {
 const live=setup();await live.flush();const data=live.formulaData(),snapshot=live.snapshot();
 for(const cellValue of [{3:{3:{f:'=42',v:null}}},{100:{0:{f:'=42',v:null}}},{2:{3:{f:'='+ '1'.repeat(WORKBOOK_MODEL_LIMITS.text),v:null}}}]) {
  expect(()=>live.commands.syncExecuteCommand(SetRangeValuesMutation.id,{unitId:'unit',subUnitId:'s',cellValue})).toThrow();
  expect(live.formulaData()).toEqual(data);expect(live.snapshot()).toEqual(snapshot);
 }
});

it.each([
 ['cache value',{2:{3:{f:'=SEQUENCE(A1,1,20)',si:null,v:999,t:2}}}],
 ['wrong formula',{2:{3:{f:'=SEQUENCE(A1,1,99)',si:null,v:null,t:null}}}],
 ['shared formula',{2:{3:{f:'=SEQUENCE(A1,1,20)',si:'forged',v:null,t:null}}}],
 ['follower coordinate',{3:{3:{f:'=SEQUENCE(A1,1,20)',si:null,v:null,t:null}}}],
] as const)('rejects forged %s even inside an otherwise authorized input',async(_label,cellValue)=>{
 let inject=true;
 const live=setup(source,undefined,injector=>injector.get(ICommandService).beforeCommandExecuted((command,options)=>{
  if(inject&&command.id===SetRangeValuesMutation.id&&!options?.fromFormula){inject=false;injector.get(ICommandService).syncExecuteCommand(SetRangeValuesMutation.id,{unitId:'unit',subUnitId:'s',cellValue},{onlyLocal:true,fromFormula:true});}
 }));await live.flush();const before=live.snapshot(),metadata=live.formulaData();
 expect(()=>live.commands.syncExecuteCommand(SetRangeValuesMutation.id,{unitId:'unit',subUnitId:'s',cellValue:{2:{3:{f:'=SEQUENCE(A1,1,20)',v:null,t:null}}}})).toThrow('read-only projection');
 expect(live.snapshot()).toEqual(before);expect(live.formulaData()).toEqual(metadata);
 live.commands.syncExecuteCommand(SetRangeValuesMutation.id,{unitId:'unit',subUnitId:'s',cellValue:{2:{3:{f:'=SEQUENCE(A1,1,20)',v:null,t:null}}}});await live.flush();expect(live.core.getSheetBySheetId('s')!.getCell(3,3)?.v).toBe(21);
});

it('rejects unsolicited normalization after the genuine input completed',async()=>{
 const live=setup();await live.flush();
 live.commands.syncExecuteCommand(SetRangeValuesMutation.id,{unitId:'unit',subUnitId:'s',cellValue:{2:{3:{f:'=SEQUENCE(A1,1,20)',v:null,t:null}}}});await live.flush();const before=live.snapshot();
 expect(()=>live.commands.syncExecuteCommand(SetRangeValuesMutation.id,{unitId:'unit',subUnitId:'s',cellValue:{2:{3:{f:'=SEQUENCE(A1,1,20)',si:null,v:null,t:null}}}},{onlyLocal:true,fromFormula:true})).toThrow('read-only projection');
 expect(live.snapshot()).toEqual(before);
});


it('ends failed outer input authority before immediate same-turn forged normalization',async()=>{
 let fail=true;
 const live=setup(source,undefined,injector=>injector.get(ICommandService).beforeCommandExecuted((command,options)=>{
  if(fail&&command.id===SetRangeValuesMutation.id&&!options?.fromFormula){fail=false;throw new Error('SDK callback failed');}
 }));await live.flush();const before=live.snapshot();
 const params={unitId:'unit',subUnitId:'s',cellValue:{2:{3:{f:'=SEQUENCE(A1,1,20)',v:null,t:null}}}};
 expect(()=>live.commands.syncExecuteCommand(SetRangeValuesMutation.id,params)).toThrow('SDK callback failed');
 expect(()=>live.commands.syncExecuteCommand(SetRangeValuesMutation.id,{...params,cellValue:{2:{3:{f:'=SEQUENCE(A1,1,20)',si:null,v:null,t:null}}}},{onlyLocal:true,fromFormula:true})).toThrow('read-only projection');
 expect(live.snapshot()).toEqual(before);
 live.commands.syncExecuteCommand(SetRangeValuesMutation.id,params);await live.flush();expect(live.core.getSheetBySheetId('s')!.getCell(3,3)?.v).toBe(21);
});

it('supports the asynchronous public input API without retaining authorization across its promise',async()=>{
 const live=setup();await live.flush();
 const params={unitId:'unit',subUnitId:'s',cellValue:{2:{3:{f:'=SEQUENCE(A1,1,20)',v:null,t:null}}}};
 const pending=live.commands.executeCommand(SetRangeValuesMutation.id,params);
 expect(()=>live.commands.syncExecuteCommand(SetRangeValuesMutation.id,{...params,cellValue:{2:{3:{f:'=SEQUENCE(A1,1,20)',si:null,v:null,t:null}}}},{onlyLocal:true,fromFormula:true})).toThrow('read-only projection');
 expect(await pending).toBe(true);await live.flush();expect(live.core.getSheetBySheetId('s')!.getCell(3,3)?.v).toBe(21);
});

it('preserves public dispatch results and exceptions and restores only its own wrappers',async()=>{
 const univer=new Univer(),commands=univer.__getInjector().get(ICommandService),sync=commands.syncExecuteCommand,async=commands.executeCommand;
 const guard=ownArrayInputNormalization(univer);
 try {
  commands.registerCommand({id:'test.array-input.result',type:CommandType.COMMAND,handler:()=>37});
  commands.registerCommand({id:'test.array-input.error',type:CommandType.COMMAND,handler:()=>{throw new Error('Exact public error');}});
  expect(commands.syncExecuteCommand('test.array-input.result')).toBe(37);expect(await commands.executeCommand('test.array-input.result')).toBe(37);
  expect(()=>commands.syncExecuteCommand('test.array-input.error')).toThrow('Exact public error');await expect(commands.executeCommand('test.array-input.error')).rejects.toThrow('Exact public error');
  guard.dispose();expect(commands.syncExecuteCommand).toBe(sync);expect(commands.executeCommand).toBe(async);
  const next=ownArrayInputNormalization(univer),foreign=sync.bind(commands);commands.syncExecuteCommand=foreign;next.dispose();expect(commands.syncExecuteCommand).toBe(foreign);expect(commands.executeCommand).toBe(async);
 } finally {guard.dispose();univer.dispose();}
});
