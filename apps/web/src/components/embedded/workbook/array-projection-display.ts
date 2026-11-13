import { RTree, CellValueType, type ICellData, type IWorkbookData } from '@univerjs/core';
import { arrayProjectionSchema, type ArrayProjection } from './array-projection-message';
import { workbookCalculationInputSha256 } from './formula-input-provenance';
import type { WorkbookDocument } from '@open-design/contracts/runtime/workbook';

const key = (sheet: string, row: number, column: number) => JSON.stringify([sheet, row, column]);
const at = (book: IWorkbookData, sheet: string, row: number, column: number) => book.sheets[sheet]?.cellData?.[row]?.[column];
const values = (cell: ICellData | null | undefined) => ({ v: cell?.v ?? null, t: cell?.t ?? null, p: cell?.p ? structuredClone(cell.p) : null });
const cached = (cell: ICellData | null | undefined) => Boolean(cell && (cell.v != null || cell.p));
export type ArrayProjectionStatus = 'calculated' | 'stored' | 'pending' | 'unavailable';

/** Display-only authority. The raw workbook, writer baseline and undo history
 * never receive a derived follower, formula cache or metadata assertion. */
export class ArrayProjectionDisplay {
  private original: IWorkbookData;
  private current: IWorkbookData;
  private digest: string;
  private projection: ArrayProjection | null = null;
  private stored = new Set<string>();
  private unavailable = new Set<string>();
  private pending = false;
  private ownership = new RTree();
  private runtimeOwners = new Map<string, ArrayProjection['owners'][number]>();
  private sourceOwners = new Map<string, { row: number; column: number }>();
  constructor(model: WorkbookDocument, original: IWorkbookData, initial: IWorkbookData, private sourceSha256: string) {
    this.original = structuredClone(original); this.current = initial; this.digest = workbookCalculationInputSha256(initial);
    let area = 0;
    for (const sheet of model.sheets) for (const owner of sheet.arrayFormulas ?? []) {
      area += (owner.range.endRow - owner.range.startRow + 1) * (owner.range.endColumn - owner.range.startColumn + 1);
      if (area > 100_000) throw new Error('Source display ownership exceeds its budget.');
      for (let row = owner.range.startRow; row <= owner.range.endRow; row++) for (let column = owner.range.startColumn; column <= owner.range.endColumn; column++) this.sourceOwners.set(key(sheet.id, row, column), owner);
    }
  }
  update(current: IWorkbookData, pending: boolean) {
    const digest = workbookCalculationInputSha256(current);
    if (digest !== this.digest) { this.projection = null; this.stored.clear(); this.unavailable.clear(); }
    this.current = current; this.digest = digest; this.pending = pending;
  }
  pause() { this.pending = false; this.projection = null; this.stored.clear(); this.unavailable.clear(); }
  accept(raw: unknown): boolean {
    const parsed = arrayProjectionSchema.safeParse(raw); if (!parsed.success) return false;
    const result = parsed.data, tag = result.workbookCalculation;
    if (result.sourceSha256 !== this.sourceSha256 || !tag.valid || tag.unitId !== this.current.id || tag.inputSha256 !== this.digest) return false;
    for (const [sheet, rows] of Object.entries(result.cells)) for (const [row, columns] of Object.entries(rows)) for (const column of Object.keys(columns)) if (!this.current.sheets[sheet] || Number(row) >= (this.current.sheets[sheet]!.rowCount ?? 0) || Number(column) >= (this.current.sheets[sheet]!.columnCount ?? 0)) return false;
    for (const owner of result.owners) if (at(this.current, owner.sheetId, owner.row, owner.column)?.f !== owner.formula) return false;
    this.ownership.dispose(); this.ownership = new RTree(); this.runtimeOwners = new Map(result.owners.map(owner => [key(owner.sheetId, owner.row, owner.column), owner]));
    this.ownership.bulkInsert(result.owners.map(owner => ({ id: key(owner.sheetId, owner.row, owner.column), unitId: this.current.id, sheetId: owner.sheetId, range: owner.range })));
    this.projection = result; this.stored = new Set(result.stored); this.unavailable = new Set(result.unavailable); this.pending = false; return true;
  }
  /** Pending input edits retain prior proven ownership until a complete new
   * projection arrives. Replacing/removing the anchor retires that protection. */
  followerOwners(sheet: string, row: number, column: number) {
    const owners: { row: number; column: number; formula: string }[] = [];
    const source = this.sourceOwners.get(key(sheet, row, column));
    const formula = source ? at(this.original, sheet, source.row, source.column)?.f : undefined;
    if (source && formula && (!this.projection || this.stored.has(key(sheet, source.row, source.column)) || this.unavailable.has(key(sheet, source.row, source.column))) && (source.row !== row || source.column !== column) && at(this.current, sheet, source.row, source.column)?.f === formula) owners.push({ ...source, formula });
    for (const id of this.ownership.searchGenerator({ unitId: this.current.id, sheetId: sheet, range: { startRow: row, endRow: row, startColumn: column, endColumn: column } })) {
      const owner = this.runtimeOwners.get(String(id));
      if (owner && (owner.row !== row || owner.column !== column) && at(this.current, sheet, owner.row, owner.column)?.f === owner.formula) owners.push(owner);
    }
    return owners;
  }
  isFollower(sheet: string, row: number, column: number): boolean { return this.followerOwners(sheet, row, column).length > 0; }
  summary() {
    let stored = 0, unavailable = 0;
    for (const [sheetId, sheet] of Object.entries(this.current.sheets)) for (const [row, cells] of Object.entries(sheet.cellData ?? {})) for (const [column, cell] of Object.entries(cells ?? {})) if ((cell as ICellData | undefined)?.f) { const status = this.status(sheetId, Number(row), Number(column)); if (status === 'stored') stored++; if (status === 'unavailable') unavailable++; }
    return { pending: this.pending, paused: !this.projection && !this.pending, stored, unavailable };
  }
  dispose() { this.pause(); this.ownership.dispose(); this.runtimeOwners.clear(); }
  private source(sheet: string, row: number, column: number) {
    const cell = at(this.current, sheet, row, column), original = at(this.original, sheet, row, column);
    if (cell?.f) return original?.f === cell.f && cached(original) ? original : undefined;
    if (cell && (cell.v != null || cell.p)) return;
    const owner = this.sourceOwners.get(key(sheet, row, column));
    if (!owner || at(this.current, sheet, owner.row, owner.column)?.f !== at(this.original, sheet, owner.row, owner.column)?.f) return;
    // A complete calculated owner supersedes all source follower geometry.
    // Stored/unavailable owners retain source evidence; retired followers do not.
    const ownerId = key(sheet, owner.row, owner.column);
    if (this.projection && !this.stored.has(ownerId) && !this.unavailable.has(ownerId)) return;
    return original;
  }
  status(sheet: string, row: number, column: number): ArrayProjectionStatus | undefined {
    const id = key(sheet, row, column), raw = at(this.current, sheet, row, column), source = this.source(sheet, row, column);
    if (raw && !raw.f && (raw.v != null || raw.p)) return;
    const owner = this.sourceOwners.get(id), ownerId = owner ? key(sheet, owner.row, owner.column) : id;
    if (this.unavailable.has(id)) return 'unavailable';
    if (this.stored.has(id) || source && this.stored.has(ownerId)) return cached(source) ? 'stored' : 'unavailable';
    if (this.projection?.cells[sheet]?.[row]?.[column]) return 'calculated';
    if (this.pending && (raw?.f || source)) return 'pending';
    return cached(source) ? 'stored' : raw?.f ? 'unavailable' : undefined;
  }
  display(sheet: string, row: number, column: number, cell: ICellData): ICellData {
    const status = this.status(sheet, row, column), source = this.source(sheet, row, column);
    if (status === 'calculated') {
      const result = this.projection!.cells[sheet]![row]![column]!;
      const t = result.kind === 'number' ? CellValueType.NUMBER : result.kind === 'boolean' ? CellValueType.BOOLEAN : result.kind === 'error' ? CellValueType.STRING : result.kind === 'string' ? CellValueType.FORCE_STRING : null;
      return { ...cell, v: result.kind === 'boolean' ? Number(result.value) : result.value, t, p: null };
    }
    if (status === 'stored' || status === 'pending') return { ...cell, ...values(source) };
    if (status === 'unavailable') return { ...cell, v: null, t: null, p: null };
    return cell;
  }
}
