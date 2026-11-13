import { z } from 'zod';

export const WORKBOOK_MODEL_LIMITS = { sheets: 64, cells: 100_000, styles: 20_000, text: 8 * 1024 * 1024, rows: 1_048_576, columns: 16_384 } as const;
const row = z.number().int().min(0).max(WORKBOOK_MODEL_LIMITS.rows - 1);
const column = z.number().int().min(0).max(WORKBOOK_MODEL_LIMITS.columns - 1);
const id = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/)
  .refine(value => !['__proto__', 'constructor', 'prototype'].includes(value), 'Reserved sheet identity.');
export const workbookRangeSchema = z.object({ startRow: row, endRow: row, startColumn: column, endColumn: column }).strict()
  .refine(range => range.endRow >= range.startRow && range.endColumn >= range.startColumn, 'Range endpoints are reversed.');
export type WorkbookRange = z.infer<typeof workbookRangeSchema>;

export const workbookColorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('rgb'), argb: z.string().regex(/^[A-Fa-f0-9]{8}$/), tint: z.number().min(-1).max(1).optional() }).strict(),
  z.object({ kind: z.literal('theme'), index: z.number().int().min(0).max(11), tint: z.number().min(-1).max(1).optional() }).strict(),
  z.object({ kind: z.literal('indexed'), index: z.number().int().min(0).max(65), tint: z.number().min(-1).max(1).optional() }).strict(),
  z.object({ kind: z.literal('auto') }).strict(),
]);
export type WorkbookColor = z.infer<typeof workbookColorSchema>;
export const workbookFontSchema = z.object({
  name: z.string().max(256).refine(value=>!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\uFFFE\uFFFF\p{Cs}]/u.test(value),'Invalid font name.').optional(), family: z.number().int().min(-2147483648).max(2147483647).optional(), size: z.number().positive().max(512).optional(),
  bold: z.boolean().optional(), italic: z.boolean().optional(), strike: z.boolean().optional(),
  underline: z.enum(['none', 'single', 'double', 'singleAccounting', 'doubleAccounting']).optional(),
  vertical: z.enum(['baseline', 'superscript', 'subscript']).optional(), color: workbookColorSchema.optional(),
}).strict();
export type WorkbookFont = z.infer<typeof workbookFontSchema>;
const border = z.object({ style: z.enum(['thin', 'dotted', 'hair', 'medium', 'double', 'thick', 'dashDot', 'dashDotDot', 'slantDashDot', 'mediumDashed', 'mediumDashDotDot', 'mediumDashDot', 'dashed']), color: workbookColorSchema.optional() }).strict();
const gradientStops = z.array(z.object({ position: z.number().min(0).max(1), color: workbookColorSchema }).strict()).min(2).max(64);
export const workbookStyleSchema = z.object({
  font: workbookFontSchema.optional(), numberFormat: z.string().max(1024).optional(),
  fill: z.union([
    z.object({ pattern: z.string().max(40), foreground: workbookColorSchema.optional(), background: workbookColorSchema.optional() }).strict(),
    z.object({ gradient: z.literal('angle'), degree: z.number().min(0).max(360), stops: gradientStops }).strict(),
    z.object({ gradient: z.literal('path'), center: z.object({ left: z.number().min(0).max(1), top: z.number().min(0).max(1) }).strict(), stops: gradientStops }).strict(),
  ]).optional(),
  alignment: z.object({ horizontal: z.enum(['general', 'left', 'center', 'right', 'fill', 'justify', 'centerContinuous', 'distributed']).optional(),
    vertical: z.enum(['top', 'middle', 'bottom', 'justify', 'distributed']).optional(), wrap: z.boolean().optional(), shrink: z.boolean().optional(),
    indent: z.number().int().min(0).max(250).optional(), rotation: z.union([z.number().int().min(-90).max(90), z.literal('vertical')]).optional(),
  }).strict().optional(),
  borders: z.object({ top: border.optional(), right: border.optional(), bottom: border.optional(), left: border.optional(), diagonal: border.optional(), diagonalUp: z.boolean().optional(), diagonalDown: z.boolean().optional() }).strict().optional(),
}).strict();
export type WorkbookStyle = z.infer<typeof workbookStyleSchema>;
const position = { row, column, style: z.number().int().min(0).max(WORKBOOK_MODEL_LIMITS.styles - 1).optional(), formula: z.string().min(2).max(8192).startsWith('=').optional() };
const richRun = z.object({ text: z.string().max(32767).refine(value=>!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\uFFFE\uFFFF\p{Cs}]/u.test(value),'Invalid rich run text.'), font: workbookFontSchema.optional() }).strict();
export const workbookCellSchema = z.discriminatedUnion('kind', [
  z.object({ ...position, kind: z.literal('blank'), value: z.null() }).strict(),
  z.object({ ...position, kind: z.literal('number'), value: z.number().finite() }).strict(),
  z.object({ ...position, kind: z.literal('boolean'), value: z.boolean() }).strict(),
  z.object({ ...position, kind: z.literal('string'), value: z.string().max(32767), runs: z.array(richRun).max(1024).optional() }).strict(),
  z.object({ ...position, kind: z.literal('error'), value: z.string().min(1).max(100) }).strict(),
]).superRefine((cell, context) => {
  if (cell.kind !== 'string' || !cell.runs) return;
  if (cell.runs.map(run => run.text).join('') !== cell.value) context.addIssue({ code: 'custom', message: 'Rich text does not match its cell value.' });
  if (cell.formula) context.addIssue({ code: 'custom', message: 'Formula caches cannot own rich text edits.' });
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\uFFFE\uFFFF\p{Cs}]/u.test(cell.value)) context.addIssue({ code: 'custom', message: 'Rich text contains invalid XML characters.' });
});

export type WorkbookCell = z.infer<typeof workbookCellSchema>;
export const workbookCellEditSchema = z.object({ sheetId: id, cell: workbookCellSchema }).strict();
export type WorkbookCellEdit = z.infer<typeof workbookCellEditSchema>;
export const workbookDimensionEditSchema = z.discriminatedUnion('axis', [
  z.object({ sheetId: id, axis: z.literal('row'), index: row, size: z.number().min(0).max(409).optional(), hidden: z.boolean().optional() }).strict(),
  z.object({ sheetId: id, axis: z.literal('column'), index: column, size: z.number().min(0).max(255).optional(), hidden: z.boolean().optional() }).strict(),
]).refine(edit => edit.size !== undefined || edit.hidden !== undefined, 'A dimension edit must change size or visibility.');
export type WorkbookDimensionEdit = z.infer<typeof workbookDimensionEditSchema>;
/** Sparse authored formatting changes; omitted properties retain source XML. */
export const workbookStyleEditSchema = z.object({ sheetId: id, row, column,
  bold: z.boolean().optional(), italic: z.boolean().optional(),
  fontColor: z.string().regex(/^[A-Fa-f0-9]{8}$/).nullable().optional(),
  fillColor: z.string().regex(/^[A-Fa-f0-9]{8}$/).nullable().optional(),
}).strict().refine(edit => edit.bold !== undefined || edit.italic !== undefined || edit.fontColor !== undefined || edit.fillColor !== undefined, 'Empty style edit.');
export type WorkbookStyleEdit = z.infer<typeof workbookStyleEditSchema>;
/** Worksheet visibility is independent of name/order/geometry. veryHidden is source-owned. */
export const workbookVisibilityEditSchema = z.object({ sheetId: id, visibility: z.enum(['visible', 'hidden']) }).strict();
export type WorkbookVisibilityEdit = z.infer<typeof workbookVisibilityEditSchema>;
export const workbookEditPlanSchema = z.object({ sourceSha256: z.string().regex(/^[0-9a-f]{64}$/), edits: z.array(workbookCellEditSchema).max(WORKBOOK_MODEL_LIMITS.cells), dimensions: z.array(workbookDimensionEditSchema).max(WORKBOOK_MODEL_LIMITS.cells).optional(), styles: z.array(workbookStyleEditSchema).max(WORKBOOK_MODEL_LIMITS.cells).optional(), visibility: z.array(workbookVisibilityEditSchema).max(WORKBOOK_MODEL_LIMITS.sheets).optional() }).strict().superRefine((plan,context)=>{
  const visibilityIds = new Set<string>();
  for (const edit of plan.visibility ?? []) {
    if (visibilityIds.has(edit.sheetId)) context.addIssue({ code: 'custom', message: 'Duplicate worksheet visibility edit.' });
    visibilityIds.add(edit.sheetId);
  }
  let text=0,runs=0;for(const {cell}of plan.edits){text+=(typeof cell.value==='string'?cell.value.length:0)+(cell.formula?.length??0);if(cell.kind==='string'&&cell.runs){runs+=cell.runs.length;for(const run of cell.runs)text+=run.text.length+(run.font?JSON.stringify(run.font).length:0);}}
  if(text>WORKBOOK_MODEL_LIMITS.text)context.addIssue({code:'custom',message:'Workbook edit text exceeds its limit.'});
  if(runs>WORKBOOK_MODEL_LIMITS.cells)context.addIssue({code:'custom',message:'Workbook edit rich runs exceed their aggregate limit.'});
});
/** Source ownership from OOXML f/@t and f/@ref, never inferred from cached
 * numeric cells or a formula's function name. Dynamic/legacy array identity is
 * never inferred from functions. Optional calculation identity is qualified by
 * the daemon from retained metadata; older absence remains unknown. */
export const workbookArrayFormulaSchema = z.object({ kind: z.enum(['array', 'dataTable']), row, column, range: workbookRangeSchema, calculation: z.enum(['fixed', 'dynamic', 'unsupported']).optional() }).strict();
export type WorkbookArrayFormula = z.infer<typeof workbookArrayFormulaSchema>;
export const workbookSheetSchema = z.object({
  id, name: z.string().min(1).max(31).refine(name => !/[\\/*?:[\]]/.test(name) && !name.startsWith("'") && !name.endsWith("'"), 'Invalid sheet name.'),
  visibility: z.enum(['visible', 'hidden', 'veryHidden']),
  rowCount: z.number().int().min(1).max(WORKBOOK_MODEL_LIMITS.rows), columnCount: z.number().int().min(1).max(WORKBOOK_MODEL_LIMITS.columns),
  defaultRowHeight: z.number().min(0).max(409).optional(), defaultColumnWidth: z.number().min(0).max(255).optional(),
  cells: z.array(workbookCellSchema).max(WORKBOOK_MODEL_LIMITS.cells), merges: z.array(workbookRangeSchema).max(4096),
  arrayFormulas: z.array(workbookArrayFormulaSchema).max(4096).optional(),
  rowDimensions: z.array(z.object({ index: row, height: z.number().min(0).max(409).optional(), hidden: z.boolean().optional(), style: position.style }).strict()).max(100_000),
  columnDimensions: z.array(z.object({ index: column, width: z.number().min(0).max(255).optional(), hidden: z.boolean().optional(), style: position.style }).strict()).max(WORKBOOK_MODEL_LIMITS.columns),
  frozenRows: z.number().int().min(0).max(WORKBOOK_MODEL_LIMITS.rows), frozenColumns: z.number().int().min(0).max(WORKBOOK_MODEL_LIMITS.columns),
}).strict();
export type WorkbookSheet = z.infer<typeof workbookSheetSchema>;
const formulaName = z.string().min(1).max(255).refine(name => !/[\u0000-\u0020\u007f]/.test(name), 'Invalid formula name.');
export const workbookDefinedNameSchema = z.object({ name: formulaName, formula: z.string().min(1).max(8192), sheetId: id.optional(), hidden: z.boolean().optional() }).strict();
export const workbookTableSchema = z.object({ name: formulaName, sheetId: id, range: workbookRangeSchema, columns: z.array(z.string().min(1).max(255)).min(1).max(WORKBOOK_MODEL_LIMITS.columns), header: z.boolean(), totals: z.boolean() }).strict();
export type WorkbookDefinedName = z.infer<typeof workbookDefinedNameSchema>;
export type WorkbookTable = z.infer<typeof workbookTableSchema>;
export const workbookDocumentSchema = z.object({
  version: z.literal(1), worksheetVisibilityEditable: z.boolean().optional(), richTextMetadata: z.literal('verified').optional(), calculationMetadata: z.enum(['verified', 'unsupported']).optional(), sourceFormat: z.literal('csv').optional(), date1904: z.boolean(), activeSheetId: id,
  themeColors: z.array(z.string().regex(/^[A-Fa-f0-9]{8}$/)).length(12).optional(),
  styles: z.array(workbookStyleSchema).min(1).max(WORKBOOK_MODEL_LIMITS.styles),
  sheets: z.array(workbookSheetSchema).min(1).max(WORKBOOK_MODEL_LIMITS.sheets),
  definedNames: z.array(workbookDefinedNameSchema).max(4096).optional(), tables: z.array(workbookTableSchema).max(1024).optional(),
  features: z.object({ charts: z.number().int().min(0).max(4096), drawings: z.number().int().min(0).max(4096), externalLinks: z.number().int().min(0).max(4096), macros: z.boolean(), signed: z.boolean() }).strict(),
}).strict().superRefine((workbook, context) => {
  const ids = new Set<string>(), names = new Set<string>();
  let count = 0, text = 0, arrayCells = 0;
  const invalid = (message: string) => context.addIssue({ code: z.ZodIssueCode.custom, message });
  for (const sheet of workbook.sheets) {
    if (ids.has(sheet.id) || names.has(sheet.name.toLowerCase())) invalid('Sheet names and identities must be unique.');
    ids.add(sheet.id); names.add(sheet.name.toLowerCase());
    const positions = new Set<string>();
    count += sheet.cells.length;
    for (const cell of sheet.cells) {
      const key = `${cell.row}:${cell.column}`;
      if (positions.has(key)) invalid('Duplicate cell coordinates.');
      positions.add(key);
      if (cell.row >= sheet.rowCount || cell.column >= sheet.columnCount || cell.style !== undefined && cell.style >= workbook.styles.length) invalid('Cell is outside its sheet or style table.');
      text += (typeof cell.value === 'string' ? cell.value.length : 0) + (cell.formula?.length ?? 0);
      if (cell.kind === 'string' && cell.runs) {
        if (cell.runs.map(run => run.text).join('') !== cell.value) invalid('Rich text does not match its cell value.');
        text += cell.runs.reduce((size, run) => size + run.text.length, 0);
      }
    }
    for (const range of sheet.merges) if (range.endRow >= sheet.rowCount || range.endColumn >= sheet.columnCount) invalid('Merge is outside its sheet.');
    const formulaCells = new Set(sheet.cells.filter(cell => cell.formula).map(cell => `${cell.row}:${cell.column}`));
    let previousArrays: WorkbookRange[] = [];
    for (const array of [...sheet.arrayFormulas ?? []].sort((a, b) => a.range.startRow - b.range.startRow || a.range.startColumn - b.range.startColumn)) {
      const range = array.range;
      if (array.row !== range.startRow || array.column !== range.startColumn || range.endRow >= sheet.rowCount || range.endColumn >= sheet.columnCount
        || array.kind === 'array' && !formulaCells.has(`${array.row}:${array.column}`)) invalid('Invalid array formula ownership.');
      arrayCells += (range.endRow - range.startRow + 1) * (range.endColumn - range.startColumn + 1);
      if (arrayCells > WORKBOOK_MODEL_LIMITS.cells) invalid('Array formula ranges exceed the workbook limit.');
      previousArrays = previousArrays.filter(previous => previous.endRow >= range.startRow);
      if (previousArrays.some(previous => previous.startColumn <= range.endColumn && previous.endColumn >= range.startColumn)) invalid('Array formula ranges overlap.');
      previousArrays.push(range);
    }
    let active: WorkbookRange[] = [];
    for (const range of [...sheet.merges].sort((a, b) => a.startRow - b.startRow || a.startColumn - b.startColumn)) {
      active = active.filter(previous => previous.endRow >= range.startRow);
      if (active.some(previous => previous.startColumn <= range.endColumn && previous.endColumn >= range.startColumn)) {
        invalid('Merged ranges overlap.'); break;
      }
      active.push(range);
    }
    if (sheet.frozenRows > sheet.rowCount || sheet.frozenColumns > sheet.columnCount) invalid('Frozen region is outside its sheet.');
    for (const [dimensions, extent] of [[sheet.rowDimensions, sheet.rowCount], [sheet.columnDimensions, sheet.columnCount]] as const) {
      const seen = new Set<number>();
      for (const dimension of dimensions) { if (seen.has(dimension.index) || dimension.index >= extent || dimension.style !== undefined && dimension.style >= workbook.styles.length) invalid('Invalid row or column dimensions.'); seen.add(dimension.index); }
    }
  }
  const defined = new Set<string>(), tables = new Set<string>();
  for (const name of workbook.definedNames ?? []) {
    const key = `${name.sheetId ?? ''}:${name.name.toLowerCase()}`;
    if (defined.has(key) || name.sheetId !== undefined && !ids.has(name.sheetId)) invalid('Invalid or duplicate defined name scope.');
    defined.add(key); text += name.name.length + name.formula.length;
  }
  for (const table of workbook.tables ?? []) {
    const sheet = workbook.sheets.find(sheet => sheet.id === table.sheetId), key = table.name.toLowerCase();
    if (tables.has(key) || !sheet || table.range.endRow >= sheet.rowCount || table.range.endColumn >= sheet.columnCount
      || table.columns.length !== table.range.endColumn - table.range.startColumn + 1
      || table.range.endRow - table.range.startRow + 1 < Number(table.header) + Number(table.totals)
      || new Set(table.columns.map(column => column.toLowerCase())).size !== table.columns.length) invalid('Invalid workbook table.');
    tables.add(key); text += table.name.length + table.columns.reduce((length, column) => length + column.length, 0);
  }
  if (count > WORKBOOK_MODEL_LIMITS.cells || text > WORKBOOK_MODEL_LIMITS.text) invalid('Workbook content exceeds its limit.');
  if (!workbook.sheets.some(sheet => sheet.id === workbook.activeSheetId && sheet.visibility === 'visible')) invalid('Active sheet must be visible.');
});
export type WorkbookDocument = z.infer<typeof workbookDocumentSchema>;
export const workbookPreviewSchema = z.object({ sourceSha256: z.string().regex(/^[0-9a-f]{64}$/), model: workbookDocumentSchema }).strict();
export const workbookWriteIdentitySchema = z.object({ operationId: z.string().uuid(), sourceSha256: z.string().regex(/^[0-9a-f]{64}$/) }).strict();
const workbookVersionIdentity = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);
export const workbookRestoreSelectionSchema = z.object({ versionId: workbookVersionIdentity, contentDigest: z.string().regex(/^[0-9a-f]{64}$/) }).strict();
export type WorkbookRestoreSelection = z.infer<typeof workbookRestoreSelectionSchema>;
/** Host-service metadata; workbook bytes use a bounded octet-stream body. */
export const workbookCommitRequestSchema = workbookWriteIdentitySchema.extend({
  fileName: z.string().min(1).max(500).refine(value => /\.(xlsx|csv)$/i.test(value) && value.split('/').every(part => part && part !== '.' && part !== '..' && !/[\\\u0000]/.test(part))),
  targetSha256: z.string().regex(/^[0-9a-f]{64}$/),
  actor: z.string().regex(/^[A-Za-z0-9:_-]{1,200}$/),
  mode: z.enum(['commit', 'reconcile']),
  restore: workbookRestoreSelectionSchema.optional(),
}).strict();
export const workbookWriteReceiptSchema = workbookWriteIdentitySchema.extend({
  fileName: z.string().min(1).max(500), state: z.enum(['pending', 'applied', 'conflict']),
  targetSha256: z.string().regex(/^[0-9a-f]{64}$/),
  actualSha256: z.string().regex(/^[0-9a-f]{64}$/).nullable(), versionId: workbookVersionIdentity.nullable(), sourceVersionId: workbookVersionIdentity.nullable(),
  restoreFromVersionId: workbookVersionIdentity.optional(),
  createdAt: z.number().int().nonnegative(), updatedAt: z.number().int().nonnegative(),
}).strict().superRefine((receipt, context) => {
  if (receipt.state === 'applied' ? !receipt.versionId || receipt.actualSha256 !== receipt.targetSha256 : receipt.versionId !== null
    || receipt.state === 'pending' && receipt.actualSha256 !== null) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Workbook receipt state is inconsistent.' });
});
export type WorkbookWriteReceipt = z.infer<typeof workbookWriteReceiptSchema>;
