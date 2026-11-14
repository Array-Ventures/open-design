import { expect, it } from 'vitest';
import { CommandType, IUniverInstanceService, UniverInstanceType, UndoCommand, type DocumentDataModel, type IDocumentData } from '@univerjs/core';
import { InsertSheetMutation, RemoveSheetMutation } from '@univerjs/sheets';
import { createWorkbookHistoryControllerFixture } from '../helpers/workbook-history-controller-fixture';

const malformed: { label: string; insert: Record<string,unknown>; remove: Record<string,unknown> }[] = [
  { label:'missing both IDs', insert:{sheet:{}}, remove:{} },
  { label:'missing both containers', insert:{}, remove:{} },
  { label:'undefined IDs', insert:{sheet:{id:undefined}}, remove:{subUnitId:undefined} },
  { label:'array sheet', insert:{sheet:[]}, remove:{} },
  { label:'nonstring IDs', insert:{sheet:{id:0}}, remove:{subUnitId:0} },
];
it.each(malformed)('refuses actual membership with $label before the original handler attempts a nested mutation', async shape => {
  const h = createWorkbookHistoryControllerFixture();
  let nested = 0;
  const listener = h.commands.beforeCommandExecuted(command => {
    if (command.id === RemoveSheetMutation.id || command.id === InsertSheetMutation.id) nested++;
  });
  try {
    h.history.pushUndoRedo({unitID:h.book.getId(),
      undoMutations:[{id:RemoveSheetMutation.id,params:{unitId:h.book.getId(),...shape.remove}}],
      redoMutations:[{id:InsertSheetMutation.id,params:{unitId:h.book.getId(),...shape.insert}}],
    });
    const before = h.book.save(), status = h.history.getUndoRedoStatus(h.book.getId());
    const failure = await h.api.undo().catch(error => error);
    expect.soft(nested).toBe(0);
    expect(failure).toBeInstanceOf(Error);
    expect(h.book.save()).toEqual(before);
    expect(h.history.getUndoRedoStatus(h.book.getId())).toEqual(status);
    expect(h.writer.checkpoint().sheetActionConflict).toBeUndefined();
    expect(h.writes).toBe(0);
  } finally {listener.dispose();await h.close();}
});
it('preserves actual ordinary workbook async and synchronous history', async () => {
  const h = createWorkbookHistoryControllerFixture();
  try {
    const cell = h.book.getActiveSheet().getRange('A1');
    cell.setValue(17);
    expect(await h.api.undo()).toBe(true);
    expect(cell.getValue()).toBe(12);
    expect(await h.api.redo()).toBe(true);
    expect(cell.getValue()).toBe(17);
    expect(h.commands.syncExecuteCommand(UndoCommand.id)).toBe(true);
    expect(cell.getValue()).toBe(12);
    expect(h.writer.checkpoint().sheetActionConflict).toBeUndefined();
  } finally {await h.close();}
});
it('delegates actual unrelated Doc unit history without interpreting it as workbook membership', async () => {
  const h = createWorkbookHistoryControllerFixture();
  try {
    const doc = h.univer.createUnit<IDocumentData,DocumentDataModel>(UniverInstanceType.UNIVER_DOC, {id:'unrelated-doc-history',body:{dataStream:'After\r\n'}});
    h.univer.__getInjector().get(IUniverInstanceService).focusUnit(doc.getUnitId());
    const id = 'test.doc.set-body';
    h.commands.registerCommand({id,type:CommandType.MUTATION,handler:(_accessor,params?:{value:string})=>{
      if (!params) return false;
      doc.reset({body:{dataStream:params.value}}); return true;
    }});
    h.history.pushUndoRedo({unitID:doc.getUnitId(),undoMutations:[{id,params:{value:'Before\r\n'}}],redoMutations:[{id,params:{value:'After\r\n'}}]});
    expect(h.history.getUndoRedoCheckpoint().unitId).toBe(doc.getUnitId());
    expect(await h.api.undo()).toBe(true);
    expect(doc.getBody()?.dataStream).toBe('Before\r\n');
    expect(await h.api.redo()).toBe(true);
    expect(doc.getBody()?.dataStream).toBe('After\r\n');
    expect(h.commands.syncExecuteCommand(UndoCommand.id)).toBe(true);
    expect(doc.getBody()?.dataStream).toBe('Before\r\n');
    expect(h.book.getActiveSheet().getRange('A1').getValue()).toBe(12);
    expect(h.writer.checkpoint().sheetActionConflict).toBeUndefined();
  } finally {await h.close();}
});
