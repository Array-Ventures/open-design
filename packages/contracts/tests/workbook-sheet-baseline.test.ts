import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { workbookSheetBaseline, canonicalWorkbookSheetBaseline, workbookSheetBaselineSchema } from '../src/runtime/workbook-sheet-baseline';
import { workbookEditPlanSchema, type WorkbookDocument } from '../src/runtime/workbook';
function source(): WorkbookDocument {
  return { version: 1, date1904: false, activeSheetId: '1', worksheetStructureEditable: true, calculationMetadata: 'verified', richTextMetadata: 'verified', themeColors: Array(12).fill('FF123456'),
    styles: [{ font: { name: 'Arial', size: 11 } }, { font: { bold: true, size: 22.25 } }, { numberFormat: '0.00' }, { fill: { pattern: 'solid', foreground: { kind: 'theme', index: 2 } } }, { font: { italic: true } }],
    features: { charts: 0, drawings: 0, externalLinks: 0, macros: false, signed: false },
    sheets: ['1','2'].map(id => ({ id, name: `Sheet ${id}`, visibility: 'visible', rowCount: 100, columnCount: 26, cells: [{ row: 0, column: 0, kind: 'number', value: -0, style: 1 }, { row: 0, column: 1, kind: 'number', value: 999, formula: '=A1+1' }, { row: 0, column: 2, kind: 'string', value: 'Rich 😀', runs: [{ text: 'Rich ', font: { bold: true } }, { text: '😀', font: { color: { kind: 'rgb', argb: 'FF123456' } } }] }],
      rowDimensions: [{ index: 2, height: 37, style: 2 }], columnDimensions: [{ index: 3, width: 20, style: 3 }], merges: [{ startRow: 4, endRow: 4, startColumn: 0, endColumn: 1 }], frozenRows: 1, frozenColumns: 0, arrayFormulas: [] })),
  };
}
const hash = (model: WorkbookDocument) => createHash('sha256').update(canonicalWorkbookSheetBaseline(workbookSheetBaseline(model,'1'))).digest('hex');
it('captures exact default/cell/row/column style definitions and omits only unused styles', () => {
  const model = source(), before = structuredClone(model), baseline = workbookSheetBaseline(model,'1');
  expect(baseline.styleDefinitions.map(entry => entry.index)).toEqual([0,1,2,3]); expect(baseline.styleDefinitions[1]!.style.font?.size).toBe(22.25);
  const unused = structuredClone(model); unused.styles[4]!.font = { size: 44 }; expect(hash(unused)).toBe(hash(model));
  expect(model).toEqual(before);
});
it('changes identity for same ordinal/different definitions and every interpreted selected/global owner', () => {
  const model = source(), original = hash(model);
  const changes: ((next: WorkbookDocument) => void)[] = [
    next => { next.styles[0]!.font!.name = 'Georgia'; }, next => { next.styles[1]!.font!.size = 11; },
    next => { next.styles[2]!.numberFormat = '$0.00'; }, next => { next.styles[3]!.fill = { pattern: 'solid', foreground: { kind: 'rgb', argb: 'FFFF0000' } }; },
    next => { next.sheets[0]!.cells[1]!.value = 12; }, next => { next.sheets[0]!.cells[1]!.formula = '=A1+2'; },
    next => { const cell = next.sheets[0]!.cells[2]!; if (cell.kind === 'string') cell.runs![0]!.font!.bold = false; },
    next => { next.sheets[0]!.rowDimensions[0]!.height = 38; }, next => { next.sheets[0]!.columnDimensions[0]!.width = 21; },
    next => { next.sheets[0]!.merges[0]!.endColumn = 2; }, next => { next.sheets[0]!.frozenColumns = 1; },
    next => { next.sheets[1]!.name = 'Renamed'; }, next => { next.sheets[1]!.id = '3'; },
    next => { next.date1904 = true; }, next => { next.themeColors![2] = 'FF654321'; },
    next => { delete next.richTextMetadata; }, next => { next.calculationMetadata = 'unsupported'; },
    next => { next.features.drawings = 1; }, next => { next.definedNames = [{ name: 'Owned', formula: "'Sheet 2'!$A$1" }]; },
  ];
  for (const change of changes) { const next = structuredClone(model); change(next); expect(hash(next)).not.toBe(original); }
});
it('uses the explicit public preview JSON domain for signed zero and absent/undefined optional fields', () => {
  const model = source(), baseline = workbookSheetBaseline(model,'1'), json = canonicalWorkbookSheetBaseline(baseline);
  expect(canonicalWorkbookSheetBaseline(JSON.parse(JSON.stringify(baseline)))).toBe(json);
  expect(canonicalWorkbookSheetBaseline(workbookSheetBaseline(JSON.parse(JSON.stringify(model)),'1'))).toBe(json);
  const explicit = { ...baseline, worksheetVisibilityEditable: undefined, definedNames: undefined, tables: undefined };
  expect(canonicalWorkbookSheetBaseline(explicit)).toBe(json);
  const reordered = Object.fromEntries(Object.entries(baseline).reverse()); expect(canonicalWorkbookSheetBaseline(reordered)).toBe(json);
});
it('refuses forged/incomplete closures, stored hash fields and unknown identity versions', () => {
  const baseline = workbookSheetBaseline(source(),'1');
  expect(() => canonicalWorkbookSheetBaseline({ ...baseline, version: 2 })).toThrow();
  expect(() => canonicalWorkbookSheetBaseline({ ...baseline, sha256: '0'.repeat(64) })).toThrow();
  expect(() => canonicalWorkbookSheetBaseline({ ...baseline, styleDefinitions: baseline.styleDefinitions.slice(1) })).toThrow('style closure');
  expect(() => canonicalWorkbookSheetBaseline({ ...baseline, styleDefinitions: [...baseline.styleDefinitions, baseline.styleDefinitions[0]!] })).toThrow('style closure');
  const changed = structuredClone(baseline); changed.sheet.cells[0]!.value = 55;
  expect(canonicalWorkbookSheetBaseline(changed)).not.toBe(canonicalWorkbookSheetBaseline(baseline));
  const missing = source(); missing.styles = [{}]; expect(() => workbookSheetBaseline(missing,'1')).toThrow();
  expect(() => workbookSheetBaseline(source(),'missing')).toThrow('missing');
  expect(workbookSheetBaselineSchema.parse(baseline).version).toBe(1);
});
it('refuses non-JSON/accessor/cyclic/deep input before cloning without executing data getters', () => {
  const baseline = workbookSheetBaseline(source(),'1'); let reads = 0;
  const getter = Object.defineProperty({ ...baseline },'sheet',{ get() { reads++; return baseline.sheet; } });
  expect(() => canonicalWorkbookSheetBaseline(getter)).toThrow('data properties'); expect(reads).toBe(0);
  const cycle: Record<string, unknown> = {}; cycle.self = cycle; expect(() => canonicalWorkbookSheetBaseline(cycle)).toThrow('acyclic');
  let deep: unknown = null; for (let n=0;n<66;n++) deep = { nested: deep }; expect(() => canonicalWorkbookSheetBaseline(deep)).toThrow('depth');
  expect(() => canonicalWorkbookSheetBaseline({ ...baseline, date1904: Number.NaN })).toThrow('finite');
});


it('keeps the proposed baseline claim outside the render wire until its consumer is implemented', () => {
  const plan = { sourceSha256: 'a'.repeat(64), edits: [], sheets: [{ sheetId: '1', name: 'Sheet 1', origin: 'restore', template: { versionId: 'retained', versionSha256: 'a'.repeat(64) } }] };
  expect(workbookEditPlanSchema.safeParse(plan).success).toBe(true);
  expect(workbookEditPlanSchema.safeParse({ ...plan, sheets: [{ ...plan.sheets[0], baselineIdentity: { version: 1, sha256: 'b'.repeat(64) } }] }).success).toBe(false);
});
