import { parseDelimitedText, DelimitedTextError, DELIMITED_LIMITS, validateDelimitedLiteral, type DelimitedField } from '@open-design/contracts/runtime/delimited-text';
import { createHash } from 'node:crypto';
import { workbookDocumentSchema, workbookEditPlanSchema, type WorkbookDocument } from '@open-design/contracts/runtime/workbook';
import { WorkbookFormatError } from '../workbook/package.js';

export const CSV_LIMITS = DELIMITED_LIMITS;
export const CSV_SHEET_ID = 'csv';
type Field = DelimitedField;
export interface CsvDocument { readonly source: string; readonly sourceSha256: string; readonly rows: readonly (readonly Field[])[]; readonly model: WorkbookDocument }
const invalid = (message: string): never => { throw new WorkbookFormatError(message); };
const limit = (message: string): never => { throw new WorkbookFormatError(message, 'WORKBOOK_LIMIT'); };
function literal(value: string): string {
  try { return validateDelimitedLiteral(value); }
  catch (error) { if (error instanceof DelimitedTextError) throw new WorkbookFormatError(error.message, error.code); throw error; }
}
/** Explicit comma/UTF-8 dialect. No date, numeric or formula inference; source
 * token spans retain unchanged quoting, BOM, record separators and final newline.
 * A terminator ends its record, rather than inventing another empty record. */
export function readCsvDocument(bytes: Uint8Array): CsvDocument {
  if (bytes.byteLength > CSV_LIMITS.bytes) limit('CSV exceeds its byte limit.');
  let source: string;
  try { source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { return invalid('CSV must contain valid UTF-8 text. UTF-16 and legacy encodings are not supported.'); }
  let rows: DelimitedField[][];
  try { rows = parseDelimitedText(source, ',', true); }
  catch (error) { if (error instanceof DelimitedTextError) throw new WorkbookFormatError(error.message, error.code); throw error; }
  const columnCount = rows.reduce((maximum, row) => Math.max(maximum, row.length), 1);
  const model = workbookDocumentSchema.parse({ version: 1, sourceFormat: 'csv', date1904: false, activeSheetId: CSV_SHEET_ID,
    styles: [{ numberFormat: '@' }], features: { charts: 0, drawings: 0, externalLinks: 0, macros: false, signed: false },
    sheets: [{ id: CSV_SHEET_ID, name: 'Data', visibility: 'visible', rowCount: rows.length, columnCount,
      cells: rows.flatMap((row, rowIndex) => row.map((field, column) => ({ row: rowIndex, column, style: 0, kind: 'string', value: field.value }))),
      merges: [], rowDimensions: [], columnDimensions: [], frozenRows: 0, frozenColumns: 0 }],
  });
  return { source, sourceSha256: createHash('sha256').update(bytes).digest('hex'), rows, model };
}
/** Apply literal text replacements only. This is a pure preparation primitive;
 * durable conditional admission/history remain owned by the workbook writer. */
export function patchCsvDocument(source: CsvDocument, raw: unknown): { bytes: Buffer; model: WorkbookDocument } {
  const plan = workbookEditPlanSchema.parse(raw);
  if (plan.sourceSha256 !== source.sourceSha256) invalid('The CSV changed after these edits were prepared.');
  if (plan.dimensions?.length || plan.styles?.length) throw new WorkbookFormatError('CSV cannot store formatting or row/column dimensions.', 'WORKBOOK_UNSUPPORTED');
  const changes: { field: Field; value: string }[] = [], seen = new Set<string>();
  for (const edit of plan.edits) {
    const cell = edit.cell, key = `${cell.row}:${cell.column}`;
    if (edit.sheetId !== CSV_SHEET_ID || !source.rows[cell.row]?.[cell.column] || seen.has(key)) invalid('CSV edits must target distinct existing fields. Structural edits are not supported.');
    seen.add(key);
    if (cell.formula || cell.style !== undefined && cell.style !== 0 || cell.kind !== 'string' && cell.kind !== 'blank' || cell.kind === 'string' && cell.runs) throw new WorkbookFormatError('CSV edits must contain literal text without formulas or formatting.', 'WORKBOOK_UNSUPPORTED');
    const value = literal(cell.kind === 'blank' ? '' : cell.value as string), field = source.rows[cell.row]![cell.column]!;
    if (value !== field.value) changes.push({ field, value });
  }
  if (!changes.length) return { bytes: Buffer.from(source.source, 'utf8'), model: source.model };
  changes.sort((a, b) => a.field.start - b.field.start);
  const pieces: string[] = []; let at = 0;
  for (const { field, value } of changes) {
    pieces.push(source.source.slice(at, field.start), field.quoted || value === '' || /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value); at = field.end;
  }
  pieces.push(source.source.slice(at));
  const bytes = Buffer.from(pieces.join(''), 'utf8');
  // Reapply all byte/cell/text/grammar bounds to the complete candidate before
  // returning anything that the existing durable writer could admit.
  return { bytes, model: readCsvDocument(bytes).model };
}
