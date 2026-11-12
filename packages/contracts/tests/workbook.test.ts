import { describe, expect, it } from 'vitest';
import { workbookDocumentSchema, type WorkbookDocument } from '../src/runtime/workbook.js';

function fixture(): WorkbookDocument {
  return {
    version: 1, date1904: false, activeSheetId: 'inputs', styles: [{ numberFormat: '$#,##0.00' }],
    features: { charts: 1, drawings: 1, externalLinks: 0, macros: false, signed: false },
    sheets: [{
      id: 'inputs', name: 'Inputs', visibility: 'visible', rowCount: 100, columnCount: 26,
      frozenRows: 1, frozenColumns: 1, merges: [], rowDimensions: [], columnDimensions: [],
      cells: [{ row: 4, column: 2, kind: 'number', value: 12.5, style: 0 }, { row: 10, column: 0, kind: 'boolean', value: true }],
    }, {
      id: 'summary', name: 'Summary', visibility: 'visible', rowCount: 100, columnCount: 26,
      frozenRows: 0, frozenColumns: 0, merges: [{ startRow: 0, endRow: 0, startColumn: 0, endColumn: 2 }], rowDimensions: [], columnDimensions: [],
      cells: [{ row: 2, column: 1, kind: 'number', value: 25, formula: '=Inputs!C5*2' }],
    }],
  };
}
describe('workbook model boundary', () => {
  it('retains sparse coordinates, cached formulas, styles, ranges and distinct sheet identities', () => {
    const input = fixture();
    expect(workbookDocumentSchema.parse(input)).toEqual(input);
    expect(workbookDocumentSchema.parse(input).sheets[0]!.cells).toHaveLength(2);
  });
  it('keeps styled blanks and rich text distinct from empty coordinates', () => {
    const input = fixture();
    input.sheets[0]!.cells.push({ row: 50, column: 12, kind: 'blank', value: null, style: 0 }, {
      row: 51, column: 12, kind: 'string', value: 'One two', runs: [{ text: 'One ', font: { bold: true } }, { text: 'two' }],
    });
    expect(workbookDocumentSchema.parse(input)).toEqual(input);
    input.sheets[0]!.cells[3] = { row: 51, column: 12, kind: 'string', value: 'Different', runs: [{ text: 'Lost text' }] };
    expect(workbookDocumentSchema.safeParse(input).success).toBe(false);
  });
  it('does not coerce strings into numbers, accept nonfinite caches, or accept untyped cell payloads', () => {
    for (const value of ['12', Number.NaN, Number.POSITIVE_INFINITY, { formula: '=1+1' }]) {
      const input = fixture();
      Object.assign(input.sheets[0]!.cells[0]!, { value });
      expect(workbookDocumentSchema.safeParse(input).success).toBe(false);
    }
  });
  it('rejects duplicate coordinates instead of letting one cell hide another', () => {
    const input = fixture(); input.sheets[0]!.cells.push({ ...input.sheets[0]!.cells[0]! });
    expect(workbookDocumentSchema.safeParse(input).success).toBe(false);
  });
  it.each(['position', 'style', 'merge', 'freeze', 'dimension'])('rejects an out-of-bounds %s', field => {
    const input = fixture(), sheet = input.sheets[0]!;
    if (field === 'position') sheet.cells[0]!.row = sheet.rowCount;
    if (field === 'style') sheet.cells[0]!.style = 1;
    if (field === 'merge') sheet.merges.push({ startRow: 0, endRow: 101, startColumn: 0, endColumn: 0 });
    if (field === 'freeze') sheet.frozenColumns = 27;
    if (field === 'dimension') sheet.rowDimensions.push({ index: 100, height: 20 });
    expect(workbookDocumentSchema.safeParse(input).success).toBe(false);
  });
  it('rejects reversed ranges and duplicate row/column dimensions', () => {
    const input = fixture(); input.sheets[0]!.merges.push({ startRow: 3, endRow: 2, startColumn: 0, endColumn: 1 });
    expect(workbookDocumentSchema.safeParse(input).success).toBe(false);
    input.sheets[0]!.merges = [];
    input.sheets[0]!.rowDimensions.push({ index: 2, height: 20 }, { index: 2, hidden: true });
    expect(workbookDocumentSchema.safeParse(input).success).toBe(false);
  });
  it('retains a deliberately hidden zero-height row', () => {
    const input = fixture(); input.sheets[0]!.rowDimensions.push({ index: 20, height: 0, hidden: true });
    expect(workbookDocumentSchema.parse(input)).toEqual(input);
  });
  it('accepts neighboring merges but rejects duplicate and intersecting merges', () => {
    const input = fixture(), sheet = input.sheets[0]!;
    sheet.merges = [{ startRow: 0, endRow: 1, startColumn: 0, endColumn: 1 }, { startRow: 0, endRow: 1, startColumn: 2, endColumn: 3 }];
    expect(workbookDocumentSchema.safeParse(input).success).toBe(true);
    sheet.merges.push({ startRow: 1, endRow: 3, startColumn: 1, endColumn: 2 });
    expect(workbookDocumentSchema.safeParse(input).success).toBe(false);
    sheet.merges = [sheet.merges[0]!, { ...sheet.merges[0]! }];
    expect(workbookDocumentSchema.safeParse(input).success).toBe(false);
  });
  it('rejects duplicate sheet identities/names and missing or hidden active sheets', () => {
    const input = fixture(); input.sheets[1]!.id = input.sheets[0]!.id;
    expect(workbookDocumentSchema.safeParse(input).success).toBe(false);
    input.sheets[1]!.id = 'summary'; input.sheets[1]!.name = 'INPUTS';
    expect(workbookDocumentSchema.safeParse(input).success).toBe(false);
    input.sheets[1]!.name = 'Summary'; input.activeSheetId = 'absent';
    expect(workbookDocumentSchema.safeParse(input).success).toBe(false);
    input.activeSheetId = 'inputs'; input.sheets[0]!.visibility = 'hidden';
    expect(workbookDocumentSchema.safeParse(input).success).toBe(false);
  });
  it.each(['Bad/name', 'Bad[name', 'Bad]name', "'Leading", "Trailing'"])('rejects an invalid sheet name %s', name => {
    const input = fixture(); input.sheets[0]!.name = name;
    expect(workbookDocumentSchema.safeParse(input).success).toBe(false);
  });
  it('keeps formula text separate from cached values and requires an actual formula', () => {
    const input = fixture(); input.sheets[1]!.cells[0]!.formula = 'Inputs!C5*2';
    expect(workbookDocumentSchema.safeParse(input).success).toBe(false);
  });
  it('rejects unknown top-level and cell fields rather than forwarding runtime commands', () => {
    const input = fixture(); Object.assign(input, { filePath: '/outside' });
    expect(workbookDocumentSchema.safeParse(input).success).toBe(false);
    const next = fixture(); Object.assign(next.sheets[0]!.cells[0]!, { script: 'run()' });
    expect(workbookDocumentSchema.safeParse(next).success).toBe(false);
  });
  it.each(['__proto__', 'constructor', 'prototype'])('rejects the reserved sheet identity %s', id => {
    const input = fixture(); input.sheets[0]!.id = id; input.activeSheetId = id;
    expect(workbookDocumentSchema.safeParse(input).success).toBe(false);
  });
});
