import { CellValueType, type ICellData, type IWorkbookData } from '@univerjs/presets';
import { ERROR_TYPE_SET, type ErrorType } from '@univerjs/engine-formula';
import { workbookCalculationInputSha256 } from './formula-input-provenance';
/** Exact authored-input ownership, allowing checked ACK blank-window extents
 * and the reader's plain-string representation. Calculation hashes, result
 * caches, rich content and style ordinals retain their separate authorities. */
export function assertWorkbookSourceSnapshotInputs(original: IWorkbookData, acknowledged: IWorkbookData, unitId: string) {
  const nextOriginal = structuredClone(original);
  if (original.id !== unitId || acknowledged.id !== unitId || JSON.stringify(original.sheetOrder) !== JSON.stringify(acknowledged.sheetOrder)) throw Error('The acknowledged workbook identity changed.');
  for (const [id, sheet] of Object.entries(nextOriginal.sheets)) {
    const ack = acknowledged.sheets[id];
    if (!ack || !Number.isSafeInteger(ack.rowCount) || !Number.isSafeInteger(ack.columnCount) || ack.rowCount! < 1 || ack.columnCount! < 1) throw Error('The acknowledged worksheet window is invalid.');
    for (const [row, cells] of Object.entries(sheet.cellData ?? {})) for (const [column, raw] of Object.entries(cells ?? {})) {
      const cell = raw as ICellData | null;
      if (cell && (cell.f || (cell.v !== undefined && cell.v !== null || Boolean(cell.p))) && (Number(row) >= ack.rowCount! || Number(column) >= ack.columnCount!)) throw Error('Source content lies outside the acknowledged window.');
      const saved = ack.cellData?.[Number(row)]?.[Number(column)];
      // The XLSX reader intentionally imports literals as FORCE_STRING; normal
      // SDK typing produces STRING. For plain non-error text these have the
      // same pinned formula-engine value. Error tokens are NOT equivalent:
      // STRING promotes them to errors while FORCE_STRING keeps them literal.
      // Do not alter the live snapshot, global input digest, or rich documents.
      if (cell?.t === CellValueType.FORCE_STRING && saved?.t === CellValueType.STRING
        && typeof cell.v === 'string' && cell.v === saved.v && !cell.f && !saved.f
        && !cell.p && !saved.p && !ERROR_TYPE_SET.has(cell.v as ErrorType)) cell.t = CellValueType.STRING;
    }
    sheet.rowCount = ack.rowCount; sheet.columnCount = ack.columnCount;
  }
  if (workbookCalculationInputSha256(nextOriginal) !== workbookCalculationInputSha256(acknowledged)) throw Error('Saved source inputs differ from the acknowledged snapshot.');
}
