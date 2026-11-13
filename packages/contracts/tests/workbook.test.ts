import { describe, expect, it } from 'vitest';
import { workbookCommitRequestSchema, workbookDocumentSchema, workbookEditPlanSchema, workbookPreviewSchema, workbookWriteReceiptSchema, type WorkbookDocument } from '../src/runtime/workbook.js';

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

it('keeps v1 models without array metadata compatible and validates explicit source array ownership', () => {
  const old = fixture(); expect(workbookDocumentSchema.parse(old).sheets[0]!.arrayFormulas).toBeUndefined();
  const model = fixture(), sheet = model.sheets[0]!;
  sheet.cells[0]!.formula = '=SEQUENCE(3)';
  const array = { kind: 'array' as const, row: 4, column: 2, range: { startRow: 4, endRow: 6, startColumn: 2, endColumn: 2 } };
  sheet.arrayFormulas = [array]; expect(workbookDocumentSchema.parse(model).sheets[0]!.arrayFormulas).toEqual([array]);
  for (const invalid of [
    { ...array, row: 5 },
    { ...array, range: { ...array.range, endRow: 100 } },
    { ...array, range: { ...array.range, endRow: 3 } },
  ]) {
    sheet.arrayFormulas = [invalid]; expect(workbookDocumentSchema.safeParse(model).success).toBe(false);
  }
  sheet.arrayFormulas = [array, array]; expect(workbookDocumentSchema.safeParse(model).success).toBe(false);
  sheet.arrayFormulas = [array]; delete sheet.cells[0]!.formula; expect(workbookDocumentSchema.safeParse(model).success).toBe(false);
  sheet.arrayFormulas = [{ ...array, kind: 'dataTable' }]; expect(workbookDocumentSchema.safeParse(model).success).toBe(true);
  sheet.rowCount = 1_048_576; sheet.cells[0]!.formula = '=SEQUENCE(100001)';
  sheet.arrayFormulas = [{ ...array, range: { ...array.range, endRow: 100004 } }];
  expect(workbookDocumentSchema.safeParse(model).success).toBe(false);
});
describe('workbook model boundary', () => {
  it('bounds host commit metadata and keeps authority fields out of user edit plans', () => {
    const request = { operationId: '43370120-4626-43b7-ae9f-808ce5edc582', fileName: 'reports/book.xlsx', sourceSha256: 'a'.repeat(64), targetSha256: 'b'.repeat(64), actor: 'human:fixture', mode: 'reconcile' };
    expect(workbookCommitRequestSchema.parse(request)).toEqual(request);
    // Literal CSV uses this same existing conditional-save envelope. The old
    // negative CSV expectation predates that supported source format.
    for (const fileName of ['book.csv', 'reports/book.csv']) expect(workbookCommitRequestSchema.parse({ ...request, fileName }).fileName).toBe(fileName);
    for (const fileName of ['../book.xlsx', '/book.xlsx', 'a//book.xlsx', 'a/./book.xlsx', 'book.txt', '../book.csv', 'a/./book.csv', 'a\\book.csv', 'a\\book.xlsx']) expect(workbookCommitRequestSchema.safeParse({ ...request, fileName }).success).toBe(false);
    expect(workbookCommitRequestSchema.safeParse({ ...request, mode: 'force' }).success).toBe(false);
    expect(workbookCommitRequestSchema.safeParse({ ...request, actor: 'untrusted actor' }).success).toBe(false);
    expect(workbookCommitRequestSchema.safeParse({ ...request, directory: '/host' }).success).toBe(false);
  });
  it('accepts complete operation receipts and refuses contradictory completion acknowledgements', () => {
    const receipt = { operationId: '43370120-4626-43b7-ae9f-808ce5edc582', fileName: 'book.xlsx', state: 'applied', sourceSha256: 'a'.repeat(64), targetSha256: 'b'.repeat(64), actualSha256: 'b'.repeat(64), versionId: 'v2', sourceVersionId: 'v1', createdAt: 1, updatedAt: 2 };
    expect(workbookWriteReceiptSchema.parse(receipt)).toEqual(receipt);
    expect(workbookWriteReceiptSchema.safeParse({ ...receipt, versionId: null }).success).toBe(false);
    expect(workbookWriteReceiptSchema.safeParse({ ...receipt, actualSha256: 'c'.repeat(64) }).success).toBe(false);
    expect(workbookWriteReceiptSchema.safeParse({ ...receipt, state: 'pending' }).success).toBe(false);
    expect(workbookWriteReceiptSchema.safeParse({ ...receipt, state: 'conflict' }).success).toBe(false);
    expect(workbookWriteReceiptSchema.safeParse({ ...receipt, state: 'conflict', versionId: null, actualSha256: null }).success).toBe(true);
  });
  it('binds previews and edit plans to an exact source hash without accepting authority fields', () => {
    const sourceSha256 = 'a'.repeat(64), cell = { row: 0, column: 0, kind: 'number', value: 2 };
    expect(workbookPreviewSchema.parse({ sourceSha256, model: fixture() }).sourceSha256).toBe(sourceSha256);
    expect(workbookEditPlanSchema.parse({ sourceSha256, edits: [{ sheetId: 'inputs', cell }] }).edits).toHaveLength(1);
    expect(workbookPreviewSchema.safeParse({ sourceSha256: 'invalid', model: fixture() }).success).toBe(false);
    expect(workbookEditPlanSchema.safeParse({ edits: [{ sheetId: 'inputs', cell }] }).success).toBe(false);
    expect(workbookEditPlanSchema.safeParse({ sourceSha256, edits: [{ sheetId: 'inputs', cell }], path: '/outside' }).success).toBe(false);
  });
  it('keeps workbook and sheet name scopes distinct and validates table geometry', () => {
    const input = fixture();
    input.definedNames = [{ name: 'Rate', formula: '3' }, { name: 'Rate', formula: '2', sheetId: 'summary' }];
    input.tables = [{ name: 'Sales', sheetId: 'inputs', range: { startRow: 3, endRow: 6, startColumn: 2, endColumn: 3 }, columns: ['Amount', 'Flag'], header: true, totals: true }];
    expect(workbookDocumentSchema.parse(input)).toEqual(input);
    input.definedNames.push({ name: 'RATE', formula: '4', sheetId: 'summary' });
    expect(workbookDocumentSchema.safeParse(input).success).toBe(false);
    input.definedNames.pop(); input.tables[0]!.columns.push('Extra');
    expect(workbookDocumentSchema.safeParse(input).success).toBe(false);
  });
  it.each(['name-scope', 'table-scope', 'duplicate-table', 'duplicate-column', 'outside-table'])('rejects malformed %s metadata', variant => {
    const input = fixture();
    input.definedNames = [{ name: 'Rate', formula: '2' }];
    input.tables = [{ name: 'Sales', sheetId: 'inputs', range: { startRow: 3, endRow: 6, startColumn: 2, endColumn: 3 }, columns: ['Amount', 'Flag'], header: true, totals: true }];
    if (variant === 'name-scope') input.definedNames[0]!.sheetId = 'absent';
    if (variant === 'table-scope') input.tables[0]!.sheetId = 'absent';
    if (variant === 'duplicate-table') input.tables.push({ ...input.tables[0]!, name: 'SALES' });
    if (variant === 'duplicate-column') input.tables[0]!.columns = ['Amount', 'AMOUNT'];
    if (variant === 'outside-table') input.tables[0]!.range.endRow = 100;
    expect(workbookDocumentSchema.safeParse(input).success).toBe(false);
  });
  it('retains theme colors, inherited dimension styles and gradient geometry', () => {
    const input = fixture();
    input.themeColors = Array.from({ length: 12 }, () => 'FF123456');
    input.styles.push({ fill: { gradient: 'angle', degree: 45, stops: [
      { position: 0, color: { kind: 'theme', index: 4, tint: 0.5 } },
      { position: 1, color: { kind: 'rgb', argb: 'FFFFFFFF' } },
    ] } });
    input.sheets[0]!.defaultRowHeight = 22;
    input.sheets[0]!.defaultColumnWidth = 16;
    input.sheets[0]!.rowDimensions.push({ index: 2, style: 1 });
    input.sheets[0]!.columnDimensions.push({ index: 3, style: 1 });
    expect(workbookDocumentSchema.parse(input)).toEqual(input);
    input.sheets[0]!.columnDimensions[0]!.style = 2;
    expect(workbookDocumentSchema.safeParse(input).success).toBe(false);
  });
  it('rejects malformed theme tables and gradient positions', () => {
    const input = fixture(); input.themeColors = ['FF123456'];
    expect(workbookDocumentSchema.safeParse(input).success).toBe(false);
    delete input.themeColors;
    input.styles[0]!.fill = { gradient: 'path', center: { left: 0.5, top: 0.5 }, stops: [
      { position: -0.1, color: { kind: 'auto' } }, { position: 1, color: { kind: 'auto' } },
    ] };
    expect(workbookDocumentSchema.safeParse(input).success).toBe(false);
  });
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
it('bounds row and column resizing plans and refuses unknown dimension authority', () => {
  const base = { sourceSha256: 'a'.repeat(64), edits: [] };
  expect(workbookEditPlanSchema.safeParse({ ...base, dimensions: [{ sheetId: 'inputs', axis: 'row', index: 2, size: 36 }, { sheetId: 'inputs', axis: 'column', index: 1, size: 25 }] }).success).toBe(true);
  for (const bad of [{ sheetId: 'inputs', axis: 'row', index: 0 }, { sheetId: 'inputs', axis: 'column', index: 16384, size: 12 }, { sheetId: 'inputs', axis: 'row', index: 0, size: -1 }, { sheetId: 'inputs', axis: 'column', index: 0, size: 12, path: '/host' }]) expect(workbookEditPlanSchema.safeParse({ ...base, dimensions: [bad] }).success).toBe(false);
});
