import {
  CellValueType,
  DOCS_NORMAL_EDITOR_UNIT_ID_KEY,
  DOCS_FORMULA_BAR_EDITOR_UNIT_ID_KEY,
  IUniverInstanceService,
  DocumentDataModel,
  type IDocumentData,
  type IStyleData,
  type Univer,
} from '@univerjs/core';
import type { FUniver } from '@univerjs/core/facade';
type Kernel = typeof import('@univerjs/preset-sheets-core');
const fontKeys = new Set(['ff', 'fs', 'bl', 'it', 'st', 'ul', 'va', 'cl']);
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
function contentSnapshot(
  snapshot: IDocumentData,
  style: IStyleData,
  formulaBar: boolean,
  defaults: IDocumentData['documentStyle'],
): IDocumentData | undefined {
  const doc = structuredClone(snapshot),
    layout = doc.documentStyle ?? {},
    align = style.ht ?? 0;
  const inline = {
    marginTop: style.pd?.t ?? 0,
    marginBottom: style.pd?.b ?? 2,
    marginLeft: style.pd?.l ?? 2,
    marginRight: style.pd?.r ?? 2,
  };
  const margins = formulaBar ? { marginTop: 5, marginBottom: 5, marginLeft: 0, marginRight: 0 } : inline;
  const renderKeys = new Set([
    'horizontalAlign',
    'verticalAlign',
    'centerAngle',
    'vertexAngle',
    'wrapStrategy',
    'cellValueType',
    'isRenderStyle',
    'isRotateNonEastAsian',
  ]);
  for (const [key, value] of Object.entries(layout)) {
    if (value == null) continue;
    if (key in margins) {
      if (value !== margins[key as keyof typeof margins]) return;
    } else if (key === 'pageSize') {
      if (
        typeof value !== 'object' ||
        Object.entries(value).some(
          ([key, value]) =>
            !['width', 'height'].includes(key) || typeof value !== 'number' || value < 0 || Number.isNaN(value),
        )
      )
        return;
    } else if (key === 'documentFlavor' || key === 'paragraphLineGapDefault') {
      if (value !== 0) return;
    } else if (key === 'defaultParagraphStyle') {
      if (
        typeof value !== 'object' ||
        Object.entries(value).some(([key, value]) => key !== 'horizontalAlign' || value !== align)
      )
        return;
    } else if (key === 'textStyle') {
      if (
        typeof value !== 'object' ||
        Object.entries(value).some(([key, value]) => !fontKeys.has(key) || !same(value, style[key as keyof IStyleData]))
      )
        return;
    } else if (key === 'renderConfig') {
      if (
        typeof value !== 'object' ||
        Object.entries(value).some(
          ([key, value]) =>
            value != null && (!renderKeys.has(key) || typeof value !== 'number' || !Number.isFinite(value)),
        )
      )
        return;
    } else if (!same(value, defaults?.[key as keyof NonNullable<typeof defaults>])) return;
  }
  for (const paragraph of doc.body?.paragraphs ?? []) {
    if (paragraph.paragraphStyle) {
      if (Object.entries(paragraph.paragraphStyle).some(([key, value]) => key !== 'horizontalAlign' || value !== align))
        return;
      delete paragraph.paragraphStyle;
    }
  }
  doc.documentStyle = {};
  return doc;
}
/** The real editor otherwise lifts a uniform run into cell.s and discards p.
 * Preserve the actual document before that normalization can flatten authored
 * run ownership. Only the matching editor/unit/cell can use this interception. */
export function attachWorkbookRichInput(univer: Univer, api: FUniver, kernel: Kernel) {
  const injector = univer.__getInjector(),
    bridge = injector.get(kernel.IEditorBridgeService),
    instances = injector.get(IUniverInstanceService),
    book = api.getActiveWorkbook();
  if (!book) throw Error('The rich cell workbook is unavailable.');
  const defaultDocument = new DocumentDataModel({ id: 'rich-editor-defaults', body: { dataStream: '\r\n' } }),
    defaults = structuredClone(defaultDocument.getSnapshot().documentStyle);
  defaultDocument.dispose();
  const unitId = book.getId();
  let active = true;
  const remove = injector.get(kernel.SheetInterceptorService).writeCellInterceptor.intercept(kernel.AFTER_CELL_EDIT, {
    priority: 900,
    handler(cell, context, next) {
      if (!active || context.unitId !== unitId || cell?.f) return next(cell);
      const edit = bridge.getEditCellState();
      if (
        !edit ||
        edit.unitId !== unitId ||
        edit.sheetId !== context.subUnitId ||
        edit.row !== context.row ||
        edit.column !== context.col
      )
        return next(cell);
      const previous = context.worksheet.getCellRaw(context.row, context.col);
      if (!previous?.p && !cell?.p) return next(cell);
      const editorId = bridge.getCurrentEditorId();
      if (editorId !== DOCS_NORMAL_EDITOR_UNIT_ID_KEY && editorId !== DOCS_FORMULA_BAR_EDITOR_UNIT_ID_KEY)
        throw Error('The active rich editor could not be verified.');
      const snapshot = instances.getUnit<DocumentDataModel>(editorId)?.getSnapshot(),
        body = snapshot?.body;
      if (!snapshot || !body?.dataStream.endsWith('\r\n'))
        throw Error('The active rich editor text could not be verified.');
      const style = context.worksheet.getComposedCellStyle(context.row, context.col);
      // An older, already unsupported document-style draft must not be silently
      // migrated into a supported one by discarding its authored properties.
      if (previous?.p && Object.keys(previous.p.documentStyle ?? {}).length)
        throw Error('Keep this rich draft open; its document formatting needs its own edit adapter.');
      let doc =
          contentSnapshot(snapshot, style, editorId === DOCS_FORMULA_BAR_EDITOR_UNIT_ID_KEY, defaults) ??
          structuredClone(snapshot),
        value = body.dataStream.slice(0, -2);
      if (cell?.t === CellValueType.FORCE_STRING && typeof cell.v === 'string' && value === `'${cell.v}` && !body.customRanges?.length && !body.customBlocks?.length && !body.customDecorations?.length && !body.tables?.length) {
        value = cell.v;
        doc = structuredClone(doc);
        doc.body!.dataStream = `${value}\r\n`;
        for (const run of doc.body!.textRuns ?? []) {
          run.st = Math.max(0, run.st - 1);
          run.ed = Math.max(0, run.ed - 1);
        }
        for (const paragraph of doc.body!.paragraphs ?? []) paragraph.startIndex--;
        for (const section of doc.body!.sectionBreaks ?? []) section.startIndex--;
      }
      doc.id = previous?.p?.id ?? `${unitId}:${context.subUnitId}:${context.row}:${context.col}`;
      return next({
        ...cell,
        s: previous?.s ?? null,
        p: doc,
        v: value,
        t: CellValueType.FORCE_STRING,
        f: null,
        si: null,
      });
    },
  });
  return {
    dispose() {
      if (!active) return;
      active = false;
      remove();
    },
  };
}
