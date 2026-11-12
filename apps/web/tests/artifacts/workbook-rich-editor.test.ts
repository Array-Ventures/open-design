// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import {
  createDocumentModelWithStyle,
  DOCS_NORMAL_EDITOR_UNIT_ID_KEY,
  FUniver,
  ICommandService,
  IUniverInstanceService,
  LocaleService,
  LocaleType,
  Univer,
  UniverInstanceType,
  type DocumentDataModel,
  type IWorkbookData,
} from '@univerjs/presets';
import * as kernel from '@univerjs/preset-sheets-core';
import English from '@univerjs/preset-sheets-core/locales/en-US';
import type { WorkbookDocument } from '@open-design/contracts/runtime/workbook';
import { gridWorkbook } from '../../src/components/embedded/workbook/grid-model';
import { workbookGridEdits } from '../../src/components/embedded/workbook/grid-edits';
import { attachWorkbookRichInput } from '../../src/components/embedded/workbook/rich-cell-input';
let cleanup = () => {};
afterEach(() => cleanup());
it.each([false, true])('keeps rich ownership through native editing, undo and disposal (fitted renderer: %s)', async rendered => {
  const model: WorkbookDocument = {
    version: 1,
    richTextMetadata: 'verified',
    date1904: false,
    activeSheetId: 's',
    styles: [{ font: { name: 'Calibri', family: 2, size: 11 } }],
    features: { charts: 0, drawings: 0, externalLinks: 0, macros: false, signed: false },
    sheets: [
      {
        id: 's',
        name: 'Rich',
        visibility: 'visible',
        rowCount: 100,
        columnCount: 26,
        cells: [{ row: 0, column: 0, kind: 'string', value: 'old', runs: [{ text: 'old', font: { bold: true } }] }],
        merges: [],
        rowDimensions: [],
        columnDimensions: [],
        frozenRows: 0,
        frozenColumns: 0,
      },
    ],
  };
  const univer = new Univer({ locale: LocaleType.EN_US, locales: { [LocaleType.EN_US]: English } });
  cleanup = () => univer.dispose();
  univer.registerPlugin(kernel.UniverDocsPlugin);
  univer.registerPlugin(kernel.UniverFormulaEnginePlugin, { notExecuteFormula: true });
  univer.registerPlugin(kernel.UniverSheetsPlugin, { notExecuteFormula: true });
  const core = univer.createUnit<IWorkbookData, import('@univerjs/presets').Workbook>(
      UniverInstanceType.UNIVER_SHEET,
      gridWorkbook(model, 'rich-grid', 'Rich').data as IWorkbookData,
    ),
    book = { save: () => structuredClone(core.getSnapshot()) },
    api = { getActiveWorkbook: () => ({ getId: () => core.getUnitId() }) } as unknown as FUniver,
    initial = book.save(),
    injector = univer.__getInjector(),
    sheet = core.getSheetBySheetId('s')!;
  let layoutState: Partial<kernel.IEditorBridgeServiceParam> = {};
  const bridge = {
    getEditCellState: () => ({ unitId: 'rich-grid', sheetId: 's', row: 0, column: 0, ...layoutState }),
    getEditorDirty: () => true,
    getCurrentEditorId: () => DOCS_NORMAL_EDITOR_UNIT_ID_KEY,
  };
  injector.add([kernel.IEditorBridgeService, { useValue: bridge as unknown as kernel.IEditorBridgeService }]);
  let removed = 0;
  const manager = injector.get(kernel.SheetInterceptorService).writeCellInterceptor,
    originalIntercept = manager.intercept.bind(manager);
  const intercept = vi.spyOn(manager, 'intercept').mockImplementation((...args) => {
    const stop = originalIntercept(...args);
    return () => {
      removed++;
      return stop();
    };
  });
  const hook = attachWorkbookRichInput(univer, api, kernel);
  intercept.mockRestore();
  cleanup = () => {
    hook.dispose();
    univer.dispose();
  };
  const inherited = sheet.getComposedCellStyle(0, 0);
  // Use the actual worksheet rich-cell layout path used by the browser.
  // The generic text factory omits its zero-width paragraph-break setting.
  const sourceCell = structuredClone(sheet.getCellRaw(0, 0)!);
  sourceCell.p!.body!.dataStream = 'sum(a1)+true\r\n';
  sourceCell.p!.body!.paragraphs![0]!.startIndex = sourceCell.p!.body!.dataStream.length - 2;
  const layout = sheet.getCellDocumentModel(sourceCell, inherited, { isDeepClone: true })!;
  const snapshot = structuredClone(layout.documentModel!.getSnapshot());
  if (rendered) {
    // Read-only render metrics boundary: the browser resize service fits a
    // 16px text skeleton plus 2px bottom padding into this 20px cell.
    layoutState = { documentLayoutObject: layout, position: { startX: 0, endX: 100, startY: 0, endY: 20 }, scaleX: 1, scaleY: 1 };
    const renders = {
      getRenderUnitById: () => ({ with: () => ({ getSkeleton: () => ({ getActualSize: () => ({ actualWidth: 60, actualHeight: 16 }) }) }) }),
    } as unknown as kernel.IRenderManagerService;
    injector.add([kernel.IRenderManagerService, { useValue: renders }]);
    snapshot.documentStyle!.marginTop = 2;
  }
  layout.documentModel!.dispose();
  snapshot.id = DOCS_NORMAL_EDITOR_UNIT_ID_KEY;
  snapshot.body!.textRuns = [{ st: 0, ed: 12, ts: { bl: 1 } }];
  const doc = univer.createUnit(UniverInstanceType.UNIVER_DOC, snapshot) as DocumentDataModel;
  const controller = Object.assign(Object.create(kernel.EditingRenderController.prototype), {
    _editorBridgeService: bridge,
    _univerInstanceService: injector.get(IUniverInstanceService),
    _localService: injector.get(LocaleService),
    _lexerTreeBuilder: injector.get(kernel.LexerTreeBuilder),
    _functionService: injector.get(kernel.IFunctionService),
    _sheetInterceptorService: injector.get(kernel.SheetInterceptorService),
    _commandService: injector.get(ICommandService),
  }) as InstanceType<typeof kernel.EditingRenderController>;
  await controller.submitCellData(doc);
  expect(sheet.getCellRaw(0, 0)!.p!.documentStyle).toEqual({});
  const plan = workbookGridEdits(model, 'a'.repeat(64), initial, book.save());
  expect(plan.styles).toBeUndefined();
  expect(plan.edits).toEqual([
    {
      sheetId: 's',
      cell: {
        row: 0,
        column: 0,
        kind: 'string',
        value: 'sum(a1)+true',
        runs: [{ text: 'sum(a1)+true', font: { bold: true } }],
      },
    },
  ]);
  expect(sheet.getCellRaw(0, 0)?.p).toBeTruthy();
  const currentEditor = bridge.getCurrentEditorId;
  bridge.getCurrentEditorId = () => 'stale-editor';
  expect(() =>
    injector.get(kernel.SheetInterceptorService).onWriteCell(core, sheet, 0, 0, { v: 'new', p: null }),
  ).toThrow('active rich editor');
  bridge.getCurrentEditorId = currentEditor;
  const instances = injector.get(IUniverInstanceService);
  instances.setCurrentUnitForType('rich-grid');
  instances.focusUnit('rich-grid');
  expect(injector.get(ICommandService).syncExecuteCommand('univer.command.undo')).toBe(true);
  expect(workbookGridEdits(model, 'a'.repeat(64), initial, book.save()).edits).toEqual([]);

  const resetEditor = (text: string) => {
    const next = createDocumentModelWithStyle(text, inherited).getSnapshot();
    next.id = DOCS_NORMAL_EDITOR_UNIT_ID_KEY;
    if (rendered) next.documentStyle!.marginTop = 2;
    next.body!.textRuns = [{ st: 0, ed: text.length, ts: { bl: 1 } }];
    doc.reset(next);
  };
  resetEditor("'0012");
  await controller.submitCellData(doc);
  expect(workbookGridEdits(model, 'a'.repeat(64), initial, book.save()).edits[0]!.cell).toMatchObject({
    kind: 'string',
    value: '0012',
    runs: [{ text: '0012', font: { bold: true } }],
  });
  resetEditor('=1+1');
  await controller.submitCellData(doc);
  expect(sheet.getCellRaw(0, 0)?.f).toBe('=1+1');
  expect(sheet.getCellRaw(0, 0)?.p ?? null).toBeNull();
  resetEditor('unsupported margin');
  const unsupported = doc.getSnapshot();
  unsupported.documentStyle!.marginLeft = 20;
  unsupported.body!.textRuns = [
    { st: 0, ed: 10, ts: { bl: 1 } },
    { st: 10, ed: 18, ts: { it: 1 } },
  ];
  doc.reset(unsupported);
  await controller.submitCellData(doc);
  expect(sheet.getCellRaw(0, 0)?.p?.documentStyle?.marginLeft).toBe(20);
  expect(() => workbookGridEdits(model, 'a'.repeat(64), initial, book.save())).toThrow('document formatting');
  // A stale editor from another cell must never rewrite a programmatic input.
  expect(injector.get(kernel.SheetInterceptorService).onWriteCell(core, sheet, 1, 0, { v: 'other' })).toMatchObject({
    v: 'other',
  });
  bridge.getEditCellState = () => ({ unitId: 'rich-grid', sheetId: 's', row: 1, column: 0 });
  resetEditor('0012');
  await controller.submitCellData(doc);
  expect(sheet.getCellRaw(1, 0)?.p ?? null).toBeNull();
  expect(sheet.getCellRaw(1, 0)?.v).toBe(12);
  bridge.getEditCellState = () => ({ unitId: 'rich-grid', sheetId: 's', row: 0, column: 0 });
  resetEditor('plain after disposal');
  hook.dispose();
  await controller.submitCellData(doc);
  expect(sheet.getCellRaw(0, 0)?.p ?? null).toBeNull();
  hook.dispose();
  expect(removed).toBe(1);
});
