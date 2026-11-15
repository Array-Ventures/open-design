import { HorizontalAlign, type IStyleData, type IWorkbookData, type Worksheet } from '@univerjs/core';
import type { FWorkbook } from '@univerjs/sheets/facade';
import { workbookHorizontalAlignmentSchema, type WorkbookDocument, type WorkbookHorizontalAlignment, type WorkbookSourceHorizontalAlignment } from '@open-design/contracts/runtime/workbook';

export function gridHorizontalAlignment(value: unknown): WorkbookSourceHorizontalAlignment | null {
  if (value === HorizontalAlign.UNSPECIFIED) return 'general';
  if (value === HorizontalAlign.LEFT) return 'left';
  if (value === HorizontalAlign.CENTER) return 'center';
  if (value === HorizontalAlign.RIGHT) return 'right';
  if (value === HorizontalAlign.JUSTIFIED) return 'justify';
  if (value === HorizontalAlign.DISTRIBUTED) return 'distributed';
  return null;
}
export const gridHorizontalAlignmentValue: Record<WorkbookHorizontalAlignment, HorizontalAlign> = {
  general: HorizontalAlign.UNSPECIFIED, left: HorizontalAlign.LEFT,
  center: HorizontalAlign.CENTER, right: HorizontalAlign.RIGHT,
};
export type WorkbookSnapshotAlignment = (sheetId: string, row: number, column: number) => WorkbookSourceHorizontalAlignment | null;
/** Private live data consistency, never a file permission or serialized grant. */
export interface WorkbookAlignmentProvenance {
  live(sheet: Worksheet, row: number, column: number, checked: Map<IStyleData, boolean>): WorkbookHorizontalAlignment | null;
  readonly rowPriority: boolean;
  snapshot(snapshot: IWorkbookData): WorkbookSnapshotAlignment;
  dispose(): void;
}
type Origin = { style: IStyleData; signature: string; horizontal: WorkbookSourceHorizontalAlignment | undefined };
/** Capture source style IDs once against this kernel's actual objects. New ACK
 * reader ordinals and moved coordinates cannot rename these original owners. */
export function workbookAlignmentProvenance(book: FWorkbook, model: WorkbookDocument,
  expected: IWorkbookData['styles'], current: () => boolean = () => true, advanced = true, rowPriority = false): WorkbookAlignmentProvenance {
  const styles = book.getWorkbook().getStyles(), unitId = book.getId();
  const origins = new Map<string, Origin>();
  let active = true;
  model.styles.forEach((source, index) => {
    const id = String(index), style = styles.get(id), signature = JSON.stringify(expected[id]);
    if (style && JSON.stringify(style) === signature) {
      const horizontal = source.alignment?.horizontal;
      if (!advanced && horizontal && !workbookHorizontalAlignmentSchema.safeParse(horizontal).success) return;
      origins.set(id, { style, signature, horizontal });
    }
  });
  function resolve(owners: unknown[], values: IWorkbookData['styles'] | undefined, checked: Map<IStyleData, boolean>): WorkbookSourceHorizontalAlignment | null {
    if (!active || !current()) return null;
    let result: WorkbookSourceHorizontalAlignment | null = 'general';
    for (const owner of owners) {
      if (owner == null) continue;
      const live = typeof owner === 'string' ? styles.get(owner) : owner;
      const style = (typeof owner === 'string' && values ? values[owner] : live) as IStyleData | null | undefined;
      // A current explicit SDK value is an actual horizontal override.
      if (style?.ht !== undefined) { result = gridHorizontalAlignment(style.ht); continue; }
      const origin = typeof owner === 'string' ? origins.get(owner) : undefined;
      if (!origin || live !== origin.style || !style) { result = null; continue; }
      let unchanged = checked.get(style);
      if (unchanged === undefined) {
        unchanged = JSON.stringify(style) === origin.signature && JSON.stringify(live) === origin.signature;
        checked.set(style, unchanged);
      }
      if (!unchanged) { result = null; continue; }
      // A partial font-only style does not erase an earlier alignment owner.
      if (origin.horizontal !== undefined) result = origin.horizontal;
    }
    return result;
  }
  return {
    rowPriority,
    live(sheet, row, column, checked) {
      const cell = sheet.getCell(row, column);
      // Derived paint is not authored alignment provenance. Never let a theme
      // or interceptor make an unknown source alignment a proven no-op.
      if (cell?.themeStyle && Object.prototype.hasOwnProperty.call(cell.themeStyle, 'ht')
        || cell?.interceptorStyle && Object.prototype.hasOwnProperty.call(cell.interceptorStyle, 'ht')) return null;
      const rowStyle = sheet.getRowStyle(row, true), columnStyle = sheet.getColumnStyle(column, true);
      const result = resolve([sheet.getConfig().defaultStyle, ...(rowPriority ? [columnStyle, rowStyle] : [rowStyle, columnStyle]), cell?.s], undefined, checked);
      const parsed = workbookHorizontalAlignmentSchema.safeParse(result);
      return parsed.success ? parsed.data : null;
    },
    snapshot(snapshot) {
      const checked = new Map<IStyleData, boolean>();
      return (sheetId, row, column) => {
        if (snapshot.id !== unitId) return null;
        const sheet = snapshot.sheets[sheetId];
        if (!sheet) return null;
        const rowStyle = sheet.rowData?.[row]?.s, columnStyle = sheet.columnData?.[column]?.s;
        return resolve([sheet.defaultStyle, ...(rowPriority ? [columnStyle, rowStyle] : [rowStyle, columnStyle]), sheet.cellData?.[row]?.[column]?.s], snapshot.styles, checked);
      };
    },
    dispose() { active = false; origins.clear(); },
  };
}
