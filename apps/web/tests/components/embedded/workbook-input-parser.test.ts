// @vitest-environment jsdom
import { createRequire, Module } from 'node:module';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';
const require = createRequire(realpathSync(resolve(process.cwd(), 'node_modules/@univerjs/preset-sheets-core/package.json')));
const core = require('@univerjs/core'), sheets = require('@univerjs/sheets'), docs = require('@univerjs/docs'), engine = require('@univerjs/engine-formula');
function entry(entry: 'cjs'|'es'|'compat') {
  const filename=resolve(dirname(require.resolve('@univerjs/sheets-ui')),entry==='compat'?'../index.js':`../${entry}/index.js`);
  const source=readFileSync(filename,'utf8'), loaded=new Module(filename);
  Object.assign(loaded,{filename,paths:(Module as unknown as {_nodeModulePaths(path:string):string[]})._nodeModulePaths(dirname(filename))});
  (loaded as unknown as {_compile(source:string,filename:string):void})._compile(entry==='cjs'?source:ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,filename);
  return loaded.exports;
}
for(const name of ['cjs','es','compat'] as const) it(`normalizes a detached actual ${name} submission before scalar parsing, with unchanged no-handler behavior`,async()=>{
  const sdk=entry(name),u=new core.Univer({locale:core.LocaleType.EN_US,locales:{[core.LocaleType.EN_US]:require('@univerjs/sheets/locale/en-US')}});
  u.registerPlugin(docs.UniverDocsPlugin);u.registerPlugin(engine.UniverFormulaEnginePlugin,{notExecuteFormula:true});u.registerPlugin(sheets.UniverSheetsPlugin,{notExecuteFormula:true});
  const book=u.createUnit(core.UniverInstanceType.UNIVER_SHEET,{id:'input-book',name:'Input',sheetOrder:['s'],styles:{},sheets:{s:{id:'s',name:'Input',rowCount:20,columnCount:10,cellData:{}}}});
  const injector=u.__getInjector(),sheet=book.getSheetBySheetId('s');
  let column=0;
  const bridge={getEditCellState:()=>({unitId:'input-book',sheetId:'s',row:0,column}),getEditorDirty:()=>true,getCurrentEditorId:()=>core.DOCS_NORMAL_EDITOR_UNIT_ID_KEY};
  const snapshot={id:core.DOCS_NORMAL_EDITOR_UNIT_ID_KEY,body:{dataStream:'28\r\n',paragraphs:[{startIndex:2,paragraphId:'input'}],textRuns:[{st:0,ed:1,ts:{cl:{rgb:'#000000'}}},{st:1,ed:2,ts:{ff:'"Calibri", sans-serif',fs:11,cl:{rgb:'#000000'}}}]}};
  const document=u.createUnit(core.UniverInstanceType.UNIVER_DOC,snapshot);
  const controller=Object.assign(Object.create(sdk.EditingRenderController.prototype),{_editorBridgeService:bridge,_univerInstanceService:injector.get(core.IUniverInstanceService),_localService:injector.get(core.LocaleService),_lexerTreeBuilder:injector.get(engine.LexerTreeBuilder),_functionService:injector.get(engine.IFunctionService),_sheetInterceptorService:injector.get(sheets.SheetInterceptorService),_commandService:injector.get(core.ICommandService)});
  try{
    await controller.submitCellData(document);
    const baseline=structuredClone(sheet.getCellRaw(0,0));expect(baseline.p).toBeTruthy();
    const point=core.createInterceptorKey('BEFORE_CELL_INPUT_PARSE');let called=0;
    const remove=injector.get(sheets.SheetInterceptorService).writeCellInterceptor.intercept(point,{handler:(value:typeof snapshot,context:{unitId:string;subUnitId:string;row:number;col:number;worksheet:unknown;workbook:unknown},next:(value:typeof snapshot)=>typeof snapshot)=>{
      called++;expect(context).toMatchObject({unitId:'input-book',subUnitId:'s',row:0,col:1});expect(context.worksheet).toBe(sheet);expect(context.workbook).toBe(book);
      const copy=structuredClone(value);copy.body.textRuns=[];return next(copy);
    }});
    column=1;await controller.submitCellData(document);remove();
    expect(called).toBe(1);expect(sdk.BEFORE_CELL_INPUT_PARSE).toBe(point);
    expect(sheet.getCellRaw(0,1)).toMatchObject({v:28,t:core.CellValueType.NUMBER});expect(sheet.getCellRaw(0,1).p??null).toBeNull();
    expect(document.getSnapshot().body.textRuns).toEqual(snapshot.body.textRuns);
    column=2;await controller.submitCellData(document);expect(sheet.getCellRaw(0,2)).toEqual(baseline);
    const skip=injector.get(sheets.SheetInterceptorService).writeCellInterceptor.intercept(point,{handler:(_value:unknown,_context:unknown,next:(value:null)=>null)=>next(null)});
    column=3;await controller.submitCellData(document);expect(sheet.getCellRaw(0,3)).toBeUndefined();skip();
  }finally{u.dispose();}
});
