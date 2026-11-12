import type { IWorkbookData, IWorksheetData } from '@univerjs/presets';

/** Open-view preference only: never carry cells, styles, formulas or hidden state
 * from an older source. The receiving sheet supplies authoritative field bounds. */
export function restoreCsvViewDimensions(sheet: Partial<IWorksheetData>, previous: IWorkbookData['sheets'][string]): void {
  for (const [property, size, count] of [['columnData', 'w', sheet.columnCount], ['rowData', 'h', sheet.rowCount]] as const) {
    const before = previous[property];
    if (!before || !Number.isSafeInteger(count) || count! < 1) continue;
    for (const [key, dimension] of Object.entries(before)) {
      if (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= count!) continue;
      const value = dimension?.[size];
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 1_000_000) continue;
      const target = sheet[property] ??= {};
      target[Number(key)] = { ...target[Number(key)], [size]: value };
    }
  }
}
