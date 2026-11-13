import { RANGE_TYPE } from '@univerjs/core';
import { deserializeRangeWithSheet, ERROR_TYPE_SET, type ErrorType, generateStringWithSequence, LexerTreeBuilder, sequenceNodeType, serializeRange, serializeRangeWithSheet } from '@univerjs/engine-formula';
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
