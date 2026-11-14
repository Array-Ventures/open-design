import { assertWorkbookStructureSupported } from './structure-patch.js';
import { WORKBOOK_STRUCTURE_AXIS_BUDGET } from '@open-design/contracts/runtime/workbook-structure';
import { assertWorkbookImportLayout } from './import-layout.js';
import StylesXform from 'exceljs-community/lib/xlsx/xform/style/styles-xform.js';
import { Readable } from 'node:stream';
import ExcelJS from 'exceljs-community';
import { workbookDocumentSchema, WORKBOOK_MODEL_LIMITS, WORKBOOK_MINIMUM_SHEET_WINDOW, type WorkbookCell, type WorkbookSheet, type WorkbookStyle } from '@open-design/contracts/runtime/workbook';
import { WorkbookFormatError, readWorkbookPackage, type WorkbookParts } from './package.js';
import { address, child, children, MAIN_NAMESPACES, range, relationships, xmlPart } from './parts.js';
import { font, style } from './styles.js';
import { readWorkbookTheme } from './theme.js';
import { preflightWorksheet, type WorkbookImportBudget } from './preflight.js';
import { readWorkbookMetadata } from './metadata.js';
import { verifiedDynamicArrayOwners } from './dynamic-array-metadata.js';
import { decodeSpreadsheetText, sourceRichFont } from './rich-cell.js';
import { formulaCellKey } from './formula-cache-policy.js';
import { readArrayFormulaMetadata } from './array-metadata.js';

export interface ReadWorkbook { model: ReturnType<typeof workbookDocumentSchema.parse>; parts: WorkbookParts; sheetParts: Map<string, string> }
function number(value: string | null, fallback?: number): number {
  if (value === null && fallback !== undefined) return fallback;
  const result = value === null || value.trim() === '' ? Number.NaN : Number(value);
  if (!Number.isFinite(result)) throw new WorkbookFormatError('Invalid workbook number.');
  return result;
}
function integer(value: string | null, fallback?: number): number {
  const result = number(value, fallback);
  if (!Number.isSafeInteger(result) || result < 0) throw new WorkbookFormatError('Invalid workbook index.');
  return result;
}
function bool(value: string | null): boolean {
  if (value === null || value === '0' || value === 'false') return false;
  if (value === '1' || value === 'true') return true;
  throw new WorkbookFormatError('Invalid workbook boolean.');
}
function dateSerial(value: string, date1904: boolean): number {
  if (!/^\d{4}-\d{2}-\d{2}(?:T[^\s]+)?$/.test(value)) throw new WorkbookFormatError('Invalid workbook date.');
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new WorkbookFormatError('Invalid workbook date.');
  return (timestamp - Date.UTC(date1904 ? 1904 : 1899, date1904 ? 0 : 11, date1904 ? 1 : 31)) / 86_400_000
    + (!date1904 && timestamp >= Date.UTC(1900, 2, 1) ? 1 : 0);
}
type CellValue = { [K in WorkbookCell['kind']]: Omit<Extract<WorkbookCell, { kind: K }>, 'row' | 'column' | 'style' | 'formula'> }[WorkbookCell['kind']];
function cellValue(type: string | null, raw: string | undefined, source: ExcelJS.Cell, sharedCount: number, date1904: boolean): CellValue {
  if (type === 's' || type === 'inlineStr') {
    if (type === 's' && integer(raw ?? null) >= sharedCount) throw new WorkbookFormatError('Invalid shared string reference.');
    const value = source.value;
    if (typeof value === 'string') return { kind: 'string', value };
    if (value && typeof value === 'object' && 'richText' in value) {
      const runs = value.richText.map(run => ({ text: run.text, ...(run.font ? { font: font(run.font)! } : {}) }));
      return { kind: 'string', value: runs.map(run => run.text).join(''), runs };
    }
    if (value && typeof value === 'object' && 'hyperlink' in value) return { kind: 'string', value: value.text };
    throw new WorkbookFormatError('Workbook string could not be read.');
  }
  if (type === 'str' && raw !== undefined) return { kind: 'string', value: raw };
  if (raw === undefined || raw === '') return { kind: 'blank', value: null };
  if (type === 'e') return { kind: 'error', value: raw };
  if (type === 'b') return { kind: 'boolean', value: bool(raw) };
  if (type === 'd') return { kind: 'number', value: dateSerial(raw, date1904) };
  if (type === null || type === 'n') return { kind: 'number', value: number(raw) };
  throw new WorkbookFormatError('Workbook cell type is not supported.', 'WORKBOOK_UNSUPPORTED');
}

/** ExcelJS is used only to read resolved styles, shared formulas and rich strings.
 * Saves must patch the retained package, never serialize this library's model. */
async function readXlsx(bytes: Buffer): Promise<ReadWorkbook> {
  const parts = await readWorkbookPackage(bytes);
  const rootRelations = relationships(parts, '');
  const office = [...rootRelations.values()].filter(relation => relation.type.endsWith('/officeDocument'));
  if (office.length !== 1 || office[0]!.external) throw new WorkbookFormatError('Workbook root relationship is missing or ambiguous.');
  const mainPart = office[0]!.target;
  const main = xmlPart(parts, mainPart).documentElement;
  if (!main || main.localName !== 'workbook' || !MAIN_NAMESPACES.has(main.namespaceURI ?? '')) throw new WorkbookFormatError('Invalid workbook root.');
  const links = relationships(parts, mainPart);
  assertWorkbookImportLayout(parts, mainPart, links);
  const theme = [...links.values()].find(link => link.type.endsWith('/theme'));
  if (theme?.external) throw new WorkbookFormatError('External workbook themes are not supported.', 'WORKBOOK_UNSUPPORTED');
  const themeColors = theme ? readWorkbookTheme(parts, theme.target) : undefined;
  const descriptors = child(main, 'sheets');
  if (!descriptors) throw new WorkbookFormatError('Workbook has no sheets.');
  const sheetNodes = children(descriptors, 'sheet');
  if (!sheetNodes.length || sheetNodes.length > WORKBOOK_MODEL_LIMITS.sheets) throw new WorkbookFormatError('Workbook sheet count exceeds its limit.', 'WORKBOOK_LIMIT');
  const date1904 = bool(child(main, 'workbookPr')?.getAttribute('date1904') ?? null);
  const shared = [...links.values()].find(link => link.type.endsWith('/sharedStrings'));
  const sharedRoot = shared && !shared.external ? xmlPart(parts, shared.target).documentElement : null;
  const sharedItems = sharedRoot ? children(sharedRoot, 'si') : [];
  const sharedCount = sharedItems.length;
  // Preflight every XML part the importer might parse, not only the visible sheet.
  const budget: WorkbookImportBudget = { rows: 0, cells: 0, mergedCells: 0 };
  for (const [name] of parts) if (/\.(?:xml|rels|vml)$/i.test(name)) {
    const root = xmlPart(parts, name).documentElement;
    if (root?.localName === 'worksheet' && MAIN_NAMESPACES.has(root.namespaceURI ?? '')) preflightWorksheet(root, budget);
  }
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Uint8Array.from(bytes).buffer);
  // ExcelJS's cell reconciler deliberately skips styleId zero. Read that XF
  // through its same pinned style parser so omitted cells inherit the authored
  // Normal font/fill/alignment instead of an invented empty editor style.
  const styleLink = [...links.values()].find(link => link.type.endsWith('/styles'));
  const rawStyles = styleLink && !styleLink.external ? xmlPart(parts, styleLink.target).documentElement : undefined;
  const rawXfs = rawStyles && child(rawStyles, 'cellXfs'), rawFonts = rawStyles && child(rawStyles, 'fonts');
  const rawXfEntries = rawXfs ? children(rawXfs, 'xf') : [], rawFontEntries = rawFonts ? children(rawFonts, 'font') : [];
  const sourceStyle = (value: Partial<ExcelJS.Style>, rawId?: number): WorkbookStyle => {
    const normalized = style(value);
    // The pinned color reader omits auto=1. Recover that source semantic instead
    // of reviving an inherited authored color after an automatic-color reset.
    const xf = rawId === undefined ? undefined : rawXfEntries[rawId];
    const sourceFont = xf ? rawFontEntries[integer(xf.getAttribute('fontId'), 0)] : undefined;
    // The pinned importer truncates fractional point sizes with parseInt.
    // The source font component, rather than that rounded value, owns size.
    const sizes = sourceFont ? children(sourceFont, 'sz') : [];
    if (sizes.length > 1) throw new WorkbookFormatError('Ambiguous workbook font size.');
    if (sizes.length) {
      const size = number(sizes[0]!.getAttribute('val'));
      if (size <= 0 || size > 512) throw new WorkbookFormatError('Unsupported workbook font size.', 'WORKBOOK_UNSUPPORTED');
      normalized.font = { ...normalized.font, size };
    }
    const color = sourceFont && child(sourceFont, 'color');
    if (color?.hasAttribute('auto') && bool(color.getAttribute('auto')) && !['rgb', 'theme', 'indexed'].some(attribute => color.hasAttribute(attribute))) normalized.font = { ...normalized.font, color: { kind: 'auto' } };
    return normalized;
  };
  let normal: WorkbookStyle = {};
  if (styleLink && !styleLink.external) {
    const parser = new StylesXform(); await parser.parseStream(Readable.from([parts.get(styleLink.target)!]));
    normal = sourceStyle(parser.getStyleModel(0) ?? {}, 0);
  }
  const styles: WorkbookStyle[] = [normal];
  const styleIds = new Map<string, number>([[JSON.stringify(normal), 0]]);
  const admitStyle = (value: Partial<ExcelJS.Style>, rawId?: number): number => {
    const normalized = sourceStyle(value, rawId), key = JSON.stringify(normalized);
    let id = styleIds.get(key);
    if (id === undefined) { id = styles.length; styleIds.set(key, id); styles.push(normalized); }
    if (styles.length > WORKBOOK_MODEL_LIMITS.styles) throw new WorkbookFormatError('Workbook style count exceeds its limit.', 'WORKBOOK_LIMIT');
    return id;
  };
  const sheetParts = new Map<string, string>();
  const sheets: WorkbookSheet[] = [];
  let cellCount = 0;
  for (const node of sheetNodes) {
    const id = node.getAttribute('sheetId'), name = node.getAttribute('name');
    const relationId = node.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') ?? node.getAttributeNS('http://purl.oclc.org/ooxml/officeDocument/relationships', 'id');
    const relation = relationId ? links.get(relationId) : undefined;
    if (!id || !name || !relation || relation.external || !relation.type.endsWith('/worksheet')) throw new WorkbookFormatError('Invalid workbook sheet relationship.');
    if (sheetParts.has(id) || [...sheetParts.values()].includes(relation.target)) throw new WorkbookFormatError('Duplicate workbook sheet relationship.');
    const source = workbook.getWorksheet(Number(id));
    if (!source || source.name !== name) throw new WorkbookFormatError('Workbook sheet identities do not match its source.');
    const root = xmlPart(parts, relation.target).documentElement;
    if (!root || root.localName !== 'worksheet' || !MAIN_NAMESPACES.has(root.namespaceURI ?? '')) throw new WorkbookFormatError('Invalid worksheet root.');
    const cells: WorkbookCell[] = [], rowDimensions: WorkbookSheet['rowDimensions'] = [], columnDimensions: WorkbookSheet['columnDimensions'] = [], arrayFormulas: NonNullable<WorkbookSheet['arrayFormulas']> = [];
    let rowCount: number = WORKBOOK_MINIMUM_SHEET_WINDOW.rows, columnCount: number = WORKBOOK_MINIMUM_SHEET_WINDOW.columns, previousRow = -1;
    const data = child(root, 'sheetData');
    for (const rowNode of data ? children(data, 'row') : []) {
      const rowIndex = rowNode.hasAttribute('r') ? integer(rowNode.getAttribute('r')) - 1 : previousRow + 1;
      previousRow = rowIndex; rowCount = Math.max(rowCount, rowIndex + 1);
      if (rowNode.hasAttribute('ht') || rowNode.hasAttribute('hidden') || rowNode.hasAttribute('s')) rowDimensions.push({ index: rowIndex, ...(rowNode.hasAttribute('ht') ? { height: number(rowNode.getAttribute('ht')) } : {}), ...(rowNode.hasAttribute('hidden') ? { hidden: bool(rowNode.getAttribute('hidden')) } : {}), ...(rowNode.hasAttribute('s') ? { style: rowNode.getAttribute('s') === '0' ? 0 : admitStyle(source.getRow(rowIndex + 1), integer(rowNode.getAttribute('s'))) } : {}) });
      let previousColumn = -1;
      for (const cell of children(rowNode, 'c')) {
        if (++cellCount > WORKBOOK_MODEL_LIMITS.cells) throw new WorkbookFormatError('Workbook cell count exceeds its limit.', 'WORKBOOK_LIMIT');
        const position = cell.hasAttribute('r') ? address(cell.getAttribute('r')!) : { row: rowIndex, column: previousColumn + 1 };
        if (position.row !== rowIndex) throw new WorkbookFormatError('Cell does not belong to its declared row.');
        previousColumn = position.column; columnCount = Math.max(columnCount, position.column + 1);
        const imported = source.getCell(position.row + 1, position.column + 1);
        const styleId = cell.getAttribute('s') === '0' || !cell.hasAttribute('s') && Object.keys(imported.style).length === 0 ? 0 : admitStyle(imported.style, cell.hasAttribute('s') ? integer(cell.getAttribute('s')) : undefined);
        const formulaNode = child(cell, 'f');
        const array = readArrayFormulaMetadata(formulaNode, position);
        if (array) { arrayFormulas.push(array); rowCount = Math.max(rowCount, array.range.endRow + 1); columnCount = Math.max(columnCount, array.range.endColumn + 1); }
        const formula = formulaNode ? imported.formula : undefined;
        if (formulaNode && !formula && array?.kind !== 'dataTable') throw new WorkbookFormatError('Workbook formula could not be resolved.');
        const textContainer = cell.getAttribute('t') === 's' ? sharedItems[integer(child(cell,'v')?.textContent ?? null)] : child(cell,'is');
        const xmlRuns = textContainer ? children(textContainer,'r') : [];
        if (xmlRuns.length) {
          if (formulaNode) throw new WorkbookFormatError('A formula cannot own rich string content.', 'WORKBOOK_UNSUPPORTED');
          const runs = xmlRuns.map((run) => { const font = sourceRichFont(run);return { text: decodeSpreadsheetText(children(run,'t').map(t=>t.textContent ?? '').join('')), ...(font ? { font } : {}) }; });
          cells.push({ ...position, kind:'string', value:runs.map(run=>run.text).join(''), runs, ...(styleId ? { style:styleId } : {}) });
          continue;
        }
        if (textContainer && !Array.from(textContainer.childNodes).some(node=>node.nodeType===1)) {cells.push({...position,kind:'string',value:'',runs:[],...(styleId?{style:styleId}:{})});continue;}
        const value = cellValue(cell.getAttribute('t'), child(cell, 'v')?.textContent ?? undefined, imported, sharedCount, date1904);
        cells.push({ ...position, ...value, ...(styleId ? { style: styleId } : {}), ...(formula ? { formula: `=${formula}` } : {}) });
      }
    }
    for (const item of child(root, 'cols') ? children(child(root, 'cols')!, 'col') : []) {
      const min = integer(item.getAttribute('min')), max = integer(item.getAttribute('max'));
      if (min < 1 || max < min || max > WORKBOOK_MODEL_LIMITS.columns) throw new WorkbookFormatError('Invalid workbook column dimensions.');
      columnCount = Math.max(columnCount, max);
      for (let index = min - 1; index < max; index++) columnDimensions.push({ index, ...(item.hasAttribute('width') ? { width: number(item.getAttribute('width')) } : {}), ...(item.hasAttribute('hidden') ? { hidden: bool(item.getAttribute('hidden')) } : {}), ...(item.hasAttribute('style') ? { style: item.getAttribute('style') === '0' ? 0 : admitStyle(source.getColumn(index + 1).style, integer(item.getAttribute('style'))) } : {}) });
    }
    const merges = child(root, 'mergeCells') ? children(child(root, 'mergeCells')!, 'mergeCell').map(item => range(item.getAttribute('ref') ?? '')) : [];
    for (const merge of merges) { rowCount = Math.max(rowCount, merge.endRow + 1); columnCount = Math.max(columnCount, merge.endColumn + 1); }
    const views = child(root, 'sheetViews'), view = views ? child(views, 'sheetView') : undefined, pane = view ? child(view, 'pane') : undefined;
    const frozen = pane?.getAttribute('state') === 'frozen' || pane?.getAttribute('state') === 'frozenSplit';
    const frozenRows = frozen ? integer(pane!.getAttribute('ySplit'), 0) : 0, frozenColumns = frozen ? integer(pane!.getAttribute('xSplit'), 0) : 0;
    rowCount = Math.max(rowCount, frozenRows); columnCount = Math.max(columnCount, frozenColumns);
    const format = child(root, 'sheetFormatPr');
    sheets.push({ id, name, visibility: (node.getAttribute('state') ?? 'visible') as WorkbookSheet['visibility'], rowCount, columnCount, cells, merges, arrayFormulas, rowDimensions, columnDimensions, frozenRows, frozenColumns,
      ...(format?.hasAttribute('defaultRowHeight') ? { defaultRowHeight: number(format.getAttribute('defaultRowHeight')) } : {}),
      ...(format?.hasAttribute('defaultColWidth') ? { defaultColumnWidth: number(format.getAttribute('defaultColWidth')) } : {}) });
    sheetParts.set(id, relation.target);
  }
  const view = child(main, 'bookViews'), active = view ? integer(child(view, 'workbookView')?.getAttribute('activeTab') ?? null, 0) : 0;
  const names = [...parts.keys()];
  const metadata = readWorkbookMetadata(parts, main, sheets, sheetParts);
  const model = workbookDocumentSchema.parse({ version: 1, worksheetVisibilityEditable: !child(main, 'workbookProtection') && !child(main, 'customWorkbookViews') && !names.some(name => name.startsWith('_xmlsignatures/') || /(?:^|\/)vbaProject\.bin$/i.test(name)), richTextMetadata: 'verified', date1904, activeSheetId: sheets[active]?.visibility === 'visible' ? sheets[active]!.id : sheets.find(sheet => sheet.visibility === 'visible')?.id,
    styles, sheets, ...metadata, ...(themeColors ? { themeColors } : {}), features: { charts: names.filter(name => /\/charts\/[^/]+\.xml$/i.test(name)).length, drawings: names.filter(name => /\/drawings\/[^/]+\.xml$/i.test(name)).length,
      externalLinks: names.filter(name => /\/externalLinks\/[^/]+\.xml$/i.test(name)).length, macros: names.some(name => /(?:^|\/)vbaProject\.bin$/i.test(name)), signed: names.some(name => name.startsWith('_xmlsignatures/')) } });
  const result = { model, parts, sheetParts };
  try {
    const dynamic = verifiedDynamicArrayOwners(result);
    model.calculationMetadata = 'verified';
    for (const sheet of model.sheets) for (const owner of sheet.arrayFormulas ?? []) owner.calculation = owner.kind === 'dataTable' ? 'unsupported' : dynamic.has(formulaCellKey(sheet.id, owner.row, owner.column)) ? 'dynamic' : 'fixed';
  } catch (error) {
    if (!(error instanceof WorkbookFormatError)) throw error;
    model.calculationMetadata = 'unsupported';
    for (const sheet of model.sheets) for (const owner of sheet.arrayFormulas ?? []) owner.calculation = 'unsupported';
  }
  const axes = model.sheets.reduce((total, sheet) => total + sheet.rowCount + sheet.columnCount, 0);
  model.worksheetStructureEditable = false;
  if (axes <= WORKBOOK_STRUCTURE_AXIS_BUDGET) {
    try {
      const required = assertWorkbookStructureSupported(result), geometry = model.sheets.map(sheet => ({ sheet, rows: Math.max(sheet.rowCount, required.get(sheet.id)!.rows), columns: Math.max(sheet.columnCount, required.get(sheet.id)!.columns) }));
      const area = geometry.reduce((sum, value) => sum + value.rows * value.columns, 0), axisCount = geometry.reduce((sum, value) => sum + value.rows + value.columns, 0);
      if (area <= 100_000 && axisCount <= WORKBOOK_STRUCTURE_AXIS_BUDGET) { for (const value of geometry) { value.sheet.rowCount = value.rows; value.sheet.columnCount = value.columns; } model.worksheetStructureEditable = true; }
    }
    catch { /* This workbook stays editable through its already qualified owners. */ }
  }
  return result;
}

export async function readXlsxWorkbook(bytes: Buffer): Promise<ReadWorkbook> {
  try { return await readXlsx(bytes); }
  catch (error) { throw error instanceof WorkbookFormatError ? error : new WorkbookFormatError('Workbook could not be read without losing data.'); }
}
