import type { ICellData, IWorkbookData } from '@univerjs/presets';
import type { WorkbookArrayFormula, WorkbookDocument, WorkbookRange } from '@open-design/contracts/runtime/workbook';
import { gridWorkbook } from './grid-model';

type Matrix<T> = Record<number, Record<number, T>>;
export interface SourceArrayEngineData {
  arrayFormulaRange: Record<string, Record<string, Matrix<WorkbookRange>>>;
  arrayFormulaCellData: Record<string, Record<string, Matrix<Pick<ICellData, 'v' | 't'>>>>;
  arrayFormulaEmbedded: Record<string, never>;
}
export type SourceArraySeed = { state: 'unknown' | 'conflict' | 'limited'; reason: string } | {
  state: 'known'; data: SourceArrayEngineData; owners: number;
  /** Source t="array" alone does not prove legacy CSE vs dynamic semantics. */
  calculation: 'unverified' | 'not-applicable';
};
const same = (a: unknown, b: unknown) => (a ?? null) === (b ?? null);

/** Bootstrap ONLY explicit source ownership and genuine loaded caches through
 * Univer's existing array-data channel. This never rewrites raw cells, f strings
 * or references and never relaxes the engine's collision/value comparisons.
 *
 * Call before editing on the source-loaded snapshot. A changed cache is a
 * conflict, not permission to redefine that input as a derived array result.
 * This is not an assertion that array recalculation or saving is supported. */
export function sourceArrayEngineData(model: WorkbookDocument, loaded: IWorkbookData): SourceArraySeed {
  if (model.sheets.some(sheet => sheet.arrayFormulas === undefined)) return { state: 'unknown', reason: 'Source array ownership is unavailable from this workbook version.' };
  if (model.sheets.some(sheet => sheet.arrayFormulas!.some(array => array.kind === 'dataTable'))) return { state: 'limited', reason: 'Excel data table results cannot be live-calculated here.' };
  const expected = gridWorkbook(model, loaded.id, loaded.name).data;
  const data: SourceArrayEngineData = { arrayFormulaRange: { [loaded.id]: {} }, arrayFormulaCellData: { [loaded.id]: {} }, arrayFormulaEmbedded: {} };
  let owners = 0;
  for (const sheet of model.sheets) {
    const actual = loaded.sheets[sheet.id]?.cellData;
    if (!actual) return { state: 'conflict', reason: 'The source worksheet no longer matches its loaded snapshot.' };
    const expectedCells = expected.sheets![sheet.id]!.cellData!;
    const sourceCells = new Map(sheet.cells.map(cell => [`${cell.row}:${cell.column}`, cell]));
    const ownership = new Map<string, WorkbookArrayFormula>();
    const coordinates = new Set<string>();
    for (const matrix of [actual, expectedCells]) for (const [row, cells] of Object.entries(matrix)) for (const column of Object.keys(cells ?? {})) coordinates.add(`${row}:${column}`);
    const ranges: Matrix<WorkbookRange> = {}, caches: Matrix<Pick<ICellData, 'v' | 't'>> = {};
    for (const array of sheet.arrayFormulas!) {
      const wanted = expectedCells[array.row]?.[array.column], now = actual[array.row]?.[array.column];
      if (!wanted?.f || wanted.f !== now?.f) return { state: 'conflict', reason: 'The source array formula changed before its ownership was loaded.' };
      (ranges[array.row] ??= {})[array.column] = structuredClone(array.range); owners++;
      // gridWorkbook validated the total ownership area at <=100,000 cells.
      // Index only ownership here, never manufacture blank/zero cell values.
      for (let row = array.range.startRow; row <= array.range.endRow; row++) for (let column = array.range.startColumn; column <= array.range.endColumn; column++) ownership.set(`${row}:${column}`, array);
    }
    for (const position of coordinates) {
      const [row, column] = position.split(':').map(Number) as [number, number];
      const owner = ownership.get(position);
      if (!owner) continue;
      const wanted = expectedCells[row]?.[column], now = actual[row]?.[column];
      if (!same(wanted?.v, now?.v) || !same(wanted?.t, now?.t) || !same(wanted?.f, now?.f)) return { state: 'conflict', reason: 'A source array cell changed. Its current value has been kept.' };
      if (wanted?.f && (row !== owner.row || column !== owner.column)) return { state: 'limited', reason: 'Nested source formulas need a separate array ownership adapter.' };
      const source = sourceCells.get(position);
      if (source?.kind === 'error') return { state: 'limited', reason: 'Typed source array error caches need a separate calculation adapter.' };
      // A missing cached value must stay blank. Univer interprets an explicitly
      // empty overlay cell as zero, so never manufacture one for a source hole.
      if (wanted?.v !== undefined && wanted.v !== null) (caches[row] ??= {})[column] = { v: wanted.v, t: wanted.t };
    }
    data.arrayFormulaRange[loaded.id]![sheet.id] = ranges;
    data.arrayFormulaCellData[loaded.id]![sheet.id] = caches;
  }
  return { state: 'known', data, owners, calculation: owners ? 'unverified' : 'not-applicable' };
}

/** A separate interactive representation: proven source follower caches belong
 * in the array overlay, not in raw cells where Univer would treat them as
 * authored inputs. The loaded source document/snapshot stay byte/value intact.
 * Diff edits against interactiveSnapshot, never ignore coordinates globally:
 * a real input after array removal must still be saved as a real input. */
export function sourceArrayInteractiveSnapshot(model: WorkbookDocument, loaded: IWorkbookData) {
  const seed = sourceArrayEngineData(model, loaded);
  if (seed.state !== 'known') return seed;
  const interactiveSnapshot = structuredClone(loaded);
  for (const [sheetId, rows] of Object.entries(seed.data.arrayFormulaRange[loaded.id]!)) {
    const sheet = interactiveSnapshot.sheets[sheetId]!;
    for (const [ownerRow, columns] of Object.entries(rows)) for (const [ownerColumn, range] of Object.entries(columns)) {
      for (let row = range.startRow; row <= range.endRow; row++) for (let column = range.startColumn; column <= range.endColumn; column++) {
        if (row === Number(ownerRow) && column === Number(ownerColumn)) continue;
        const cell = sheet.cellData?.[row]?.[column];
        if (!cell) continue;
        if (cell.p) return { state: 'limited' as const, reason: 'Rich source array followers need a separate display adapter.' };
        // Only remove cache content at a verified owned follower. Styles remain
        // in raw cells; exact cached values remain in seed.data's overlay.
        delete cell.v; delete cell.t; delete cell.p;
        if (!Object.keys(cell).length) {
          delete sheet.cellData![row]![column];
          if (!Object.keys(sheet.cellData![row]!).length) delete sheet.cellData![row];
        }
      }
    }
  }
  return { ...seed, sourceSnapshot: structuredClone(loaded), interactiveSnapshot };
}
