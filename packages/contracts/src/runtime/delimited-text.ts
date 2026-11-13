import { WORKBOOK_MODEL_LIMITS } from './workbook.js';
export const DELIMITED_LIMITS = { bytes: 25 * 1024 * 1024, cells: WORKBOOK_MODEL_LIMITS.cells, text: WORKBOOK_MODEL_LIMITS.text, cellText: 32767 } as const;
export interface DelimitedField { start: number; end: number; value: string; quoted: boolean }
export class DelimitedTextError extends Error {
  constructor(message: string, readonly code: 'WORKBOOK_INVALID' | 'WORKBOOK_LIMIT' = 'WORKBOOK_INVALID') { super(message); }
}
const invalid = (message: string): never => { throw new DelimitedTextError(message); };
const limit = (message: string): never => { throw new DelimitedTextError(message, 'WORKBOOK_LIMIT'); };
export function validateDelimitedLiteral(value: string): string {
  if (value.length > DELIMITED_LIMITS.cellText) limit('A CSV field exceeds the text limit.');
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) || new TextDecoder('utf-8', { ignoreBOM: true }).decode(new TextEncoder().encode(value)) !== value) invalid('CSV contains unsupported control characters or invalid Unicode.');
  return value;
}
/** One bounded tokenizer shared by source CSV and plain-text spreadsheet paste.
 * Delimiter is explicit; no inference or automatic type conversion occurs. */
export function parseDelimitedText(source: string, delimiter: ',' | '\t', stripBom = false): DelimitedField[][] {
  if (new TextEncoder().encode(source).byteLength > DELIMITED_LIMITS.bytes) limit('CSV exceeds its byte limit.');
  let at = stripBom && source.startsWith('\ufeff') ? 1 : 0, count = 0, text = 0;
  const rows: DelimitedField[][] = []; let row: DelimitedField[] = [];
  while (true) {
    const start = at, quoted = source[at] === '"'; let value: string;
    if (quoted) {
      const content = ++at; let closed = false;
      while (at < source.length) {
        if (source[at] !== '"') { at++; continue; }
        if (source[at + 1] === '"') { at += 2; continue; }
        value = source.slice(content, at).replace(/""/g, '"'); at++; closed = true; break;
      }
      if (!closed) return invalid('CSV has an unterminated quoted field.');
      if (at < source.length && ![delimiter, '\r', '\n'].includes(source[at]!)) return invalid('CSV has text after a closing quote.');
    } else {
      while (at < source.length && ![delimiter, '\r', '\n'].includes(source[at]!)) {
        if (source[at] === '"') return invalid('CSV has a quote inside an unquoted field.');
        at++;
      }
      value = source.slice(start, at);
    }
    validateDelimitedLiteral(value!); text += value!.length;
    if (++count > DELIMITED_LIMITS.cells || text > DELIMITED_LIMITS.text) limit('CSV content exceeds its import limit.');
    if (row.length >= WORKBOOK_MODEL_LIMITS.columns) limit('CSV exceeds its column limit.');
    row.push({ start, end: at, value: value!, quoted });
    if (source[at] === delimiter) { at++; continue; }
    rows.push(row); row = [];
    if (at === source.length) break;
    const newline = source[at] === '\r' ? source.slice(at, at + 2) : '\n';
    if (newline !== '\n' && newline !== '\r\n') return invalid('CSV uses a bare carriage return as a record separator.');
    at += newline.length;
    if (at === source.length) break;
  }
  return rows;
}
