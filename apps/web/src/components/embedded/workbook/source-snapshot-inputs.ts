import type { ICellData, IWorkbookData } from '@univerjs/presets';
import { workbookCalculationInputSha256 } from './formula-input-provenance';
/** Exact authored-input ownership, with only checked ACK blank-window extents
 * normalized; result caches and style ordinals are separate authorities. */
export function assertWorkbookSourceSnapshotInputs(original: IWorkbookData, acknowledged: IWorkbookData, unitId: string) {
  const nextOriginal = structuredClone(original);
  if (original.id !== unitId || acknowledged.id !== unitId || JSON.stringify(original.sheetOrder) !== JSON.stringify(acknowledged.sheetOrder)) throw Error('The acknowledged workbook identity changed.');
  for (const [id, sheet] of Object.entries(nextOriginal.sheets)) {
    const ack = acknowledged.sheets[id];
    if (!ack || !Number.isSafeInteger(ack.rowCount) || !Number.isSafeInteger(ack.columnCount) || ack.rowCount! < 1 || ack.columnCount! < 1) throw Error('The acknowledged worksheet window is invalid.');
    for (const [row, cells] of Object.entries(sheet.cellData ?? {})) for (const [column, raw] of Object.entries(cells ?? {})) {
      const cell = raw as ICellData | null;
      if (cell && (cell.f || (cell.v !== undefined && cell.v !== null || Boolean(cell.p))) && (Number(row) >= ack.rowCount! || Number(column) >= ack.columnCount!)) throw Error('Source content lies outside the acknowledged window.');
    }
    sheet.rowCount = ack.rowCount; sheet.columnCount = ack.columnCount;
  }
  if (workbookCalculationInputSha256(nextOriginal) !== workbookCalculationInputSha256(acknowledged)) throw Error('Saved source inputs differ from the acknowledged snapshot.');
}
