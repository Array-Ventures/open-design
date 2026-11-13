import type { ICellData, IWorkbookData } from '@univerjs/presets';
import type { WorkbookDocument } from '@open-design/contracts/runtime/workbook';
import { workbookFormulaPolicy, preserveWorkbookFormulaResults, type FormulaAnalysisRuntime, type FormulaCalculationResults, type FormulaDependencyNode, type WorkbookFormulaPolicy } from './formula-result-policy';
import { sourceArrayDependencyRegions, workbookArrayFormulaPolicy, type ArrayDependencyRegion, type ArrayReferenceRuntime } from './array-formula-dependencies';
import { workbookCalculationInputSha256, workbookCalculationTagSchema, type WorkbookCalculationTag } from './formula-input-provenance';
import { QUALIFIED_WORKBOOK_FUNCTIONS } from './formula-execution-policy';

type Result = 'stored' | 'unavailable' | 'pending' | 'calculated';
export interface WorkbookLiveCellStatus { sheetId: string; row: number; column: number; formula: string; result: Result; reason: string }
type ArrayData = { arrayFormulaRange?: Record<string, Record<string, Record<number, Record<number, { startRow: number; endRow: number; startColumn: number; endColumn: number }>>>> };
const key = (sheet: string, row: number, column: number) => JSON.stringify([sheet, row, column]);
const at = (book: IWorkbookData, sheet: string, row: number, column: number) => book.sheets[sheet]?.cellData?.[row]?.[column];
const cached = (cell: ICellData | null | undefined) => Boolean(cell && (cell.v !== undefined && cell.v !== null || cell.p));
const authored = (cell: ICellData | null | undefined) => Boolean(cell && !cell.f && (cell.v !== undefined && cell.v !== null || cell.p));
const valueIdentity = (cell: ICellData | null | undefined) => JSON.stringify([cell?.v ?? null, cell?.t ?? null, cell?.f ?? null, cell?.p ?? null]);
function values(cell: ICellData | null | undefined): Pick<ICellData, 'v' | 't' | 'p'> { return { v: cell?.v ?? null, t: cell?.t ?? null, p: cell?.p ? structuredClone(cell.p) : null }; }
/** Genuine source caches, verified computed output and pending display are
 * separate authorities. This class never mutates raw cells or calculation
 * inputs, and never turns overlay followers into literal writer edits. */
export class WorkbookFormulaDisplay {
  private original: IWorkbookData;
  private initial: IWorkbookData;
  private current: IWorkbookData;
  private derivedSources = new WeakMap<object, WorkbookCalculationTag>();
  private graph: { tag: WorkbookCalculationTag; trees: FormulaDependencyNode[] } | null = null;
  private runtimeArrays: ArrayDependencyRegion[] = [];
  private sourceArrays: ArrayDependencyRegion[];
  private sourceOwner = new Map<string, ArrayDependencyRegion>();
  private conflicts = new Set<string>();
  private statuses = new Map<string, WorkbookLiveCellStatus>();
  private calculated = new Map<string, { formula: string; inputSha256: string; value: Pick<ICellData, 'v' | 't' | 'p'> }>();
  private pending = false;
  private settledGeneration = 0;
  private inputEpoch = 0;
  private graphGeneration = 0;
  private paused: string | null = null;
  constructor(private model: WorkbookDocument, original: IWorkbookData, initial: IWorkbookData, private runtime: FormulaAnalysisRuntime & ArrayReferenceRuntime) {
    this.original = structuredClone(original); this.initial = structuredClone(initial); this.current = structuredClone(initial);
    this.sourceArrays = sourceArrayDependencyRegions(model, this.original);
    for (const owner of this.sourceArrays) for (let row = owner.range.startRow; row <= owner.range.endRow; row++) for (let column = owner.range.startColumn; column <= owner.range.endColumn; column++) this.sourceOwner.set(key(owner.sheetId, row, column), owner);
    this.update(initial, false);
  }
  private runtimePolicy() { return { ...this.runtime, hasExecutor: (name: string) => QUALIFIED_WORKBOOK_FUNCTIONS.has(name.toUpperCase()) && this.runtime.hasExecutor(name) }; }
  private policy(trees: readonly FormulaDependencyNode[]): WorkbookFormulaPolicy {
    const base = workbookFormulaPolicy(this.current, trees, this.runtimePolicy()), limited = new Map(base.limited.map(cell => [key(cell.sheetId, cell.row, cell.column), cell]));
    const regions = [...sourceArrayDependencyRegions(this.model, this.current), ...this.runtimeArrays];
    for (const owner of regions) if (at(this.current, owner.sheetId, owner.row, owner.column)?.f === owner.formula) limited.set(key(owner.sheetId, owner.row, owner.column), { ...owner, reason: 'dynamic-result' });
    return workbookArrayFormulaPolicy(this.current, { unitId: this.current.id, limited: [...limited.values()] }, trees, regions, this.runtime);
  }
  private matching(raw: unknown): WorkbookCalculationTag | null {
    if (this.paused) return null;
    const parsed = workbookCalculationTagSchema.safeParse(raw);
    return parsed.success && parsed.data.valid && (parsed.data.inputEpoch ?? 0) === this.inputEpoch && parsed.data.unitId === this.current.id && parsed.data.inputSha256 === workbookCalculationInputSha256(this.current) ? parsed.data : null;
  }
  update(current: IWorkbookData, pending: boolean) {
    this.current = current; this.pending = pending && !this.paused; this.conflicts.clear();
    for (const [coordinate, owner] of this.sourceOwner) {
      if (coordinate === key(owner.sheetId, owner.row, owner.column)) continue;
      const [sheet, row, column] = JSON.parse(coordinate) as [string, number, number];
      if (valueIdentity(at(current, sheet, row, column)) !== valueIdentity(at(this.initial, sheet, row, column))) this.conflicts.add(key(owner.sheetId, owner.row, owner.column));
    }
    const digest = workbookCalculationInputSha256(current);
    const policy = this.policy([]), intrinsic = new Map(policy.limited.map(cell => [key(cell.sheetId, cell.row, cell.column), cell]));
    this.statuses.clear();
    for (const [sheetId, sheet] of Object.entries(current.sheets)) for (const [r, entries] of Object.entries(sheet.cellData ?? {})) for (const [c, raw] of Object.entries(entries ?? {})) {
      const cell = raw as ICellData | undefined; if (!cell?.f) continue;
      const row = Number(r), column = Number(c), coordinate = key(sheetId, row, column), before = at(this.original, sheetId, row, column), previous = this.calculated.get(coordinate);
      const limit = intrinsic.get(coordinate), permanentlyLimited = Boolean(limit && limit.reason !== 'pending-analysis');
      const result: Result = this.paused ? before?.f === cell.f && cached(before) ? 'stored' : 'unavailable' : !permanentlyLimited && previous?.formula === cell.f && previous.inputSha256 === digest ? 'calculated' : pending && !permanentlyLimited && previous?.formula === cell.f ? 'pending' : before?.f === cell.f && cached(before) ? 'stored' : 'unavailable';
      this.statuses.set(coordinate, { sheetId, row, column, formula: cell.f, result: this.conflicts.has(coordinate) ? 'unavailable' : result, reason: this.paused ?? limit?.reason ?? 'pending-analysis' });
    }
  }
  /** A host-authored mutation epoch is carried through the real RPC options,
   * independently of worker calculation generations or repeated input hashes. */
  expectInputEpoch(epoch: number) { this.inputEpoch = epoch; this.graph = null; }
  isCurrentCompletion(params: { workbookCalculation?: unknown }): boolean {
    const tag = this.matching(params.workbookCalculation);
    return Boolean(tag && tag.generation > this.settledGeneration && tag.generation >= this.graphGeneration);
  }
  /** A no-result terminal message proves only that the matching graph's work
   * finished. Stored caches stay stored; prior calculated values are not
   * promoted to the new input digest. Duplicate/older terminals cannot settle
   * a later mutation that happens to return to the same inputs. */
  completeWithoutResult(params: { workbookCalculation?: unknown }): boolean {
    const tag = this.matching(params.workbookCalculation);
    if (!tag || tag.generation <= this.settledGeneration || !this.graph || this.graph.tag.generation !== tag.generation || this.graph.tag.inputSha256 !== tag.inputSha256) return false;
    this.settledGeneration = tag.generation;
    this.update(this.current, false); return true;
  }
  graphResult(params: { result: FormulaDependencyNode[]; workbookCalculation?: unknown }) {
    const tag = this.matching(params.workbookCalculation);
    if (tag && tag.generation >= this.graphGeneration && tag.generation >= this.settledGeneration) { this.graphGeneration = tag.generation; this.graph = { tag, trees: params.result }; }
  }
  arrayResult(params: ArrayData & { workbookCalculation?: unknown }) {
    if (!this.matching(params.workbookCalculation)) return;
    this.runtimeArrays = [];
    let area = 0;
    for (const [sheetId, rows] of Object.entries(params.arrayFormulaRange?.[this.current.id] ?? {})) for (const [r, columns] of Object.entries(rows)) for (const [c, range] of Object.entries(columns)) {
      const row = Number(r), column = Number(c), formula = at(this.current, sheetId, row, column)?.f;
      const size = (range.endRow - range.startRow + 1) * (range.endColumn - range.startColumn + 1);
      if (!formula || ![row, column, range.startRow, range.endRow, range.startColumn, range.endColumn].every(Number.isSafeInteger) || range.startRow < 0 || range.startColumn < 0 || range.endRow < range.startRow || range.endColumn < range.startColumn || range.endRow >= (this.current.sheets[sheetId]?.rowCount ?? 0) || range.endColumn >= (this.current.sheets[sheetId]?.columnCount ?? 0) || size < 1 || (area += size) > 100_000) throw Error('Array display exceeds its qualified calculation boundary.');
      this.runtimeArrays.push({ sheetId, row, column, formula, range, provenance: 'runtime' });
    }
    this.update(this.current, this.pending);
  }
  scalarResult(params: FormulaCalculationResults & { workbookCalculation?: unknown; unitOtherData?: unknown }): boolean {
    const tag = this.matching(params.workbookCalculation);
    if (!tag || !this.graph || this.graph.tag.generation !== tag.generation || this.graph.tag.inputSha256 !== tag.inputSha256) {
      params.unitData = {}; params.unitOtherData = {}; this.update(this.current, this.pending); return false;
    }
    const policy = this.policy(this.graph.trees), limited = new Set(policy.limited.map(cell => key(cell.sheetId, cell.row, cell.column)));
    preserveWorkbookFormulaResults(params, this.original, this.current, policy);
    for (const [sheetId, rows] of Object.entries(params.unitData[this.current.id] ?? {})) for (const [r, columns] of Object.entries(rows)) for (const [c, value] of Object.entries(columns)) {
      const row = Number(r), column = Number(c), coordinate = key(sheetId, row, column), formula = at(this.current, sheetId, row, column)?.f;
      const retained = params.sourceFormulaData?.[this.current.id]?.[sheetId]?.[row]?.[column]?.f;
      if (!formula || retained !== undefined && retained !== formula) { delete columns[Number(c)]; continue; }
      if (limited.has(coordinate)) continue;
      // The matching input digest already binds exact formula spelling. Add
      // the pinned atomic-application guard when an older kernel omits it.
      const source = params.sourceFormulaData ??= {}, unit = source[this.current.id] ??= {}, sheet = unit[sheetId] ??= {}, cells = sheet[row] ??= {};
      const identity = { f: formula, ...(at(this.current, sheetId, row, column)?.si ? { si: at(this.current, sheetId, row, column)!.si } : {}) };
      cells[column] = identity;
      this.calculated.set(coordinate, { formula, inputSha256: tag.inputSha256, value: structuredClone(value) });
      this.statuses.set(coordinate, { sheetId, row, column, formula, result: 'calculated', reason: '' });
    }
    for (const cell of policy.limited) {
      const before = at(this.original, cell.sheetId, cell.row, cell.column), stored = before?.f === cell.formula && cached(before);
      this.statuses.set(key(cell.sheetId, cell.row, cell.column), { ...cell, result: stored && !this.conflicts.has(key(cell.sheetId, cell.row, cell.column)) ? 'stored' : 'unavailable' });
    }
    for (const sheet of Object.values(params.sourceFormulaData?.[this.current.id] ?? {})) this.derivedSources.set(sheet, tag);
    this.settledGeneration = Math.max(this.settledGeneration, tag.generation);
    this.pending = false; return true;
  }
  rangeResult(params: { unitId: string; subUnitId: string; cellValue: FormulaCalculationResults['unitData'][string][string]; sourceFormulaData?: NonNullable<FormulaCalculationResults['sourceFormulaData']>[string][string]; workbookCalculation?: unknown }): boolean {
    const wrapped = { unitData: { [params.unitId]: { [params.subUnitId]: params.cellValue } }, sourceFormulaData: params.sourceFormulaData ? { [params.unitId]: { [params.subUnitId]: params.sourceFormulaData } } : undefined, workbookCalculation: params.workbookCalculation ?? (params.sourceFormulaData && this.derivedSources.get(params.sourceFormulaData)) };
    const accepted = this.scalarResult(wrapped);
    params.cellValue = wrapped.unitData[params.unitId]?.[params.subUnitId] ?? {};
    return accepted;
  }
  pause(reason: string) { this.paused = reason; this.update(this.current, false); }
  status(sheet: string, row: number, column: number) { return this.statuses.get(key(sheet, row, column)); }
  summary() { return { pending: this.pending, paused: this.paused !== null, stored: [...this.statuses.values()].filter(status => status.result === 'stored').length, unavailable: [...this.statuses.values()].filter(status => status.result === 'unavailable').length }; }
  display(sheet: string, row: number, column: number, view: ICellData & { isInArrayFormulaRange?: boolean }, raw: ICellData | null | undefined): ICellData {
    // Real inputs take precedence over every derived/display overlay.
    if (authored(raw)) return { ...view, ...values(raw) };
    const coordinate = key(sheet, row, column), owner = this.sourceOwner.get(coordinate);
    if (owner && at(this.current, owner.sheetId, owner.row, owner.column)?.f === owner.formula && !this.conflicts.has(key(owner.sheetId, owner.row, owner.column))) return { ...view, ...values(at(this.original, sheet, row, column)) };
    if (owner && at(this.current, owner.sheetId, owner.row, owner.column)?.f === owner.formula && this.conflicts.has(key(owner.sheetId, owner.row, owner.column))) return { ...view, v: null, t: null, p: null };
    const status = this.statuses.get(coordinate);
    if (status?.result === 'stored') return { ...view, ...values(at(this.original, sheet, row, column)) };
    if (status?.result === 'pending') return { ...view, ...structuredClone(this.calculated.get(coordinate)!.value) };
    if (status?.result === 'unavailable' || view.isInArrayFormulaRange && status?.result !== 'calculated') return { ...view, v: null, t: null, p: null };
    return view;
  }
}
