// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { CellValueType, DOCS_NORMAL_EDITOR_UNIT_ID_KEY, type FUniver, ICommandService, IUniverInstanceService, LocaleService, LocaleType, Univer, UniverInstanceType, type DocumentDataModel } from '@univerjs/presets';
import * as kernel from '@univerjs/preset-sheets-core';
import English from '@univerjs/preset-sheets-core/locales/en-US';
import type { WorkbookDocument } from '@open-design/contracts/runtime/workbook';
import { attachCsvLiteralInput } from '../../src/components/embedded/workbook/csv-literal-input';
import { gridWorkbook } from '../../src/components/embedded/workbook/grid-model';
import { csvGridEdits } from '../../src/components/embedded/workbook/csv-grid-edits';
const model: WorkbookDocument = { version: 1, sourceFormat: 'csv', date1904: false, activeSheetId: 'csv', styles: [{ numberFormat: '@' }], features: { charts: 0, drawings: 0, externalLinks: 0, macros: false, signed: false }, sheets: [{ id: 'csv', name: 'Data', visibility: 'visible', rowCount: 2, columnCount: 4, merges: [], rowDimensions: [], columnDimensions: [], frozenRows: 0, frozenColumns: 0, cells: Array.from({ length: 8 }, (_, n) => ({ row: Math.floor(n / 4), column: n % 4, kind: 'string' as const, value: '', style: 0 })) }] };
let cleanup = () => {};
afterEach(() => cleanup());
it('runs the pinned UI editor normalization and actual kernel write/undo path without changing literal text', async () => {
  const univer = new Univer({ locale: LocaleType.EN_US, locales: { [LocaleType.EN_US]: English } });
  cleanup = () => univer.dispose();
  univer.registerPlugin(kernel.UniverDocsPlugin); univer.registerPlugin(kernel.UniverFormulaEnginePlugin, { notExecuteFormula: true }); univer.registerPlugin(kernel.UniverSheetsPlugin, { notExecuteFormula: true });
  const injector = univer.__getInjector(), initial = gridWorkbook(model, 'csv-grid', 'CSV').data as import('@univerjs/presets').IWorkbookData;
  const core = univer.createUnit<import('@univerjs/presets').IWorkbookData, import('@univerjs/presets').Workbook>(UniverInstanceType.UNIVER_SHEET, structuredClone(initial));
  let column = 0, row = 0, editingVisible = true;
  const errors: string[] = [], commands = injector.get(ICommandService);
  const book = { getId: () => core.getUnitId(), save: () => core.getSnapshot(), getWorkbookPermission: () => ({ canEdit: () => true }), getActiveSheet: () => ({
    getSelection: () => ({ getActiveRange: () => ({ getRange: () => ({ startRow: row, startColumn: column }) }) }),
    getRange: (r: number, c: number, rows: number, columns: number) => ({ setValues: (value: unknown) => commands.syncExecuteCommand(kernel.SetRangeValuesCommand.id, { unitId: core.getUnitId(), subUnitId: 'csv', range: { startRow: r, endRow: r + rows - 1, startColumn: c, endColumn: c + columns - 1 }, value }) }),
  }) };
  const baseline = structuredClone(book.save());
  const api = { getActiveWorkbook: () => book } as unknown as FUniver;
  const doc = univer.createUnit(UniverInstanceType.UNIVER_DOC, { id: DOCS_NORMAL_EDITOR_UNIT_ID_KEY, body: { dataStream: '\r\n' } }) as DocumentDataModel;
  const bridge = { getEditCellState: () => ({ unitId: book.getId(), sheetId: 'csv', row, column }), getEditorDirty: () => true, isVisible: () => ({ visible: editingVisible }) };
  injector.add([kernel.IEditorBridgeService, { useValue: bridge as unknown as kernel.IEditorBridgeService }]);
  injector.add([kernel.ISheetClipboardService, { useValue: { addClipboardHook: () => ({ dispose() {} }) } as unknown as kernel.ISheetClipboardService }]);
  const element = document.createElement('div'), hiddenInput = document.createElement('textarea'); document.body.append(element, hiddenInput);
  injector.add([kernel.IRenderManagerService, { useValue: { getRenderUnitById: () => ({ with: () => ({ inputElement: hiddenInput }) }) } as unknown as kernel.IRenderManagerService }]);
  const literal = attachCsvLiteralInput(univer, api, kernel, element, model, message => errors.push(message));
  cleanup = () => { literal.dispose(); univer.dispose(); element.remove(); hiddenInput.remove(); };
  // Harness only supplies UI services. submitCellData and its private internal
  // normalization/_submitEdit implementation are the actual pinned library.
  const controller = Object.assign(Object.create(kernel.EditingRenderController.prototype), {
    _editorBridgeService: bridge, _univerInstanceService: injector.get(IUniverInstanceService), _localService: injector.get(LocaleService),
    _lexerTreeBuilder: injector.get(kernel.LexerTreeBuilder), _functionService: injector.get(kernel.IFunctionService),
    _sheetInterceptorService: injector.get(kernel.SheetInterceptorService), _commandService: injector.get(ICommandService),
  }) as InstanceType<typeof kernel.EditingRenderController>;
  const values = ['001', '2026-11-12', '=sum(a2)+true', 'true'];
  for (column = 0; column < values.length; column++) {
    doc.reset({ id: DOCS_NORMAL_EDITOR_UNIT_ID_KEY, body: { dataStream: `${values[column]}\r\n` } });
    await controller.submitCellData(doc);
    expect(book.save().sheets.csv!.cellData![0]![column]).toMatchObject({ v: values[column], t: CellValueType.FORCE_STRING });
    expect(book.save().sheets.csv!.cellData![0]![column]!.f).toBeFalsy();
  }
  expect(csvGridEdits(model, 'a'.repeat(64), baseline, book.save()).edits.map(edit => edit.cell.value)).toEqual(values);
  editingVisible = false; row = 1; column = 0;
  injector.get(IUniverInstanceService).setCurrentUnitForType(core.getUnitId());
  injector.get(IUniverInstanceService).focusUnit(core.getUnitId());
  const pasted = ['009', '2026-01-02', '=sum(a1)', 'false'];
  const paste = (text: string, target: HTMLElement = element) => {
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { types: ['text/plain', 'text/html'], getData: (type: string) => type === 'text/plain' ? text : '<b>wrong HTML payload</b>' } });
    target.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
  };
  paste(pasted.join('\t'), hiddenInput);
  expect(errors.at(-1)).toBe('');
  for (let x = 0; x < pasted.length; x++) expect(book.save().sheets.csv!.cellData![1]![x]).toMatchObject({ v: pasted[x], t: CellValueType.FORCE_STRING });
  expect(commands.syncExecuteCommand('univer.command.undo')).toBe(true);
  expect(book.save().sheets.csv!.cellData![1]![0]!.v).toBe('');
  expect(commands.syncExecuteCommand('univer.command.redo')).toBe(true);
  expect(book.save().sheets.csv!.cellData![1]![0]!.v).toBe('009');
  const afterPaste = structuredClone(book.save()); paste('outside\tfields\tshould\tnever\twrite');
  expect(errors.at(-1)).toContain('existing CSV fields'); expect(book.save()).toEqual(afterPaste);
  expect(csvGridEdits(model, 'a'.repeat(64), baseline, book.save()).edits.map(edit => edit.cell.value)).toEqual([...values, ...pasted]);
  const foreign = document.createElement('textarea'); document.body.append(foreign);
  const outside = new Event('paste', { bubbles: true, cancelable: true }); foreign.dispatchEvent(outside);
  expect(outside.defaultPrevented).toBe(false); expect(book.save()).toEqual(afterPaste); foreign.remove();
});
