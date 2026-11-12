import { BaselineOffset, BooleanNumber, BorderStyleTypes, CellValueType, DateSystem, HorizontalAlign, LocaleType, TextDecoration, VerticalAlign, WrapStrategy, WorksheetHiddenState, type ICellData, type IObjectMatrixPrimitiveType, type IStyleBase, type IStyleData, type IWorkbookData } from '@univerjs/presets';
import { workbookDocumentSchema, type WorkbookCell, type WorkbookColor, type WorkbookDocument, type WorkbookFont, type WorkbookStyle } from '@open-design/contracts/runtime/workbook';

export type WorkbookDisplayGap = 'indexed-colors' | 'tinted-colors' | 'gradient-fills' | 'pattern-fills' | 'alignment' | 'drawings';
export interface GridWorkbook { data: Partial<IWorkbookData>; activeSheetId: string; gaps: WorkbookDisplayGap[] }

/** Input colors belong to workbook content, not the application theme. Do not
 * invent a UI palette or silently report an unsupported style as faithful. */
function color(input: WorkbookColor | undefined, model: WorkbookDocument, gaps: Set<WorkbookDisplayGap>) {
  if (!input || input.kind === 'auto') return undefined;
  if (input.kind === 'indexed') { gaps.add('indexed-colors'); return undefined; }
  if (input.tint) gaps.add('tinted-colors');
  const argb = input.kind === 'rgb' ? input.argb : model.themeColors?.[input.index];
  if (!argb) return undefined;
  return { rgb: `#${argb.slice(2)}${argb.slice(0, 2) === 'FF' ? '' : argb.slice(0, 2)}` };
}
function font(input: WorkbookFont | undefined, model: WorkbookDocument, gaps: Set<WorkbookDisplayGap>): IStyleBase {
  if (!input) return {};
  const decoration = input.underline && ({ single: TextDecoration.SINGLE, double: TextDecoration.DOUBLE, singleAccounting: TextDecoration.SINGLE_ACCOUNTING, doubleAccounting: TextDecoration.DOUBLE_ACCOUNTING } as const)[input.underline];
  return { ...(input.name === undefined ? {} : { ff: input.name }), ...(input.size === undefined ? {} : { fs: input.size }),
    ...(input.bold === undefined ? {} : { bl: input.bold ? BooleanNumber.TRUE : BooleanNumber.FALSE }),
    ...(input.italic === undefined ? {} : { it: input.italic ? BooleanNumber.TRUE : BooleanNumber.FALSE }),
    ...(input.strike === undefined ? {} : { st: { s: input.strike ? BooleanNumber.TRUE : BooleanNumber.FALSE } }),
    ...(decoration === undefined ? {} : { ul: { s: BooleanNumber.TRUE, t: decoration } }),
    ...(input.vertical === undefined ? {} : { va: input.vertical === 'superscript' ? BaselineOffset.SUPERSCRIPT : BaselineOffset.SUBSCRIPT }), cl: color(input.color, model, gaps) };
}
const borders: Record<NonNullable<NonNullable<WorkbookStyle['borders']>['top']>['style'], BorderStyleTypes> = {
  thin: BorderStyleTypes.THIN, dotted: BorderStyleTypes.DOTTED, hair: BorderStyleTypes.HAIR, medium: BorderStyleTypes.MEDIUM, double: BorderStyleTypes.DOUBLE, thick: BorderStyleTypes.THICK,
  dashDot: BorderStyleTypes.DASH_DOT, dashDotDot: BorderStyleTypes.DASH_DOT_DOT, slantDashDot: BorderStyleTypes.SLANT_DASH_DOT, mediumDashed: BorderStyleTypes.MEDIUM_DASHED,
  mediumDashDotDot: BorderStyleTypes.MEDIUM_DASH_DOT_DOT, mediumDashDot: BorderStyleTypes.MEDIUM_DASH_DOT, dashed: BorderStyleTypes.DASHED,
};
function style(input: WorkbookStyle, model: WorkbookDocument, gaps: Set<WorkbookDisplayGap>, normal = false): IStyleData {
  const value: IStyleData = { ...font(input.font, model, gaps), ...(input.numberFormat === undefined ? {} : { n: { pattern: input.numberFormat } }) };
  if (!normal && input.font?.color?.kind === 'auto') value.cl = { rgb: 'rgb(0, 0, 0)' };
  if (input.fill) {
    if ('gradient' in input.fill) gaps.add('gradient-fills');
    else if (!normal && input.fill.pattern === 'none') value.bg = { rgb: 'rgba(0,0,0,0)' };
    else if (input.fill.pattern === 'solid') value.bg = color(input.fill.foreground, model, gaps);
    else if (!['none', 'gray125'].includes(input.fill.pattern)) gaps.add('pattern-fills');
  }
  if (input.alignment) {
    const { horizontal, vertical, wrap, shrink, rotation, indent } = input.alignment;
    const horizontalMap = { general: HorizontalAlign.UNSPECIFIED, left: HorizontalAlign.LEFT, center: HorizontalAlign.CENTER, right: HorizontalAlign.RIGHT, justify: HorizontalAlign.JUSTIFIED, distributed: HorizontalAlign.DISTRIBUTED };
    if (horizontal && horizontal in horizontalMap) value.ht = horizontalMap[horizontal as keyof typeof horizontalMap];
    else if (horizontal) gaps.add('alignment');
    if (vertical && ['top', 'middle', 'bottom'].includes(vertical)) value.vt = ({ top: VerticalAlign.TOP, middle: VerticalAlign.MIDDLE, bottom: VerticalAlign.BOTTOM })[vertical as 'top' | 'middle' | 'bottom'];
    else if (vertical) gaps.add('alignment');
    if (indent) gaps.add('alignment');
    if (wrap !== undefined) value.tb = wrap ? WrapStrategy.WRAP : WrapStrategy.OVERFLOW;
    if (shrink !== undefined) value.stf = shrink ? BooleanNumber.TRUE : BooleanNumber.FALSE;
    if (rotation !== undefined) value.tr = { a: rotation === 'vertical' ? 0 : rotation, v: rotation === 'vertical' ? BooleanNumber.TRUE : BooleanNumber.FALSE };
  }
  if (input.borders) {
    value.bd = {};
    for (const [edge, key] of [['top', 't'], ['right', 'r'], ['bottom', 'b'], ['left', 'l'], ['diagonal', input.borders.diagonalUp ? 'bl_tr' : 'tl_br']] as const) {
      const border = input.borders[edge];
      if (border) value.bd[key] = { s: borders[border.style]!, cl: color(border.color, model, gaps) ?? {} };
    }
    if (input.borders.diagonal && input.borders.diagonalUp && input.borders.diagonalDown) value.bd.tl_br = { ...value.bd.bl_tr! };
  }
  return value;
}
function cellValue(cell: WorkbookCell, model: WorkbookDocument, gaps: Set<WorkbookDisplayGap>, scope: string): ICellData {
  const value: ICellData = { ...(cell.style === undefined ? {} : { s: String(cell.style) }), ...(cell.formula === undefined ? {} : { f: cell.formula }) };
  if (cell.kind === 'blank') return value;
  value.v = cell.kind === 'boolean' ? Number(cell.value) : cell.value;
  value.t = cell.kind === 'number' ? CellValueType.NUMBER : cell.kind === 'boolean' ? CellValueType.BOOLEAN : CellValueType.FORCE_STRING;
  if (cell.kind === 'string' && cell.runs) {
    let offset = 0;
    value.p = { id: `${scope}:${cell.row}:${cell.column}`, documentStyle: {}, body: { dataStream: `${cell.value}\r\n`, paragraphs: [{ startIndex: cell.value.length, paragraphId: 'p0' }],
      textRuns: cell.runs.map(run => { const st = offset; offset += run.text.length; return { st, ed: offset, ts: font(run.font, model, gaps) }; }) } };
  }
  return value;
}

/** Display-only adapter. OOXML remains authoritative; Univer serialization is
 * never used to save the package, styles or uncaptured workbook parts. */
export function gridWorkbook(input: WorkbookDocument, id: string, title: string, defaultTextColor?: string): GridWorkbook {
  const model = workbookDocumentSchema.parse(input), gaps = new Set<WorkbookDisplayGap>();
  const data: Partial<IWorkbookData> = { id, name: title, appVersion: '1.4.0', locale: LocaleType.EN_US, dateSystem: model.date1904 ? DateSystem.Date1904 : DateSystem.Date1900,
    sheetOrder: model.sheets.map(sheet => sheet.id), styles: Object.fromEntries(model.styles.map((input, index) => [String(index), style(input, model, gaps, index === 0)])), sheets: {} };
  // OOXML style zero is the inherited Normal style even when cells omit s.
  // Give the editor that same inheritance so typing does not materialize its
  // document UI color as a new authored cell style. Automatic/unspecified font
  // color may use the host's presentation foreground; explicit colors win.
  if (defaultTextColor && data.styles?.['0'] && !data.styles['0'].cl) data.styles['0'].cl = { rgb: defaultTextColor };
  for (const sheet of model.sheets) {
    const cellData: IObjectMatrixPrimitiveType<ICellData> = {};
    for (const cell of sheet.cells) (cellData[cell.row] ??= {})[cell.column] = cellValue(cell, model, gaps, `${id}:${sheet.id}`);
    data.sheets![sheet.id] = { id: sheet.id, name: sheet.name, defaultStyle: '0', rowCount: sheet.rowCount, columnCount: sheet.columnCount, cellData,
      hidden: sheet.visibility === 'visible' ? WorksheetHiddenState.VISIBLE : sheet.visibility === 'hidden' ? WorksheetHiddenState.HIDDEN : WorksheetHiddenState.VERY_HIDDEN,
      mergeData: sheet.merges.map(range => ({ ...range })),
      freeze: { xSplit: sheet.frozenColumns, ySplit: sheet.frozenRows, startRow: sheet.frozenRows ? sheet.frozenRows : -1, startColumn: sheet.frozenColumns ? sheet.frozenColumns : -1 },
      ...(sheet.defaultRowHeight === undefined ? {} : { defaultRowHeight: sheet.defaultRowHeight * 4 / 3 }),
      ...(sheet.defaultColumnWidth === undefined ? {} : { defaultColumnWidth: columnPixels(sheet.defaultColumnWidth) }),
      rowData: Object.fromEntries(sheet.rowDimensions.map(row => [row.index, { ...(row.height === undefined ? {} : { h: row.height * 4 / 3 }), hd: row.hidden ? BooleanNumber.TRUE : BooleanNumber.FALSE, ...(row.style === undefined ? {} : { s: String(row.style) }) }])),
      columnData: Object.fromEntries(sheet.columnDimensions.map(column => [column.index, { ...(column.width === undefined ? {} : { w: columnPixels(column.width) }), hd: column.hidden ? BooleanNumber.TRUE : BooleanNumber.FALSE, ...(column.style === undefined ? {} : { s: String(column.style) }) }])),
    };
  }
  if (model.features.charts || model.features.drawings) gaps.add('drawings');
  return { data, activeSheetId: model.activeSheetId, gaps: [...gaps] };
}
/** Default Excel digit metrics; custom-font pixel fidelity needs measurement. */
function columnPixels(characters: number): number { return characters <= 0 ? 0 : characters < 1 ? Math.round(characters * 12) : Math.floor(characters * 7 + 5); }
