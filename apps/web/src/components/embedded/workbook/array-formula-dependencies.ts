import { RTree, type IWorkbookData } from '@univerjs/presets';
import type { WorkbookDocument, WorkbookRange } from '@open-design/contracts/runtime/workbook';
import type { FormulaDependencyNode, LimitedFormulaCell, WorkbookFormulaPolicy } from './formula-result-policy';

export interface ArrayDependencyRegion {
  sheetId: string; row: number; column: number; formula: string; range: WorkbookRange;
  provenance: 'source' | 'runtime';
}
export interface ArrayReferenceRuntime {
  sequenceNodesBuilder(formula: string): readonly (string | { nodeType: number; token: string })[] | undefined;
  deserializeRangeWithSheet(token: string): { unitId: string; sheetName: string; range: WorkbookRange };
  sequenceNodeType: { REFERENCE: number };
}
const key = (sheet: string, row: number, column: number) => JSON.stringify([sheet, row, column]);
const cellAt = (book: IWorkbookData, sheet: string, row: number, column: number) => book.sheets[sheet]?.cellData?.[row]?.[column];

/** Explicit source geometry remains conservative dependency evidence while an
 * unsaved source owner formula changes. It is never a promise that its new
 * formula has an old cache or that an absent metadata field means no arrays. */
export function sourceArrayDependencyRegions(model: WorkbookDocument, snapshot: IWorkbookData): ArrayDependencyRegion[] {
  return model.sheets.flatMap(sheet => (sheet.arrayFormulas ?? []).flatMap(array => {
    const formula = cellAt(snapshot, sheet.id, array.row, array.column)?.f;
    return typeof formula === 'string' ? [{ sheetId: sheet.id, row: array.row, column: array.column, formula, range: { ...array.range }, provenance: 'source' as const }] : [];
  }));
}

/** The pinned graph may omit spill-follower edges. Augment it using the pinned
 * reference decoder intersected with proven array ownership. No formula text,
 * local reference, evaluation input, cell value or engine graph is rewritten.
 * The caller owns same-calculation provenance for runtime regions. */
export function workbookArrayFormulaPolicy(snapshot: IWorkbookData, base: WorkbookFormulaPolicy,
  trees: readonly FormulaDependencyNode[], regions: readonly ArrayDependencyRegion[], runtime: ArrayReferenceRuntime): WorkbookFormulaPolicy {
  if (snapshot.id !== base.unitId) throw Error('Array dependency policy belongs to another workbook.');
  const formulas = new Map<string, LimitedFormulaCell>();
  const limited = new Map(base.limited.map(cell => [key(cell.sheetId, cell.row, cell.column), { ...cell }]));
  const next = new Map<string, Set<string>>();
  const edge = (owner: string, dependent: string) => { const items = next.get(owner) ?? new Set<string>(); items.add(dependent); next.set(owner, items); };
  const currentTrees = trees.filter(tree => tree.unitId === snapshot.id), byId = new Map(currentTrees.map(tree => [tree.treeId, tree]));
  for (const tree of currentTrees) for (const parentId of tree.parents) {
    const parent = byId.get(parentId);
    if (parent) edge(key(tree.subUnitId, tree.row, tree.column), key(parent.subUnitId, parent.row, parent.column));
  }
  const names = new Map(Object.entries(snapshot.sheets).flatMap(([id, sheet]) => typeof sheet.name === 'string' ? [[sheet.name.toLowerCase(), id] as const] : []));
  const verified = regions.filter(region => cellAt(snapshot, region.sheetId, region.row, region.column)?.f === region.formula);
  const index = new RTree();
  try {
    index.bulkInsert(verified.map((region, id) => ({ id, unitId: snapshot.id, sheetId: region.sheetId, range: region.range })));
    for (const [sheetId, sheet] of Object.entries(snapshot.sheets)) for (const [rawRow, cells] of Object.entries(sheet.cellData ?? {})) for (const rawColumn of Object.keys(cells ?? {})) {
      const row = Number(rawRow), column = Number(rawColumn), formula = cellAt(snapshot, sheetId, row, column)?.f;
      if (typeof formula !== 'string') continue;
      const identity = key(sheetId, row, column), cell: LimitedFormulaCell = { sheetId, row, column, formula, reason: 'dependent' };
      formulas.set(identity, cell);
      try {
        const tokens = runtime.sequenceNodesBuilder(formula);
        if (!tokens) throw Error('Formula references are unavailable.');
        for (const token of tokens) {
          if (typeof token === 'string' || token.nodeType !== runtime.sequenceNodeType.REFERENCE) continue;
          const ref = runtime.deserializeRangeWithSheet(token.token);
          if (ref.unitId && ref.unitId !== snapshot.id) continue;
          const targetSheet = ref.sheetName ? names.get(ref.sheetName.toLowerCase()) : sheetId;
          if (!targetSheet) continue;
          for (const id of index.searchGenerator({ unitId: snapshot.id, sheetId: targetSheet, range: ref.range })) {
            const owner = verified[Number(id)]!; edge(key(owner.sheetId, owner.row, owner.column), identity);
          }
        }
      } catch { if (!limited.has(identity)) limited.set(identity, { ...cell, reason: 'pending-analysis' }); }
    }
    const queue = [...limited.keys()], visited = new Set(queue);
    for (let position = 0; position < queue.length; position++) for (const dependent of next.get(queue[position]!) ?? []) {
      if (visited.has(dependent)) continue;
      visited.add(dependent); queue.push(dependent);
      const cell = formulas.get(dependent); if (cell) limited.set(dependent, cell);
    }
    return { unitId: base.unitId, limited: [...limited.values()] };
  } finally { index.dispose(); }
}
