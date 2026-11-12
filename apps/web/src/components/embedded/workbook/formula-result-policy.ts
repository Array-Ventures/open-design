import type { ICellData, IWorkbookData } from '@univerjs/presets';

export type FormulaCalculationLimit = 'unsupported-function' | 'external-reference' | 'unsupported-reference' | 'dynamic-result' | 'pending-analysis' | 'dependent';
export interface FormulaDependencyNode {
  treeId: number; unitId: string; subUnitId: string; row: number; column: number; formula: string; parents: readonly number[];
}
/** Bind these methods to the pinned Univer lexer, reference decoder and actual
 * function service. This policy does not tokenize formulas itself. */
export interface FormulaAnalysisRuntime {
  sequenceNodesBuilder(formula: string): readonly (string | { nodeType: number; token: string })[] | undefined;
  hasExecutor(name: string): boolean;
  deserializeRangeWithSheet(token: string): { unitId: string };
  sequenceNodeType: { FUNCTION: number; REFERENCE: number; DEFINED_NAME: number; TABLE: number };
}
export interface LimitedFormulaCell { sheetId: string; row: number; column: number; formula: string; reason: FormulaCalculationLimit }
export interface WorkbookFormulaPolicy { unitId: string; limited: LimitedFormulaCell[] }
export interface WorkbookFormulaCalculationStatus {
  limitedCells: number; storedResults: number; unavailableResults: number;
  cells: (LimitedFormulaCell & { result: 'stored' | 'unavailable' })[];
}
type ResultCell = Pick<ICellData, 'v' | 't' | 'p'>;
export interface FormulaCalculationResults {
  unitData: Record<string, Record<string, Record<number, Record<number, ResultCell>>>>;
  sourceFormulaData?: Record<string, Record<string, Record<number, Record<number, { f?: string | null }>>>>;
}

// These can create rich documents, variable references or spill ranges. Their
// result/application paths need separate acceptance before this scalar policy
// can describe them as live-calculated. This is not an exhaustive spill guard.
const dynamicResults = new Set(['HYPERLINK', 'IMAGE', 'INDIRECT', 'OFFSET', 'SEQUENCE', 'TRANSPOSE', 'FILTER', 'SORT', 'SORTBY', 'UNIQUE', 'TAKE', 'DROP', 'CHOOSECOLS', 'CHOOSEROWS', 'WRAPROWS', 'WRAPCOLS', 'VSTACK', 'HSTACK', 'EXPAND', 'TOROW', 'TOCOL', 'MAKEARRAY', 'MAP', 'REDUCE', 'SCAN', 'BYROW', 'BYCOL']);
const key = (sheet: string, row: number, column: number) => JSON.stringify([sheet, row, column]);
const cellAt = (book: IWorkbookData, sheet: string, row: number, column: number) => book.sheets[sheet]?.cellData?.[row]?.[column];

function limitation(formula: string, runtime: FormulaAnalysisRuntime): FormulaCalculationLimit | undefined {
  const nodes = runtime.sequenceNodesBuilder(formula);
  if (!nodes) return 'pending-analysis';
  for (const node of nodes) {
    if (typeof node === 'string') continue;
    if (node.nodeType === runtime.sequenceNodeType.FUNCTION) {
      const name = node.token.toUpperCase();
      if (!runtime.hasExecutor(name)) return 'unsupported-function';
      if (dynamicResults.has(name)) return 'dynamic-result';
    }
    if (node.nodeType === runtime.sequenceNodeType.REFERENCE && runtime.deserializeRangeWithSheet(node.token).unitId) return 'external-reference';
    // The current display adapter does not load workbook defined names/tables
    // into Univer. A stored result is preferable to a fabricated #NAME? error.
    if (node.nodeType === runtime.sequenceNodeType.DEFINED_NAME || node.nodeType === runtime.sequenceNodeType.TABLE) return 'unsupported-reference';
  }
}

/** Analyze the graph emitted BEFORE the matching scalar result mutation.
 * `parents` are formulas depending on this node, including across sheets. */
export function workbookFormulaPolicy(snapshot: IWorkbookData, trees: readonly FormulaDependencyNode[], runtime: FormulaAnalysisRuntime): WorkbookFormulaPolicy {
  const currentTrees = trees.filter(tree => tree.unitId === snapshot.id);
  const treeByCell = new Map(currentTrees.map(tree => [key(tree.subUnitId, tree.row, tree.column), tree]));
  const treeById = new Map(currentTrees.map(tree => [tree.treeId, tree]));
  const limited = new Map<string, LimitedFormulaCell>();
  const queue: number[] = [];
  for (const [sheetId, sheet] of Object.entries(snapshot.sheets)) {
    for (const [rawRow, cells] of Object.entries(sheet.cellData ?? {})) for (const rawColumn of Object.keys(cells ?? {})) {
      const cell = cellAt(snapshot, sheetId, Number(rawRow), Number(rawColumn));
      if (!cell?.f) continue;
      const row = Number(rawRow), column = Number(rawColumn), identity = key(sheetId, row, column), tree = treeByCell.get(identity);
      let reason: FormulaCalculationLimit | undefined;
      try { reason = limitation(cell.f, runtime) ?? (tree?.formula === cell.f ? undefined : 'pending-analysis'); }
      catch { reason = 'pending-analysis'; }
      if (!reason) continue;
      limited.set(identity, { sheetId, row, column, formula: cell.f, reason });
      if (tree) queue.push(tree.treeId);
    }
  }
  const visited = new Set(queue);
  for (let index = 0; index < queue.length; index++) {
    const tree = treeById.get(queue[index]!);
    for (const parentId of tree?.parents ?? []) {
      if (visited.has(parentId)) continue;
      visited.add(parentId); queue.push(parentId);
      const parent = treeById.get(parentId);
      if (!parent) continue;
      const cell = cellAt(snapshot, parent.subUnitId, parent.row, parent.column);
      if (cell?.f && !limited.has(key(parent.subUnitId, parent.row, parent.column))) {
        limited.set(key(parent.subUnitId, parent.row, parent.column), { sheetId: parent.subUnitId, row: parent.row, column: parent.column, formula: cell.f, reason: 'dependent' });
      }
    }
  }
  return { unitId: snapshot.id, limited: [...limited.values()] };
}

/** Intercept only SetFormulaCalculationResultMutation. Never change source `f`
 * or treat engine-computed caches as literal user edits. Genuine errors from
 * supported formulas remain visible. New/edited limited formulas cannot reuse
 * an unrelated old cache and are explicitly counted as unavailable.
 *
 * IMPORTANT: this is a scalar result policy, not complete array/spill safety.
 * SetArrayFormulaDataMutation/derived cells need their own boundary before a
 * grid enables arbitrary live calculation. Keep the grid engine disabled until
 * that boundary is implemented and accepted. */
export function preserveWorkbookFormulaResults(results: FormulaCalculationResults, original: IWorkbookData, current: IWorkbookData,
  policy: WorkbookFormulaPolicy): WorkbookFormulaCalculationStatus {
  const status: WorkbookFormulaCalculationStatus = { limitedCells: policy.limited.length, storedResults: 0, unavailableResults: 0, cells: [] };
  for (const limited of policy.limited) {
    const { sheetId, row, column } = limited;
    const before = cellAt(original, sheetId, row, column), now = cellAt(current, sheetId, row, column);
    const stored = original.id === policy.unitId && current.id === policy.unitId && now?.f === limited.formula && before?.f === now.f && (before.v !== undefined && before.v !== null || Boolean(before.p));
    status[stored ? 'storedResults' : 'unavailableResults']++;
    status.cells.push({ ...limited, result: stored ? 'stored' : 'unavailable' });
    const unit = results.unitData[policy.unitId];
    if (!stored || !unit) continue;
    const resultFormula = results.sourceFormulaData?.[policy.unitId]?.[sheetId]?.[row]?.[column]?.f;
    if (resultFormula !== undefined && resultFormula !== now.f) continue; // stale calculation; Univer's own guard handles it
    const sheet = unit[sheetId] ??= {}, cells = sheet[row] ??= {};
    cells[column] = { v: before.v, t: before.t, p: before.p ? structuredClone(before.p) : null };
    const source = results.sourceFormulaData ??= {}, sourceUnit = source[policy.unitId] ??= {}, sourceSheet = sourceUnit[sheetId] ??= {}, sourceRow = sourceSheet[row] ??= {};
    sourceRow[column] = { f: limited.formula };
  }
  return status;
}
