import { describe, expect, it } from 'vitest';
import { readCsvDocument, patchCsvDocument, CSV_LIMITS } from '../../src/artifacts/csv/document.js';
const read = (source: string) => readCsvDocument(Buffer.from(source));
const values = (source: ReturnType<typeof read>) => source.rows.map(row => row.map(field => field.value));
function edit(source: ReturnType<typeof read>, value: string, row = 0, column = 0) {
  return { sourceSha256: source.sourceSha256, edits: [{ sheetId: 'csv', cell: { row, column, kind: 'string', value } }] };
}
describe('literal CSV preservation adapter', () => {
  it.each(['', '\ufeff', 'a,b,', 'a,b,\r\n', '\ufeff"001",2026-11-12,=1+2,+4,-2,@x,TRUE,1e9,\r\n', '"a\r\nb","a""b",雪😀\n', '\n\n', 'a,b\nc\n', 'a,b\r\nc,d\n'])('retains every original byte without edits: %j', text => {
    const source = read(text), result = patchCsvDocument(source, { sourceSha256: source.sourceSha256, edits: [] });
    expect(result.bytes.equals(Buffer.from(text))).toBe(true);
    expect(source.model.sheets[0]!.cells.every(cell => cell.kind === 'string' && !cell.formula)).toBe(true);
    expect(source.model.styles).toEqual([{ numberFormat: '@' }]);
  });
  it('never infers numbers, dates, formulas, booleans or apostrophe escaping', () => {
    expect(values(read("001,2026-11-12,=SUM(A1),+1,-1,@x,TRUE,1e3,'001"))).toEqual([['001', '2026-11-12', '=SUM(A1)', '+1', '-1', '@x', 'TRUE', '1e3', "'001"]]);
  });
  it('changes only selected field tokens while retaining BOM, quoting, CRLF, embedded newlines, ragged widths and trailing empty cells', () => {
    const text = '\ufeff"keep",001,"line\r\nbreak",\r\n雪,=1+2,"quoted"\r\n';
    const source = read(text), result = patchCsvDocument(source, edit(source, 'new,"text"\n雪', 1, 1));
    expect(result.bytes.toString()).toBe('\ufeff"keep",001,"line\r\nbreak",\r\n雪,"new,""text""\n雪","quoted"\r\n');
    expect(values(readCsvDocument(result.bytes))[1]![1]).toBe('new,"text"\n雪');
  });
  it('preserves row identity when clearing the final field of a single-column final record', () => {
    const source = read('keep\nlast');
    expect(patchCsvDocument(source, edit(source, '', 1)).bytes.toString()).toBe('keep\n""');
    expect(values(readCsvDocument(patchCsvDocument(source, edit(source, '', 1)).bytes))).toEqual([['keep'], ['']]);
  });
  it('retains original quoted spelling for equal-value edits and sorts nonoverlapping changes', () => {
    const source = read('"a",b,c\n'), first = edit(source, 'a');
    expect(patchCsvDocument(source, first).bytes.toString()).toBe('"a",b,c\n');
    const last = edit(source, 'z', 0, 2).edits[0]!;
    expect(patchCsvDocument(source, { ...first, edits: [last, ...edit(source, 'y').edits] }).bytes.toString()).toBe('"y",b,z\n');
  });
  it.each(['"unterminated', 'a"b,c', '"a" x,b', '"a""', 'a\rb', 'a\u0000b'])('refuses malformed or ambiguous inputs without a candidate: %j', text => { expect(() => read(text)).toThrow(); });
  it('refuses invalid UTF-8, UTF-16 and import amplification before building a grid', () => {
    for (const bytes of [Buffer.from([0xc0, 0xaf]), Buffer.from([0xff, 0xfe, 65, 0])]) expect(() => readCsvDocument(bytes)).toThrow(/UTF-8/);
    expect(() => read('x'.repeat(CSV_LIMITS.cellText + 1))).toThrow(/text limit/);
    expect(() => read(','.repeat(16_384))).toThrow(/column limit/);
    expect(() => read('\n'.repeat(CSV_LIMITS.cells + 1))).toThrow(/import limit/);
    expect(() => readCsvDocument(Buffer.alloc(CSV_LIMITS.bytes + 1))).toThrow(/byte limit/);
  });
  it('refuses stale identities, duplicate/absent fields, formulas, formatting and structural edits', () => {
    const source = read('a,b\nc'), plan = edit(source, 'changed');
    const invalid = [
      { ...plan, sourceSha256: '0'.repeat(64) }, { ...plan, edits: [...plan.edits, ...plan.edits] }, edit(source, 'new', 1, 1),
      { ...plan, edits: [{ ...plan.edits[0], cell: { row: 0, column: 0, kind: 'number', value: 12 } }] },
      { ...plan, edits: [{ ...plan.edits[0], cell: { ...plan.edits[0]!.cell, formula: '=1+1' } }] },
      { ...plan, styles: [{ sheetId: 'csv', row: 0, column: 0, bold: true }] },
      { ...plan, dimensions: [{ sheetId: 'csv', axis: 'row', index: 0, size: 40 }] }, edit(source, '\ud800'), edit(source, '\u0000'),
    ];
    for (const input of invalid) expect(() => patchCsvDocument(source, input)).toThrow();
    expect(source.source).toBe('a,b\nc');
  });
});
