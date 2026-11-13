import type { IWorkbookData } from '@univerjs/presets';
import type { ISetArrayFormulaDataMutationParams } from '@univerjs/preset-sheets-core';
import { WORKBOOK_MODEL_LIMITS, type WorkbookRange } from '@open-design/contracts/runtime/workbook';
import type { WorkbookFormulaPolicy } from './formula-result-policy';
import type { SourceArrayEngineData } from './source-array-engine-data';

export type ArrayDisplayData = Pick<ISetArrayFormulaDataMutationParams, 'arrayFormulaRange' | 'arrayFormulaCellData'> & Partial<Pick<ISetArrayFormulaDataMutationParams, 'arrayFormulaEmbedded'>>;
export interface LimitedArrayDisplayState { sheetId: string; row: number; column: number; result: 'stored' | 'unavailable' | 'conflict' }
const inside = (range: WorkbookRange, row: number, column: number) => row >= range.startRow && row <= range.endRow && column >= range.startColumn && column <= range.endColumn;
const overlaps = (a: WorkbookRange, b: WorkbookRange) => a.startRow <= b.endRow && a.endRow >= b.startRow && a.startColumn <= b.endColumn && a.endColumn >= b.startColumn;
const cellAt = (book: IWorkbookData, sheet: string, row: number, column: number) => book.sheets[sheet]?.cellData?.[row]?.[column];
const valueIdentity = (cell: ReturnType<typeof cellAt>) => JSON.stringify([cell?.v ?? null, cell?.t ?? null, cell?.f ?? null, cell?.p ?? null]);

/** Select genuine stored array output for a limited source branch. This is a
 * post-calculation DISPLAY projection, not successful recalculation. Buffer the
 * array mutation until its matching graph/current formula identity is known.
 *
 * Do not publish returned data when publishable=false: an actual changed input,
 * overlapping result or unsupported embedded mode needs explicit resolution.
 * Neither source/current snapshots nor calculation inputs are ever modified. */
export function limitedSourceArrayDisplay(source: IWorkbookData, interactiveInitial: IWorkbookData, current: IWorkbookData,
  originalArrays: SourceArrayEngineData, calculated: ArrayDisplayData, policy: WorkbookFormulaPolicy) {
  if (source.id !== current.id || source.id !== interactiveInitial.id || source.id !== policy.unitId) throw Error('Limited array display belongs to another workbook.');
  const data = structuredClone(calculated), states: LimitedArrayDisplayState[] = [];
  const limits = new Map(policy.limited.map(cell => [JSON.stringify([cell.sheetId, cell.row, cell.column]), cell]));
  let publishable = true, ownedArea = 0;
  for (const [sheetId, owners] of Object.entries(originalArrays.arrayFormulaRange[source.id] ?? {})) for (const [rawRow, columns] of Object.entries(owners)) for (const [rawColumn, range] of Object.entries(columns)) {
    const row = Number(rawRow), column = Number(rawColumn);
    const limited = limits.get(JSON.stringify([sheetId, row, column]));
    if (!limited) continue;
    const state: LimitedArrayDisplayState = { sheetId, row, column, result: 'unavailable' }; states.push(state);
    const area = (range.endRow - range.startRow + 1) * (range.endColumn - range.startColumn + 1);
    if (!Number.isSafeInteger(area) || area < 1 || area > WORKBOOK_MODEL_LIMITS.cells - ownedArea) { state.result = 'conflict'; publishable = false; continue; }
    ownedArea += area;
    const original = cellAt(source, sheetId, row, column), now = cellAt(current, sheetId, row, column);
    if (!original?.f || original.f !== now?.f || limited.formula !== now.f) continue;
    let conflict = Boolean(data.arrayFormulaEmbedded?.[source.id]?.[sheetId]?.[row]?.[column]);
    for (let r = range.startRow; r <= range.endRow; r++) for (let c = range.startColumn; c <= range.endColumn; c++) {
      if (r !== row || c !== column) conflict ||= valueIdentity(cellAt(current, sheetId, r, c)) !== valueIdentity(cellAt(interactiveInitial, sheetId, r, c));
    }
    const ranges = data.arrayFormulaRange[source.id]?.[sheetId] ?? {};
    for (const [otherRow, cells] of Object.entries(ranges)) for (const otherColumn of Object.keys(cells ?? {})) {
      const other = ranges[Number(otherRow)]?.[Number(otherColumn)];
      if (other && (Number(otherRow) !== row || Number(otherColumn) !== column) && overlaps(range, other)) conflict = true;
    }
    const previous = ranges[row]?.[column];
    if (previous && (previous.endRow - previous.startRow + 1) * (previous.endColumn - previous.startColumn + 1) > WORKBOOK_MODEL_LIMITS.cells) conflict = true;
    if (conflict) { state.result = 'conflict'; publishable = false; continue; }
    const sourceCache = originalArrays.arrayFormulaCellData[source.id]?.[sheetId] ?? {};
    let stored = 0;
    for (let r = range.startRow; r <= range.endRow; r++) for (let c = range.startColumn; c <= range.endColumn; c++) { const cell = sourceCache[r]?.[c]; if (cell?.v !== undefined && cell.v !== null) stored++; }
    if (!stored) continue;
    const unit = data.arrayFormulaCellData[source.id] ??= {}, target = unit[sheetId] ??= {};
    // Remove only output belonging to this same array owner. Never clear raw
    // cells or output of an overlapping owner to make a result appear valid.
    for (const [r, cells] of Object.entries(target)) for (const c of Object.keys(cells ?? {})) {
      if (inside(range, Number(r), Number(c)) || previous && inside(previous, Number(r), Number(c))) delete target[Number(r)]![Number(c)];
    }
    for (let r = range.startRow; r <= range.endRow; r++) for (let c = range.startColumn; c <= range.endColumn; c++) { const cell = sourceCache[r]?.[c]; if (cell) (target[r] ??= {})[c] = structuredClone(cell); }
    const rangeUnit = data.arrayFormulaRange[source.id] ??= {}, rangeSheet = rangeUnit[sheetId] ??= {};
    (rangeSheet[row] ??= {})[column] = structuredClone(range);
    state.result = 'stored';
  }
  return { data, states, publishable };
}
