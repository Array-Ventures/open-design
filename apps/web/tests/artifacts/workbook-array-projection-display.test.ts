import { expect, it } from 'vitest';
import type { WorkbookDocument } from '@open-design/contracts/runtime/workbook';
import { qualifiedArrayKernel } from '../../src/components/embedded/workbook/qualified-array-kernel';
import { ArrayProjectionDisplay } from '../../src/components/embedded/workbook/array-projection-display';
const sha='a'.repeat(64);
function model(): WorkbookDocument { return {version:1,calculationMetadata:'verified',date1904:false,activeSheetId:'s',styles:[{}],features:{charts:0,drawings:0,externalLinks:0,macros:false,signed:false},sheets:[{id:'s',name:'Inputs',visibility:'visible',rowCount:100,columnCount:20,frozenRows:0,frozenColumns:0,rowDimensions:[],columnDimensions:[],merges:[],arrayFormulas:[{kind:'array',calculation:'dynamic',row:2,column:3,range:{startRow:2,endRow:4,startColumn:3,endColumn:3}}],cells:[{row:0,column:0,kind:'number',value:3},{row:2,column:3,kind:'number',value:10,formula:'=SEQUENCE(A1,1,10)'},{row:3,column:3,kind:'number',value:11},{row:4,column:3,kind:'number',value:12}]}]}; }
it('displays actual computed followers without writing them and fences pending/source refresh',async()=>{
 const source=model(),kernel=qualifiedArrayKernel(source,'unit',sha),current=structuredClone(kernel.initial),display=new ArrayProjectionDisplay(source,kernel.original,current,sha);
 expect(display.status('s',3,3)).toBe('stored');current.sheets.s!.cellData![0]![0]!.v=4;display.update(current,true);expect(display.status('s',3,3)).toBe('pending');
 const projection=await kernel.calculate(current,1);expect(display.accept(projection)).toBe(true);expect(display.display('s',5,3,{})).toMatchObject({v:13,t:2});expect(current.sheets.s!.cellData?.[5]?.[3]).toBeUndefined();expect(display.isFollower('s',5,3)).toBe(true);
 current.sheets.s!.cellData![0]![0]!.v=1;display.update(current,true);expect(display.isFollower('s',5,3)).toBe(true);expect(display.accept(projection)).toBe(false);expect(display.display('s',5,3,{})).toEqual({});display.pause();expect(display.status('s',3,3)).toBe('stored');
 const refreshed=new ArrayProjectionDisplay(source,kernel.original,current,'b'.repeat(64));expect(refreshed.accept(projection)).toBe(false);
});
it('labels unsupported source followers stored, changed unknown anchors unavailable and real inputs authoritative',async()=>{
 const source=model();source.sheets[0]!.cells.find(cell=>cell.formula)!.formula='=MISSING(A1)';const kernel=qualifiedArrayKernel(source,'unit',sha),current=structuredClone(kernel.initial),display=new ArrayProjectionDisplay(source,kernel.original,current,sha);
 expect(display.accept(await kernel.calculate(current,1))).toBe(true);expect(display.status('s',3,3)).toBe('stored');expect(display.display('s',3,3,{}).v).toBe(11);
 current.sheets.s!.cellData![2]![3]!.f='=NEWUNKNOWN(A1)';(current.sheets.s!.cellData![3]??={})[3]={v:42,t:2};display.update(current,true);expect(display.accept(await kernel.calculate(current,2))).toBe(true);expect(display.status('s',2,3)).toBe('unavailable');expect(display.display('s',2,3,{v:999,f:'=NEWUNKNOWN(A1)'}).v).toBeNull();expect(display.display('s',3,3,{v:42,t:2})).toEqual({v:42,t:2});expect(display.isFollower('s',3,3)).toBe(false);display.dispose();
});
