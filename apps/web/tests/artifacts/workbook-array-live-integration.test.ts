import { afterEach, expect, it, vi } from 'vitest';
import { ICommandService, IUniverInstanceService, LocaleType, Univer, UniverInstanceType, type IWorkbookData, type Workbook } from '@univerjs/core';
import English from '@univerjs/sheets/locale/en-US';
import type { FUniver } from '@univerjs/core/facade';
import { UniverFormulaEnginePlugin } from '@univerjs/engine-formula';
import { SetRangeValuesCommand, SetRangeValuesMutation, UniverSheetsPlugin } from '@univerjs/sheets';
import type { WorkbookDocument } from '@open-design/contracts/runtime/workbook';
import { attachWorkbookArrayCalculation } from '../../src/components/embedded/workbook/grid-array-calculation';
import { qualifiedArrayKernel, type QualifiedArrayProjection } from '../../src/components/embedded/workbook/qualified-array-kernel';
import type { ownArrayProjectionWorker } from '../../src/components/embedded/workbook/array-projection-owner';
import { prepareWorkbookArrayLiveSource } from '../../src/components/embedded/workbook/array-live-source';
import { workbookGridEdits } from '../../src/components/embedded/workbook/grid-edits';
const sha='a'.repeat(64);
const source: WorkbookDocument={version:1,calculationMetadata:'verified',date1904:false,activeSheetId:'s',styles:[{}],features:{charts:0,drawings:0,externalLinks:0,macros:false,signed:false},sheets:[{id:'s',name:'Inputs',visibility:'visible',rowCount:100,columnCount:20,frozenRows:0,frozenColumns:0,rowDimensions:[],columnDimensions:[],merges:[],arrayFormulas:[{kind:'array',calculation:'dynamic',row:2,column:3,range:{startRow:2,endRow:4,startColumn:3,endColumn:3}}],cells:[{row:0,column:0,kind:'number',value:3},{row:2,column:3,kind:'number',value:10,formula:'=SEQUENCE(A1,1,10)'},{row:3,column:3,kind:'number',value:11},{row:4,column:3,kind:'number',value:12},{row:0,column:5,kind:'number',value:111,formula:'=D4+100'}]}]};
let cleanup=()=>{};afterEach(()=>cleanup());
function setup() {
 const kernel=qualifiedArrayKernel(source,'unit',sha),univer=new Univer({locale:LocaleType.EN_US,locales:{[LocaleType.EN_US]:English}});univer.registerPlugin(UniverFormulaEnginePlugin,{notExecuteFormula:true});univer.registerPlugin(UniverSheetsPlugin,{notExecuteFormula:true});
 const core=univer.createUnit<IWorkbookData,Workbook>(UniverInstanceType.UNIVER_SHEET,structuredClone(kernel.initial)),commands=univer.__getInjector().get(ICommandService),listeners=new Set<(result:QualifiedArrayProjection)=>void>();
 univer.__getInjector().get(IUniverInstanceService).setCurrentUnitForType(core.getUnitId());univer.__getInjector().get(IUniverInstanceService).focusUnit(core.getUnitId());
 const baseline=structuredClone(core.getSnapshot()),snapshot=()=>structuredClone(core.getSnapshot()),repaint=vi.fn(),states:unknown[]=[];let generation=0,pending=Promise.resolve(),active=true;
 const owner={calculate(input:IWorkbookData){const ticket=++generation;pending=kernel.calculate(input,ticket).then(result=>{if(active)for(const listener of listeners)listener(result);});return ticket;},onResult(listener:(result:QualifiedArrayProjection)=>void){listeners.add(listener);return()=>listeners.delete(listener);},fail:vi.fn()} as unknown as ReturnType<typeof ownArrayProjectionWorker>;
 const api={getActiveWorkbook:()=>({getSheets:()=>[{refreshCanvas:repaint}]})} as unknown as FUniver;
 const calculation=attachWorkbookArrayCalculation(univer,api,source,kernel.original,snapshot(),sha,snapshot,owner,state=>states.push(state));
 cleanup=()=>{active=false;calculation.dispose();univer.dispose();};
 return {core,commands,snapshot,baseline,kernel,calculation,repaint,states,flush:()=>pending,owner};
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
