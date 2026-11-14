// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { CellValueType, DOCS_NORMAL_EDITOR_UNIT_ID_KEY, ICommandService, IUniverInstanceService, LocaleService, LocaleType, Univer, UniverInstanceType, type DocumentDataModel, type IWorkbookData } from '@univerjs/presets';
import type { FUniver } from '@univerjs/core/facade';
import * as kernel from '@univerjs/preset-sheets-core';
import English from '@univerjs/preset-sheets-core/locales/en-US';
import type { WorkbookDocument } from '@open-design/contracts/runtime/workbook';
import { gridWorkbook } from '../../src/components/embedded/workbook/grid-model';
import { attachWorkbookRichInput } from '../../src/components/embedded/workbook/rich-cell-input';

it.each(['numeric','apostrophe','text-format','formula','cjk-locale','mixed','original-rich','stale-unit','stale-sheet','stale-row','foreign-editor','other-current-book','disposed'] as const)('preserves SDK input semantics and ownership: %s',async mode=>{
  const text=mode==='apostrophe'?"'0028":mode==='formula'?'=1+1':mode==='cjk-locale'?'２８':'28';
  const model:WorkbookDocument={version:1,date1904:false,activeSheetId:'s',styles:[{font:{name:'Calibri',family:2,size:11,color:{kind:'rgb',argb:'FF000000'}},...(mode==='text-format'?{numberFormat:'@'}:{})}],richTextMetadata:'verified',features:{charts:0,drawings:0,externalLinks:0,macros:false,signed:false},sheets:[{id:'s',name:'Input',visibility:'visible',rowCount:20,columnCount:10,cells:mode==='original-rich'?[{row:0,column:0,kind:'string',value:'old',runs:[{text:'old',font:{bold:true}}]}]:mode==='text-format'?[{row:0,column:0,kind:'blank',value:null,style:0}]:[],merges:[],rowDimensions:[],columnDimensions:[],frozenRows:0,frozenColumns:0}]};
  const locale=mode==='cjk-locale'?LocaleType.ZH_CN:LocaleType.EN_US;
  const u=new Univer({locale,locales:{[locale]:English}});
  u.registerPlugin(kernel.UniverDocsPlugin);u.registerPlugin(kernel.UniverFormulaEnginePlugin,{notExecuteFormula:true});u.registerPlugin(kernel.UniverSheetsPlugin,{notExecuteFormula:true});
  const book=u.createUnit<IWorkbookData,import('@univerjs/core').Workbook>(UniverInstanceType.UNIVER_SHEET,gridWorkbook(model,'policy-book','Input').data as IWorkbookData),sheet=book.getSheetBySheetId('s')!,injector=u.__getInjector();
  // The real editor uses the deep-cloned existing-cell path for source rich text.
  const layout=(mode==='original-rich'?sheet.getCellDocumentModelWithFormula(sheet.getCellRaw(0,0)!,0,0):sheet.getBlankCellDocumentModel(sheet.getCellRaw(0,0),0,0))!,font=sheet.getComposedCellStyle(0,0),snapshot=structuredClone(layout.documentModel!.getSnapshot());
  snapshot.id=DOCS_NORMAL_EDITOR_UNIT_ID_KEY;snapshot.documentStyle!.renderConfig={...snapshot.documentStyle!.renderConfig,background:{rgb:layout.fill}};
  snapshot.body={dataStream:text+'\r\n',paragraphs:[{startIndex:text.length,paragraphId:'input'}],textRuns:[{st:0,ed:1,ts:{cl:font.cl,...(mode==='mixed'?{bl:1}:{})}},{st:1,ed:text.length,ts:{ff:font.ff,fs:font.fs,cl:font.cl,...(mode==='mixed'?{it:1}:{})}}]};
  layout.documentModel!.dispose();
  if(mode==='original-rich')expect(sheet.getCellRaw(0,0)!.p!.documentStyle).toEqual({});
  let reads=0;
  const bridge={getEditCellState:()=>{reads++;const stale=reads>1;return{unitId:stale&&mode==='stale-unit'?'foreign':'policy-book',sheetId:stale&&mode==='stale-sheet'?'foreign':'s',row:stale&&mode==='stale-row'?1:0,column:0,documentLayoutObject:layout};},getEditorDirty:()=>true,getCurrentEditorId:()=>mode==='foreign-editor'?'foreign-editor':DOCS_NORMAL_EDITOR_UNIT_ID_KEY};
  injector.add([kernel.IEditorBridgeService,{useValue:bridge as unknown as kernel.IEditorBridgeService}]);let activeId='policy-book';
  const hook=attachWorkbookRichInput(u,{getActiveWorkbook:()=>({getId:()=>activeId})} as unknown as FUniver,kernel);
  const doc=u.createUnit(UniverInstanceType.UNIVER_DOC,snapshot) as DocumentDataModel;
  const controller=Object.assign(Object.create(kernel.EditingRenderController.prototype),{_editorBridgeService:bridge,_univerInstanceService:injector.get(IUniverInstanceService),_localService:injector.get(LocaleService),_lexerTreeBuilder:injector.get(kernel.LexerTreeBuilder),_functionService:injector.get(kernel.IFunctionService),_sheetInterceptorService:injector.get(kernel.SheetInterceptorService),_commandService:injector.get(ICommandService)}) as InstanceType<typeof kernel.EditingRenderController>;
  try{
    if(mode==='disposed')hook.dispose();if(mode==='other-current-book')activeId='other';
    if(mode==='foreign-editor')await expect(controller.submitCellData(doc)).rejects.toThrow('active rich editor');
    else{
      await controller.submitCellData(doc);const cell=sheet.getCellRaw(0,0)!;
      if(mode==='numeric'||mode==='cjk-locale'){expect(cell).toMatchObject({v:28,t:CellValueType.NUMBER});expect(cell.p??null).toBeNull();}
      else if(mode==='apostrophe'){expect(cell).toMatchObject({v:'0028',t:CellValueType.FORCE_STRING});expect(cell.p??null).toBeNull();}
      else if(mode==='text-format'){expect(cell.v).toBe('28');expect(cell.p??null).toBeNull();expect(cell.s).toBe('0');}
      else if(mode==='formula'){expect(cell.f).toBe('=1+1');expect(cell.p??null).toBeNull();}
      else{expect(cell.p?.body?.dataStream).toBe(text+'\r\n');expect(typeof cell.v).not.toBe('number');if(mode==='mixed'){expect(cell.p!.body!.textRuns![0]!.ts!.bl).toBe(1);expect(cell.p!.body!.textRuns![1]!.ts!.it).toBe(1);}}
    }
    expect(doc.getSnapshot().body!.textRuns).toEqual(snapshot.body!.textRuns);
  }finally{hook.dispose();u.dispose();}
});
