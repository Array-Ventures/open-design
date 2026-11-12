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
function limited(formula: string, sheetId: string, runtime: FormulaCacheRuntime, visiting = new Set<string>()): boolean {
  const nodes = runtime.nodes(formula); if (!nodes) throw new WorkbookFormatError('Formula analysis is unavailable.', 'WORKBOOK_UNSUPPORTED');
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index]!; if (typeof node === 'string' || runtime.isLiteral(node.token)) continue;
    // The pinned lexical facade labels unbound words/table fragments FUNCTION
    // too. Resolve metadata through its own services/structured-ref decoder
    // before treating a non-call token as an unregistered function.
    const nextToken = nodes[index + 1], called = typeof nextToken === 'string' && nextToken.trim() === '(';
    const name = !called ? runtime.name(node.token, sheetId) : undefined;
    if (name) {
      if (visiting.has(name.id) || visiting.size >= 64) return true;
      const next = new Set(visiting); next.add(name.id);
      if (limited(name.formula.startsWith('=') ? name.formula : `=${name.formula}`, name.sheetId ?? sheetId, runtime, next)) return true;
      continue;
    }
    if ((node.nodeType === runtime.types.TABLE || node.nodeType === runtime.types.FUNCTION && !called) && runtime.table(node.token)) continue;
    if (node.nodeType === runtime.types.FUNCTION && (!called || !runtime.hasExecutor(node.token.toUpperCase()) || richOrDynamicReferences.has(node.token.toUpperCase()))) return true;
    if (node.nodeType === runtime.types.REFERENCE && runtime.externalReference(node.token)) return true;
    if (node.nodeType === runtime.types.TABLE || node.nodeType === runtime.types.DEFINED_NAME) return true;
  }
  return false;
}
/** The bounded engine's emitted graph is authoritative for dependent closure,
 * including IFERROR masks and cross-sheet chains. No formula/error text regexes
 * and no calculated/browser values are cache authority. */
export function retainedFormulaCaches(model: WorkbookDocument, original: WorkbookDocument, unitId: string,
  trees: readonly FormulaDependencyNode[], engineFormulas: ReadonlyMap<string, string>, normalized: ReadonlyMap<string, string>, runtime: FormulaCacheRuntime): Set<string> {
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
    if (limited(normalized.get(key)!, tree.subUnitId, runtime)) { retained.add(key); queue.push(tree.treeId); }
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
