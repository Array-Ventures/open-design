// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { DOCS_NORMAL_EDITOR_UNIT_ID_KEY, ICommandService, IUniverInstanceService, LocaleService, LocaleType, Univer, UniverInstanceType, type DocumentDataModel, type IWorkbookData } from '@univerjs/presets';
import type { FUniver } from '@univerjs/core/facade';
import * as kernel from '@univerjs/preset-sheets-core';
import English from '@univerjs/preset-sheets-core/locales/en-US';
import type { WorkbookDocument } from '@open-design/contracts/runtime/workbook';
import { gridWorkbook } from '../../src/components/embedded/workbook/grid-model';
import { workbookGridEdits } from '../../src/components/embedded/workbook/grid-edits';
import { attachWorkbookRichInput } from '../../src/components/embedded/workbook/rich-cell-input';

it.each([
  { fill: undefined, invalid: undefined }, { fill: '#FFEEAA', invalid: undefined },
  ...['background', 'extra-background', 'margin', 'drawing', 'structured-body'].map(invalid => ({ fill: undefined, invalid })),
])('admits only the owned blank editor background ($fill, $invalid)', async ({ fill, invalid }) => {
  const model: WorkbookDocument = { version: 1, date1904: false, activeSheetId: 's', richTextMetadata: 'verified', styles: [{}],
    features: { charts: 0, drawings: 0, externalLinks: 0, macros: false, signed: false },
    sheets: [{ id: 's', name: 'Blank', visibility: 'visible', rowCount: 100, columnCount: 26, cells: [], merges: [], rowDimensions: [], columnDimensions: [], frozenRows: 0, frozenColumns: 0 }] };
  const univer = new Univer({ locale: LocaleType.EN_US, locales: { [LocaleType.EN_US]: English } });
  univer.registerPlugin(kernel.UniverDocsPlugin);
  univer.registerPlugin(kernel.UniverFormulaEnginePlugin, { notExecuteFormula: true });
  univer.registerPlugin(kernel.UniverSheetsPlugin, { notExecuteFormula: true });
  const core = univer.createUnit<IWorkbookData, import('@univerjs/presets').Workbook>(UniverInstanceType.UNIVER_SHEET, gridWorkbook(model, 'blank-grid', 'Blank').data as IWorkbookData);
  const injector = univer.__getInjector(), sheet = core.getSheetBySheetId('s')!;
  if (fill) sheet.getCellMatrix().setValue(0, 0, { s: { bg: { rgb: fill } } });
  const initial = structuredClone(core.getSnapshot());
  // Actual public worksheet producer plus the exact pinned blank-cell editor
  // renderConfig assembly. This is not a browser resize/hit-testing proof.
  const layout = sheet.getBlankCellDocumentModel(sheet.getCellRaw(0, 0), 0, 0)!;
  const snapshot = structuredClone(layout.documentModel!.getSnapshot());
  snapshot.documentStyle!.renderConfig = { ...snapshot.documentStyle!.renderConfig,
    verticalAlign: layout.verticalAlign, horizontalAlign: layout.horizontalAlign, wrapStrategy: layout.wrapStrategy,
    background: { rgb: layout.fill }, centerAngle: 0, vertexAngle: 0 };
  snapshot.id = DOCS_NORMAL_EDITOR_UNIT_ID_KEY;
  snapshot.body = { dataStream: '28\r\n', paragraphs: [{ startIndex: 2, paragraphId: 'typed' }], textRuns: [{ st: 0, ed: 1, ts: { bl: 1 } }, { st: 1, ed: 2, ts: { it: 1 } }] };
  if (invalid === 'background') snapshot.documentStyle!.renderConfig!.background = { rgb: '#FF0000' };
  if (invalid === 'extra-background') Object.assign(snapshot.documentStyle!.renderConfig!.background!, { authored: true });
  if (invalid === 'margin') snapshot.documentStyle!.marginLeft = 99;
  if (invalid === 'drawing') snapshot.drawings = { unsupported: {} } as unknown as typeof snapshot.drawings;
  if (invalid === 'structured-body') snapshot.body!.tables = [{ startIndex: 0 }] as NonNullable<typeof snapshot.body>['tables'];
  layout.documentModel!.dispose();
  const bridge = { getEditCellState: () => ({ unitId: 'blank-grid', sheetId: 's', row: 0, column: 0, documentLayoutObject: layout }), getEditorDirty: () => true, getCurrentEditorId: () => DOCS_NORMAL_EDITOR_UNIT_ID_KEY };
  injector.add([kernel.IEditorBridgeService, { useValue: bridge as unknown as kernel.IEditorBridgeService }]);
  const hook = attachWorkbookRichInput(univer, { getActiveWorkbook: () => ({ getId: () => 'blank-grid' }) } as unknown as FUniver, kernel);
  const doc = univer.createUnit(UniverInstanceType.UNIVER_DOC, snapshot) as DocumentDataModel;
  const controller = Object.assign(Object.create(kernel.EditingRenderController.prototype), {
    _editorBridgeService: bridge, _univerInstanceService: injector.get(IUniverInstanceService), _localService: injector.get(LocaleService),
    _lexerTreeBuilder: injector.get(kernel.LexerTreeBuilder), _functionService: injector.get(kernel.IFunctionService),
    _sheetInterceptorService: injector.get(kernel.SheetInterceptorService), _commandService: injector.get(ICommandService),
  }) as InstanceType<typeof kernel.EditingRenderController>;
  try {
    await controller.submitCellData(doc);
    if (invalid) {
      expect(() => workbookGridEdits(model, 'a'.repeat(64), initial, core.getSnapshot())).toThrow(/document formatting|drawings|structured rich/);
      return;
    }
    expect(sheet.getCellRaw(0, 0)?.p?.documentStyle).toEqual({});
    const desired = structuredClone(core.getSnapshot());
    const cell = workbookGridEdits(model, 'a'.repeat(64), initial, desired).edits[0]!.cell;
    expect(cell).toMatchObject({ value: '28', runs: [{ text: '2', font: { bold: true } }, { text: '8', font: { italic: true } }] });
    expect(workbookGridEdits(model, 'a'.repeat(64), initial, JSON.parse(JSON.stringify(desired))).edits[0]!.cell).toEqual(cell);
  } finally { hook.dispose(); univer.dispose(); }
});
