import type { WorkbookCell, WorkbookDocument } from '@open-design/contracts/runtime/workbook';
import { WorkbookFormatError } from './package.js';

export interface FormulaDependencyNode { treeId: number; unitId: string; subUnitId: string; row: number; column: number; formula: string; parents: readonly number[] }
export interface FormulaCacheRuntime {
  nodes(formula: string): readonly (string | { nodeType: number; token: string })[] | undefined;
  hasExecutor(name: string): boolean;
  isLiteral(token: string): boolean;
  externalReference(token: string): boolean;
  name(token: string, sheetId: string): { id: string; formula: string; sheetId?: string } | undefined;
  table(token: string): boolean;
  types: { FUNCTION: number; REFERENCE: number; DEFINED_NAME: number; TABLE: number };
}
export const formulaCellKey = (sheet: string, row: number, column: number) => JSON.stringify([sheet, row, column]);
const richOrDynamicReferences = new Set(['HYPERLINK', 'IMAGE', 'INDIRECT', 'OFFSET']);
export const WORKBOOK_FORMULA_ANALYSIS_LIMITS = { lexerCalls: 110_000, tokens: 1_000_000, visits: 2_000_000, names: 262_144, expanded: 8_000_000, depth: 64 } as const;
interface NameAnalysis { limited: boolean; expanded: number; cyclic: boolean }
/** One analyzer per calculation. Global names can resolve local dependencies in
 * the caller's sheet, so identity alone is not a safe memoization key. Expanded
 * cost counts repeated occurrences, while actual analysis visits each name once. */
export function createFormulaCacheAnalysis(runtime: FormulaCacheRuntime, limits: Readonly<Record<keyof typeof WORKBOOK_FORMULA_ANALYSIS_LIMITS, number>> = WORKBOOK_FORMULA_ANALYSIS_LIMITS) {
  for (const key of Object.keys(WORKBOOK_FORMULA_ANALYSIS_LIMITS) as (keyof typeof WORKBOOK_FORMULA_ANALYSIS_LIMITS)[]) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 1 || limits[key] > WORKBOOK_FORMULA_ANALYSIS_LIMITS[key]) throw new WorkbookFormatError('Invalid formula analysis work limit.', 'WORKBOOK_LIMIT');
  }
  const lexed = new Map<string, readonly (string | { nodeType: number; token: string })[]>();
  const names = new Map<string, NameAnalysis & { formula: string }>(), visiting = new Set<string>();
  const work = { lexerCalls: 0, tokens: 0, visits: 0, names: 0, expanded: 0 };
  const saturate = (a: number, b: number) => Math.min(limits.expanded + 1, a + b);
  const spend = (kind: keyof typeof work, amount = 1) => {
    work[kind] = kind === 'expanded' ? saturate(work[kind], amount) : work[kind] + amount;
    if (work[kind] > limits[kind]) throw new WorkbookFormatError('Formula name analysis exceeds its work limit. Your file has not changed.', 'WORKBOOK_LIMIT');
  };
  function analyze(formula: string, sheetId: string, depth = 0): NameAnalysis {
    spend('visits');
    let nodes = lexed.get(formula);
    if (!nodes) {
      spend('lexerCalls'); nodes = runtime.nodes(formula);
      if (!nodes) throw new WorkbookFormatError('Formula analysis is unavailable.', 'WORKBOOK_UNSUPPORTED');
      spend('tokens', nodes.length); lexed.set(formula, nodes);
    }
    // Relative named references can gain longer row/column coordinates during
    // engine substitution. Pad each reference for both range endpoints.
    const result: NameAnalysis = { limited: false, expanded: Math.min(limits.expanded + 1, formula.length + nodes.length + nodes.filter(node => typeof node !== 'string' && node.nodeType === runtime.types.REFERENCE).length * 24), cyclic: false };
    // Scan every occurrence, even after finding an unsupported leaf: the pinned
    // engine expands named expressions before evaluating that leaf's error.
    for (let index = 0; index < nodes.length; index++) {
      spend('visits');
      const node = nodes[index]!; if (typeof node === 'string') continue;
      const nextToken = nodes[index + 1], called = typeof nextToken === 'string' && nextToken.trim() === '(';
      const callable = called && runtime.hasExecutor(node.token.toUpperCase());
      const name = (node.nodeType === runtime.types.FUNCTION || node.nodeType === runtime.types.REFERENCE || node.nodeType === runtime.types.DEFINED_NAME) && !callable ? runtime.name(node.token, sheetId) : undefined;
      if (name) {
        const effectiveSheet = name.sheetId ?? sheetId, identity = JSON.stringify([name.id, effectiveSheet]);
        let child = names.get(identity);
        if (child && child.formula !== name.formula) throw new WorkbookFormatError('Name metadata changed during formula analysis.', 'WORKBOOK_UNSUPPORTED');
        if (!child) {
          if (visiting.has(identity)) {
            result.limited = true; result.cyclic = true; result.expanded = limits.expanded + 1; continue;
          }
          if (depth >= limits.depth) throw new WorkbookFormatError('Formula name analysis exceeds its depth limit. Your file has not changed.', 'WORKBOOK_LIMIT');
          spend('names'); visiting.add(identity);
          let analyzed: NameAnalysis;
          try { analyzed = analyze(name.formula.startsWith('=') ? name.formula : `=${name.formula}`, effectiveSheet, depth + 1); }
          finally { visiting.delete(identity); }
          child = { ...analyzed, formula: name.formula }; names.set(identity, child);
        }
        result.expanded = saturate(result.expanded, child.expanded);
        result.cyclic ||= child.cyclic; result.limited ||= child.limited || called;
        continue;
      }
      if (runtime.isLiteral(node.token)) continue;
      if ((node.nodeType === runtime.types.TABLE || node.nodeType === runtime.types.FUNCTION && !called) && runtime.table(node.token)) continue;
      if (node.nodeType === runtime.types.FUNCTION && (!called || !runtime.hasExecutor(node.token.toUpperCase()) || richOrDynamicReferences.has(node.token.toUpperCase()))) result.limited = true;
      if (node.nodeType === runtime.types.REFERENCE && runtime.externalReference(node.token)) result.limited = true;
      if (node.nodeType === runtime.types.TABLE || node.nodeType === runtime.types.DEFINED_NAME) result.limited = true;
    }
    return result;
  }
  return {
    limited: (formula: string, sheetId: string) => analyze(formula, sheetId).limited,
    admit: (formula: string, sheetId: string) => {
      const result = analyze(formula, sheetId);
      if (result.cyclic) throw new WorkbookFormatError('Cyclic defined names cannot be recalculated here. Your file has not changed.', 'WORKBOOK_UNSUPPORTED');
      spend('expanded', result.expanded);
    },
    work: () => ({ ...work }),
  };
}
/** The bounded engine's emitted graph is authoritative for dependent closure,
 * including IFERROR masks and cross-sheet chains. No formula/error text regexes
 * and no calculated/browser values are cache authority. */
export function retainedFormulaCaches(model: WorkbookDocument, original: WorkbookDocument, unitId: string,
  trees: readonly FormulaDependencyNode[], engineFormulas: ReadonlyMap<string, string>, normalized: ReadonlyMap<string, string>, analysis: ReturnType<typeof createFormulaCacheAnalysis>): Set<string> {
  const current = new Map<string, WorkbookCell>(), originals = new Map<string, WorkbookCell>();
  for (const sheet of model.sheets) for (const cell of sheet.cells) if (cell.formula) current.set(formulaCellKey(sheet.id, cell.row, cell.column), cell);
  for (const sheet of original.sheets) for (const cell of sheet.cells) if (cell.formula) originals.set(formulaCellKey(sheet.id, cell.row, cell.column), cell);
  const byId = new Map(trees.filter(tree => tree.unitId === unitId).map(tree => [tree.treeId, tree]));
  const byCell = new Map([...byId.values()].map(tree => [formulaCellKey(tree.subUnitId, tree.row, tree.column), tree]));
  const retained = new Set<string>(), queue: number[] = [];
  for (const [key, cell] of current) {
    const tree = byCell.get(key);
    // A missing/stale graph could hide a dependent edge. Do not pretend such a
    // branch is independently supported merely because tokenization succeeded.
    if (!tree || tree.formula !== engineFormulas.get(key)) throw new WorkbookFormatError('Formula dependency analysis is incomplete.', 'WORKBOOK_UNSUPPORTED');
    if (analysis.limited(normalized.get(key)!, tree.subUnitId)) { retained.add(key); queue.push(tree.treeId); }
  }
  const visited = new Set(queue);
  for (let index = 0; index < queue.length; index++) for (const parentId of byId.get(queue[index]!)?.parents ?? []) {
    if (visited.has(parentId)) continue; visited.add(parentId); queue.push(parentId);
    const parent = byId.get(parentId); if (!parent) throw new WorkbookFormatError('Formula dependent analysis is incomplete.', 'WORKBOOK_UNSUPPORTED');
    const key = formulaCellKey(parent.subUnitId, parent.row, parent.column); if (current.has(key)) retained.add(key);
  }
  for (const key of retained) if (originals.get(key)?.formula !== current.get(key)?.formula) {
    throw new WorkbookFormatError('A new or changed unsupported formula or dependent cannot be saved with a stored result. Your file has not changed.', 'WORKBOOK_UNSUPPORTED');
  }
  return retained;
}
