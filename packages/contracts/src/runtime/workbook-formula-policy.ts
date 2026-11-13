/** The existing reviewed scalar/reduction execution kernels, shared with the
 * structural source admission boundary. Recognition alone grants no execution. */
export const QUALIFIED_WORKBOOK_FUNCTIONS: ReadonlySet<string> = new Set(['PLUS', 'MINUS', 'MULTIPLY', 'DIVIDED', 'POWER', 'COMPARE', 'CUBE', 'SUM', 'SUMIF', 'SUMIFS', 'MIN', 'MAX', 'COUNT', 'COUNTA', 'COUNTIF', 'COUNTIFS', 'AVERAGE', 'AVERAGEIF', 'AVERAGEIFS', 'IF', 'IFERROR', 'AND', 'OR', 'NOT', 'ABS', 'ROUND', 'ROUNDDOWN', 'ROUNDUP', 'INT', 'MOD', 'SIGN', 'SQRT']);

export type WorkbookFormulaToken = string | { nodeType: number; token: string };
const reductions = new Set(['SUM', 'SUMIF', 'SUMIFS', 'MIN', 'MAX', 'COUNT', 'COUNTA', 'COUNTIF', 'COUNTIFS', 'AVERAGE', 'AVERAGEIF', 'AVERAGEIFS']);
/** Conservative scalar proof over pinned lexer tokens, not a second formula
 * parser. Range broadcasting, whole-axis semantics and unqualified kernels
 * must not invalidate stored caches during structural editing. */
export function assertWorkbookStructuralScalarTokens(formula: string, nodes: readonly WorkbookFormulaToken[] | undefined, runtime: {
  types: { FUNCTION: number; REFERENCE: number; ARRAY: number; TABLE: number; DEFINED_NAME: number };
  isLiteral(token: string): boolean;
  referenceShape(token: string): 'single' | 'range' | 'whole-axis';
}): void {
  if (!nodes || formula.length > 16_384 || nodes.length > 512) throw new Error('This formula exceeds its structural analysis budget.');
  const stack: (string | null)[] = [];
  for (const [index, node] of nodes.entries()) {
    if (typeof node === 'string') {
      if (node === '&' || node === '#') throw new Error('Text concatenation and spill references need a structural adapter.');
      if (node === '(') { const previous = nodes[index - 1]; stack.push(previous && typeof previous !== 'string' && previous.nodeType === runtime.types.FUNCTION ? previous.token.toUpperCase() : null); }
      if (node === ')') { if (!stack.length) throw new Error('Structural formula parentheses are invalid.'); stack.pop(); }
      continue;
    }
    if ([runtime.types.ARRAY, runtime.types.TABLE, runtime.types.DEFINED_NAME].includes(node.nodeType)) throw new Error('Array, table and named formulas need a structural adapter.');
    if (node.nodeType === runtime.types.FUNCTION && !runtime.isLiteral(node.token)) {
      if (nodes[index + 1] !== '(' || !QUALIFIED_WORKBOOK_FUNCTIONS.has(node.token.toUpperCase())) throw new Error('This formula has no qualified scalar structural executor.');
    }
    if (node.nodeType === runtime.types.REFERENCE) {
      const shape = runtime.referenceShape(node.token);
      if (shape === 'whole-axis') throw new Error('Whole-axis formulas need structural calculation qualification.');
      let call: string | null = null; for (let depth = stack.length - 1; depth >= 0; depth--) if (stack[depth] !== null) { call = stack[depth]!; break; }
      if (shape === 'range' && (!call || !reductions.has(call))) throw new Error('Range broadcasting needs a structural array adapter.');
    }
  }
  if (stack.length) throw new Error('Structural formula parentheses are invalid.');
}
