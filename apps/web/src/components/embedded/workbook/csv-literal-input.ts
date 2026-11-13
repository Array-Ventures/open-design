import { CellValueType, DOCS_NORMAL_EDITOR_UNIT_ID_KEY, IUniverInstanceService, type DocumentDataModel, type FUniver, type ICellData, type Univer } from '@univerjs/presets';
import { parseDelimitedText, validateDelimitedLiteral } from '@open-design/contracts/runtime/delimited-text';
import type { WorkbookDocument } from '@open-design/contracts/runtime/workbook';
type Kernel = typeof import('@univerjs/preset-sheets-core');

/** Preserve the editor's original text, not its already normalized value. The
 * pinned editor normalizes booleans/formula names before checking text format. */
export function csvLiteralCell(text: string, previous: ICellData | null | undefined): ICellData {
  validateDelimitedLiteral(text);
  return { ...(previous?.s === undefined ? {} : { s: previous.s }), v: text, t: CellValueType.FORCE_STRING, f: null, si: null, p: null };
}
export function csvPasteCells(text: string, model: WorkbookDocument, row: number, column: number): ICellData[][] {
  const sheet = model.sheets[0]; if (!sheet) throw Error('The CSV sheet is unavailable.');
  const allowed = new Set(sheet.cells.map(cell => `${cell.row}:${cell.column}`));
  return parseDelimitedText(text, '\t').map((fields, y) => fields.map((field, x) => {
    if (!allowed.has(`${row + y}:${column + x}`)) throw Error('Paste must fit existing CSV fields. Adding rows or fields is not supported yet.');
    return csvLiteralCell(field.value, { s: '0' });
  }));
}
/** Use supported kernel edit interception and facade range commands. The latter
 * retain the normal Undo/Redo and snapshot notifications. Rich clipboard HTML
 * is deliberately ignored: CSV accepts only its explicit plain-text payload. */
export function attachCsvLiteralInput(univer: Univer, api: FUniver, kernel: Kernel, element: HTMLElement, model: WorkbookDocument, onError: (message: string) => void) {
  const injector = univer.__getInjector(), bridge = injector.get(kernel.IEditorBridgeService), instances = injector.get(IUniverInstanceService);
  const book = api.getActiveWorkbook(); if (!book) throw Error('The CSV grid is unavailable.');
  const unitId = book.getId();
  const removeEdit = injector.get(kernel.SheetInterceptorService).writeCellInterceptor.intercept(kernel.AFTER_CELL_EDIT, {
    priority: 1000,
    handler(cell, context, next) {
      const editing = bridge.getEditCellState();
      if (context.unitId !== unitId || !editing || editing.unitId !== unitId || editing.sheetId !== context.subUnitId || editing.row !== context.row || editing.column !== context.col) return next(cell);
      const document = instances.getUnit<DocumentDataModel>(DOCS_NORMAL_EDITOR_UNIT_ID_KEY), stream = document?.getSnapshot().body?.dataStream;
      if (stream === undefined || !stream.endsWith('\r\n')) throw Error('The literal CSV input could not be verified.');
      try { const literal = csvLiteralCell(stream.slice(0, -2), cell || null); onError(''); return next(literal); }
      catch (error) { onError(error instanceof Error ? error.message : 'The literal CSV input could not be applied.'); throw error; }
    },
  });
  const clipboard = injector.get(kernel.ISheetClipboardService).addClipboardHook({ id: 'csv-literal-paste-guard', priority: 1000, onBeforePaste: () => { onError('Paste plain text with the keyboard into the selected CSV fields.'); return false; } });
  const paste = (event: ClipboardEvent) => {
    // During text editing, let the existing document editor preserve cursor and
    // selection; AFTER_CELL_EDIT above restores that document's exact text.
    if (bridge.isVisible().visible) return;
    let ownedTarget = element.contains(event.target as Node) || (event.target === document || event.target === document.body) && element.contains(document.activeElement);
    if (!ownedTarget) {
      // Univer's hidden grid input may live in its document renderer rather
      // than below the sheet canvas. Match that exact owned input, never an
      // unrelated textarea or a stale global focus flag.
      const editor = injector.get(kernel.IRenderManagerService).getRenderUnitById(DOCS_NORMAL_EDITOR_UNIT_ID_KEY)?.with(kernel.DocSelectionRenderService);
      ownedTarget = Boolean(editor?.inputElement && event.target === editor.inputElement);
    }
    if (!ownedTarget) return;
    event.preventDefault(); event.stopImmediatePropagation();
    try {
      if (!event.clipboardData?.types.includes('text/plain')) throw Error('Paste plain text into CSV. Formatting and images are not supported.');
      const sheet = api.getActiveWorkbook()?.getActiveSheet(), range = sheet?.getSelection()?.getActiveRange()?.getRange();
      if (!sheet || !range || !book.getWorkbookPermission().canEdit()) throw Error('The CSV selection is unavailable.');
      const cells = csvPasteCells(event.clipboardData.getData('text/plain'), model, range.startRow, range.startColumn);
      // One sparse range command retains atomic mutation/Undo semantics even
      // for ragged pasted rows. Validate every field before issuing it.
      const matrix: Record<number, Record<number, ICellData>> = {};
      for (let y = 0; y < cells.length; y++) matrix[range.startRow + y] = Object.fromEntries(cells[y]!.map((cell, x) => [range.startColumn + x, cell]));
      sheet.getRange(range.startRow, range.startColumn, cells.length, cells.reduce((maximum, row) => Math.max(maximum, row.length), 1)).setValues(matrix);
      onError('');
    } catch (error) { onError(error instanceof Error ? error.message : 'The CSV paste could not be applied.'); }
  };
  document.addEventListener('paste', paste, true);
  return { dispose() { removeEdit(); clipboard.dispose(); document.removeEventListener('paste', paste, true); } };
}
