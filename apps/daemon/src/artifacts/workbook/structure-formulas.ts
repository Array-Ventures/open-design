import { assertWorkbookStructuralScalarTokens } from '@open-design/contracts/runtime/workbook-formula-policy';
import { RANGE_TYPE } from '@univerjs/core';
import { deserializeRangeWithSheet, ALL_IMPLEMENTED_FUNCTIONS_SET, type IFunctionNames, ERROR_TYPE_SET, type ErrorType, generateStringWithSequence, LexerTreeBuilder, sequenceNodeType, serializeRange, serializeRangeWithSheet } from '@univerjs/engine-formula';
import type { WorkbookAxisProjection } from '@open-design/contracts/runtime/workbook-structure';
import { WorkbookFormatError } from './package.js';

export interface WorkbookSheetProjection { rows: WorkbookAxisProjection; columns: WorkbookAxisProjection }
/** Reuse the pinned formula lexer and reference parser. A1-looking text inside
 * strings/function names is never rewritten. Names/table/external/3-D refs need
 * their own source owners and are refused, rather than regex-substituted. */
export function workbookStructuralFormula(formula: string, currentSheetId: string, sheets: readonly { id: string; name: string }[], projections: ReadonlyMap<string, WorkbookSheetProjection>): string {
  const lexer = new LexerTreeBuilder();
  try {
    const nodes = lexer.sequenceNodesBuilder(formula);
    if (!nodes || nodes.length > 100_000) throw new WorkbookFormatError('Structural formula analysis is unavailable.', 'WORKBOOK_UNSUPPORTED');
    const names = new Map(sheets.map(sheet => [sheet.name.toLowerCase(), sheet.id]));
    let changed = false;
    const rewritten = nodes.map((node, index) => {
      if (typeof node === 'string') return node;
      if (node.nodeType === sequenceNodeType.DEFINED_NAME || node.nodeType === sequenceNodeType.TABLE) throw new WorkbookFormatError('Named and table references need a separate structural writer.', 'WORKBOOK_UNSUPPORTED');
      // Without a name registry the pinned lexer classifies bare names and
      // structured-reference prefixes as FUNCTION too. A real call must be
      // immediately followed by its opening parenthesis; boolean literals are
      // the only accepted bare identifiers in this bounded writer.
      if (node.nodeType === sequenceNodeType.FUNCTION && !['TRUE', 'FALSE'].includes(node.token.toUpperCase()) && !ERROR_TYPE_SET.has(node.token as ErrorType) && (nodes[index + 1] !== '(' || !/^[A-Za-z_][A-Za-z0-9_.]*$/.test(node.token))) throw new WorkbookFormatError('Named and table references need a separate structural writer.', 'WORKBOOK_UNSUPPORTED');
      if (node.nodeType !== sequenceNodeType.REFERENCE) return node;
      const ref = deserializeRangeWithSheet(node.token);
      if (ref.unitId) throw new WorkbookFormatError('External structural references are unsupported.', 'WORKBOOK_UNSUPPORTED');
      const sheetId = ref.sheetName ? names.get(ref.sheetName.toLowerCase()) : currentSheetId;
      if (!sheetId) throw new WorkbookFormatError('The structural reference sheet is unavailable.', 'WORKBOOK_UNSUPPORTED');
      const projection = projections.get(sheetId); if (!projection) return node;
      const range = ref.range, bounds = { ...range };
      const rows = range.rangeType === RANGE_TYPE.COLUMN || range.rangeType === RANGE_TYPE.ALL ? [range.startRow, range.endRow] : projection.rows.interval(range.startRow, range.endRow);
      const columns = range.rangeType === RANGE_TYPE.ROW || range.rangeType === RANGE_TYPE.ALL ? [range.startColumn, range.endColumn] : projection.columns.interval(range.startColumn, range.endColumn);
      let token: string;
      if (!rows || !columns) token = '#REF!';
      else {
        [bounds.startRow, bounds.endRow] = rows as [number, number];
        [bounds.startColumn, bounds.endColumn] = columns as [number, number];
        if (bounds.startRow === range.startRow && bounds.endRow === range.endRow && bounds.startColumn === range.startColumn && bounds.endColumn === range.endColumn) return node;
        token = ref.sheetName ? serializeRangeWithSheet(ref.sheetName, bounds) : serializeRange(bounds);
      }
      changed = true; return { ...node, token };
    });
    if (!changed) return formula;
    const result = generateStringWithSequence(rewritten);
    return formula.startsWith('=') && !result.startsWith('=') ? `=${result}` : result;
  } finally { lexer.dispose(); }
}

/** Qualify scalar source semantics and find the finite reference extent needed
 * by the grid/calculator. Whole-axis ranges are deliberately not approximated
 * by the editor's materialized window. */
export function workbookStructuralFormulaBounds(sheets: readonly { id: string; name: string; cells: readonly { formula?: string | undefined }[] }[]): Map<string, { rows: number; columns: number }> {
  const names = new Map(sheets.map(sheet => [sheet.name.toLowerCase(), sheet.id]));
  const bounds = new Map(sheets.map(sheet => [sheet.id, { rows: 1, columns: 1 }]));
  const lexer = new LexerTreeBuilder(); let work = 0, formulas = 0, executionWork = 0;
  try {
    for (const sheet of sheets) for (const cell of sheet.cells) if (cell.formula) {
      if (++formulas > 10_000) throw new WorkbookFormatError('Structural formula count exceeds its work budget.', 'WORKBOOK_LIMIT');
      const nodes = lexer.sequenceNodesBuilder(cell.formula); let rows = 1, columns = 1;
      work += nodes?.length ?? 0; if (work > 1_000_000) throw new WorkbookFormatError('Structural formula analysis exceeds its work budget.', 'WORKBOOK_LIMIT');
      assertWorkbookStructuralScalarTokens(cell.formula, nodes, {
        types: sequenceNodeType,
        hasExecutor: name => ALL_IMPLEMENTED_FUNCTIONS_SET.has(name as IFunctionNames),
        isLiteral: token => ['TRUE', 'FALSE'].includes(token.toUpperCase()) || ERROR_TYPE_SET.has(token as ErrorType),
        referenceShape: token => {
          const ref = deserializeRangeWithSheet(token), target = ref.sheetName ? names.get(ref.sheetName.toLowerCase()) : sheet.id;
          if (ref.unitId || !target) throw new WorkbookFormatError('External or unavailable structural reference.', 'WORKBOOK_UNSUPPORTED');
          const range = ref.range;
          if (range.rangeType === RANGE_TYPE.ROW || range.rangeType === RANGE_TYPE.COLUMN || range.rangeType === RANGE_TYPE.ALL) return 'whole-axis';
          if (![range.startRow, range.endRow, range.startColumn, range.endColumn].every(value => Number.isSafeInteger(value) && value >= 0) || range.endRow < range.startRow || range.endColumn < range.startColumn || range.endRow >= 1048576 || range.endColumn >= 16384) throw new WorkbookFormatError('Invalid structural formula reference.', 'WORKBOOK_UNSUPPORTED');
          const needed = bounds.get(target)!; needed.rows = Math.max(needed.rows, range.endRow + 1); needed.columns = Math.max(needed.columns, range.endColumn + 1);
          rows = Math.max(rows, range.endRow - range.startRow + 1); columns = Math.max(columns, range.endColumn - range.startColumn + 1);
          return range.startRow === range.endRow && range.startColumn === range.endColumn ? 'single' : 'range';
        },
      });
      executionWork += rows * columns * ((nodes?.length ?? 0) + 1);
      if (!Number.isSafeInteger(executionWork) || executionWork > 1_000_000) throw new WorkbookFormatError('Structural formulas exceed the qualified calculation work budget.', 'WORKBOOK_LIMIT');
    }
    return bounds;
  } catch (error) { throw error instanceof WorkbookFormatError ? error : new WorkbookFormatError(error instanceof Error ? error.message : 'Structural scalar formula analysis failed.', 'WORKBOOK_UNSUPPORTED'); }
  finally { lexer.dispose(); }
}
