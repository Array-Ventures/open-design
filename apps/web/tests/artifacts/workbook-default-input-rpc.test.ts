// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { DOCS_NORMAL_EDITOR_UNIT_ID_KEY, IUniverInstanceService, ICommandService, LocaleService, UniverInstanceType, type DocumentDataModel } from '@univerjs/core';
import { workbookDocumentSchema } from '@open-design/contracts/runtime/workbook';
import modelInput from '../fixtures/workbook-browser-membership-model.json';
import { createWorkbookMembershipRpcFixture } from '../helpers/workbook-membership-rpc-fixture';
import { NodeWorkbookWorker } from '../helpers/workbook-node-worker';
import { attachWorkbookRichInput } from '../../src/components/embedded/workbook/rich-cell-input';

it('uses the real SDK parser and actual calculation Worker for default-run numeric inputs and SUM 28/28/56', async () => {
  vi.stubGlobal('Worker', NodeWorkbookWorker);
  const f = await createWorkbookMembershipRpcFixture(true,100,12,false,workbookDocumentSchema.parse(modelInput));
  // Load UI facade extensions after the existing Worker-only FUniver owner
  // initializes; this fixture intentionally has no browser render manager.
  const kernel = await import('@univerjs/preset-sheets-core');
  let remove: { dispose(): void } | undefined;
  try {
    const born = await f.controller.add('Numeric',2); await f.calculation.awaitQuiescent();
    f.book.setActiveSheet(born.descriptor.sheetId);
    f.univer.registerPlugin(kernel.UniverDocsPlugin);
    const injector=f.univer.__getInjector(), instances=injector.get(IUniverInstanceService);
    let column=0, layout: ReturnType<import('@univerjs/core').Worksheet['getBlankCellDocumentModel']>;
    const sheet=instances.getUnit<import('@univerjs/core').Workbook>(f.book.getId(),UniverInstanceType.UNIVER_SHEET)!.getSheetBySheetId(born.descriptor.sheetId)!;
    const bridge={getEditCellState:()=>({unitId:f.book.getId(),sheetId:born.descriptor.sheetId,row:0,column,documentLayoutObject:layout}),getEditorDirty:()=>true,getCurrentEditorId:()=>DOCS_NORMAL_EDITOR_UNIT_ID_KEY};
    injector.add([kernel.IEditorBridgeService,{useValue:bridge as unknown as import('@univerjs/preset-sheets-core').IEditorBridgeService}]);
    remove=attachWorkbookRichInput(f.univer,f.api,kernel);
    const document=f.univer.createUnit(UniverInstanceType.UNIVER_DOC,{id:DOCS_NORMAL_EDITOR_UNIT_ID_KEY,body:{dataStream:'\r\n'}}) as DocumentDataModel;
    const controller=Object.assign(Object.create(kernel.EditingRenderController.prototype),{_editorBridgeService:bridge,_univerInstanceService:instances,_localService:injector.get(LocaleService),_lexerTreeBuilder:injector.get(kernel.LexerTreeBuilder),_functionService:injector.get(kernel.IFunctionService),_sheetInterceptorService:injector.get(kernel.SheetInterceptorService),_commandService:injector.get(ICommandService)}) as InstanceType<typeof kernel.EditingRenderController>;
    for(const [index,text] of ['28','28','=SUM(A1)','=SUM(B1)','=SUM(A1:B1)'].entries()){
      column=index;layout=sheet.getBlankCellDocumentModel(sheet.getCellRaw(0,column),0,column)!;
      const snapshot=structuredClone(layout.documentModel!.getSnapshot()),font=sheet.getComposedCellStyle(0,column);
      snapshot.id=DOCS_NORMAL_EDITOR_UNIT_ID_KEY;
      snapshot.documentStyle!.renderConfig={...snapshot.documentStyle!.renderConfig,background:{rgb:layout.fill}};
      snapshot.body={dataStream:text+'\r\n',paragraphs:[{startIndex:text.length,paragraphId:'input'}],textRuns:[{st:0,ed:1,ts:{cl:font.cl}},{st:1,ed:text.length,ts:{ff:font.ff,fs:font.fs,cl:font.cl}}]};
      layout.documentModel!.dispose();document.reset(snapshot);
      await controller.submitCellData(document);await f.calculation.awaitQuiescent();
    }
    const cells=f.book.save().sheets[born.descriptor.sheetId]!.cellData![0]!;
    expect(cells[0]).toMatchObject({v:28,t:2});expect(cells[1]).toMatchObject({v:28,t:2});
    expect(cells[0]!.p??null).toBeNull();expect(cells[1]!.p??null).toBeNull();
    expect([cells[2]!.v,cells[3]!.v,cells[4]!.v]).toEqual([28,28,56]);
    expect([cells[2]!.f,cells[3]!.f,cells[4]!.f]).toEqual(['=SUM(A1)','=SUM(B1)','=SUM(A1:B1)']);
    expect(f.owner.ready).toBe(true);
  } finally {remove?.dispose();await f.close();vi.unstubAllGlobals();}
},30_000);
