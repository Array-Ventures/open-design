// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { DOCS_NORMAL_EDITOR_UNIT_ID_KEY, ICommandService, IUniverInstanceService, LocaleService, LocaleType, Univer, UniverInstanceType, UndoCommand, RedoCommand, type DocumentDataModel, type IWorkbookData } from '@univerjs/core';
import * as kernel from '@univerjs/preset-sheets-core';
import English from '@univerjs/preset-sheets-core/locales/en-US';
import type { FUniver } from '@univerjs/core/facade';
import { workbookDocumentSchema } from '@open-design/contracts/runtime/workbook';
import sourceModel from '../fixtures/workbook-browser-membership-model.json';
import { gridWorkbook } from '../../src/components/embedded/workbook/grid-model';
import { workbookGridEdits } from '../../src/components/embedded/workbook/grid-edits';
import { attachWorkbookRichInput } from '../../src/components/embedded/workbook/rich-cell-input';

it('rehydrates rich runs after the SDK clears an editor, then preserves them through append, Undo, Redo and submit', async () => {
  const model = workbookDocumentSchema.parse(sourceModel);
  const rich = model.sheets[0]!.cells.find(cell => cell.kind === 'string' && cell.runs && cell.runs.length > 1)!;
  expect(rich?.kind).toBe('string');
  const u = new Univer({ locale: LocaleType.EN_US, locales: { [LocaleType.EN_US]: English } });
  u.registerPlugin(kernel.UniverRenderEnginePlugin);
  u.registerPlugin(kernel.UniverDocsPlugin);
  u.registerPlugin(kernel.UniverFormulaEnginePlugin, { notExecuteFormula: true });
  u.registerPlugin(kernel.UniverSheetsPlugin, { notExecuteFormula: true });
  const input = gridWorkbook(model, 'rich-hydration', 'Rich').data as IWorkbookData;
  const book = u.createUnit<IWorkbookData, import('@univerjs/core').Workbook>(UniverInstanceType.UNIVER_SHEET, structuredClone(input));
  const initial = structuredClone(book.getSnapshot());
  const sheet = book.getSheetBySheetId(model.sheets[0]!.id)!;
  const injector = u.__getInjector();
  const commands = injector.get(ICommandService);
  const layout = sheet.getCellDocumentModelWithFormula(sheet.getCellRaw(rich.row, rich.column)!, rich.row, rich.column)!;
  const source = structuredClone(sheet.getCellRaw(rich.row, rich.column)!.p!);
  const bridge = {
    getEditCellState: () => ({
      unitId: book.getUnitId(), sheetId: sheet.getSheetId(),
      row: rich.row, column: rich.column, documentLayoutObject: layout,
    }),
    getEditorDirty: () => true,
    getCurrentEditorId: () => DOCS_NORMAL_EDITOR_UNIT_ID_KEY,
  };
  injector.add([kernel.IEditorBridgeService, { useValue: bridge as unknown as kernel.IEditorBridgeService }]);
  commands.registerCommand(kernel.ReplaceSnapshotCommand);
  const editor = u.createUnit(UniverInstanceType.UNIVER_DOC, { ...structuredClone(source), id: DOCS_NORMAL_EDITOR_UNIT_ID_KEY }) as DocumentDataModel;
  // Exercise the pinned controller's actual clear implementation. A render view
  // reset is inert here; documentDataModel.reset is the real SDK model operation.
  const clearController = Object.assign(Object.create(kernel.EditingRenderController.prototype), {
    _univerInstanceService: injector.get(IUniverInstanceService),
    _getEditorViewModel: () => ({ reset: () => undefined }),
  }) as { _emptyDocumentDataModel(style: object, removeStyle: boolean): void };
  clearController._emptyDocumentDataModel({}, false);
  expect(editor.getBody()!.dataStream).toBe('\r\n');
  expect(editor.getBody()!.textRuns).toBeUndefined();
  expect(sheet.getCellRaw(rich.row, rich.column)!.p).toEqual(source);
  const hook = attachWorkbookRichInput(u, { getActiveWorkbook: () => ({ getId: () => book.getUnitId() }) } as unknown as FUniver, kernel);
  try {
    // EditingRenderController._subscribeToCurrentCell executes this exact command
    // with the real Worksheet-produced layout, not a hand-built editor body.
    expect(commands.syncExecuteCommand(kernel.ReplaceSnapshotCommand.id, { unitId: DOCS_NORMAL_EDITOR_UNIT_ID_KEY, snapshot: layout.documentModel!.getSnapshot() })).toBe(true);
    expect(editor.getBody()!.textRuns).toEqual(source.body!.textRuns);
    const end = source.body!.dataStream.length - 2;
    expect(await commands.executeCommand(kernel.InsertTextCommand.id, { unitId: DOCS_NORMAL_EDITOR_UNIT_ID_KEY, range: { startOffset: end, endOffset: end, collapsed: true }, body: { dataStream: ' controls' }, debounce: false })).toBe(true);
    expect(editor.getBody()!.textRuns?.slice(0, source.body!.textRuns!.length)).toEqual(source.body!.textRuns);
    injector.get(IUniverInstanceService).focusUnit(DOCS_NORMAL_EDITOR_UNIT_ID_KEY);
    expect(await commands.executeCommand(UndoCommand.id)).toBe(true);
    expect(editor.getBody()!.dataStream).toBe(source.body!.dataStream);
    expect(editor.getBody()!.textRuns).toEqual(source.body!.textRuns);
    expect(await commands.executeCommand(RedoCommand.id)).toBe(true);
    expect(editor.getBody()!.dataStream).toBe(source.body!.dataStream.slice(0, -2) + ' controls\r\n');
    expect(sheet.getCellRaw(rich.row, rich.column)!.p).toEqual(source);
    const controller = Object.assign(Object.create(kernel.EditingRenderController.prototype), {
      _editorBridgeService: bridge,
      _univerInstanceService: injector.get(IUniverInstanceService),
      _localService: injector.get(LocaleService),
      _lexerTreeBuilder: injector.get(kernel.LexerTreeBuilder),
      _functionService: injector.get(kernel.IFunctionService),
      _sheetInterceptorService: injector.get(kernel.SheetInterceptorService),
      _commandService: commands,
    }) as InstanceType<typeof kernel.EditingRenderController>;
    await controller.submitCellData(editor);
    const cell = workbookGridEdits(model, 'a'.repeat(64), initial, book.getSnapshot()).edits.find(edit => edit.cell.row === rich.row && edit.cell.column === rich.column)!.cell;
    expect(cell.kind).toBe('string');
    if (cell.kind !== 'string' || rich.kind !== 'string') throw Error('Expected source rich text');
    expect(cell.value).toBe(rich.value + ' controls');
    expect(cell.runs?.slice(0, rich.runs!.length)).toEqual(rich.runs);
    expect(sheet.getCellRaw(rich.row, rich.column)!.p).toBeTruthy();
  } finally {
    hook.dispose();
    layout.documentModel?.dispose();
    u.dispose();
  }
});
