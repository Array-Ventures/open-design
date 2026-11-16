import { canonicalWorkbookJsonValue } from '@open-design/contracts/runtime/workbook-sheet-baseline';
import { z } from 'zod';
import { WORKBOOK_MODEL_LIMITS, workbookSourceHorizontalAlignmentSchema } from '@open-design/contracts/runtime/workbook';
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
export interface WorkbookAlignmentProjection {
  readonly rowPriority: boolean;
  snapshot(snapshot: IWorkbookData): WorkbookSnapshotAlignment;
}
export interface WorkbookAlignmentProvenance extends WorkbookAlignmentProjection {
  readonly data: WorkbookAlignmentData;
  live(sheet: Worksheet, row: number, column: number, checked: Map<IStyleData, boolean>): WorkbookHorizontalAlignment | null;
  dispose(): void;
}
type Origin = { style: IStyleData; signature: string; horizontal: WorkbookSourceHorizontalAlignment | undefined };
/** Capture source style IDs once against this kernel's actual objects. New ACK
 * reader ordinals and moved coordinates cannot rename these original owners. */
export function workbookAlignmentProvenance(book: FWorkbook, model: WorkbookDocument,
  expected: IWorkbookData['styles'], current: () => boolean = () => true, advanced = true, rowPriority = false): WorkbookAlignmentProvenance {
  const styles = book.getWorkbook().getStyles(), unitId = book.getId();
  const origins = new Map<string, Origin>();
  const data: WorkbookAlignmentData = { version: 1, unitId, rowPriority, styles: [] };
  let active = true;
  model.styles.forEach((source, index) => {
    const id = String(index), style = styles.get(id), signature = JSON.stringify(expected[id]);
    if (style && JSON.stringify(style) === signature) {
      const horizontal = source.alignment?.horizontal;
      if (!advanced && horizontal && !workbookHorizontalAlignmentSchema.safeParse(horizontal).success) return;
      origins.set(id, { style, signature, horizontal });
      data.styles.push({ id, definition: JSON.parse(canonicalWorkbookJsonValue(style)), ...(horizontal === undefined ? {} : { horizontal }) });
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
    get data() { return structuredClone(data); },
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


/** Authored presentation data, not a source authenticity or native-history grant.
 * Both Fill and Center Across Selection omit native HT; self-consistent edited
 * data remains subject to the ordinary authenticated source-save boundary. */
export const workbookAlignmentDataSchema = z.object({
  version: z.literal(1), unitId: z.string().min(1).max(600), rowPriority: z.boolean(),
  styles: z.array(z.object({ id: z.string().regex(/^(0|[1-9][0-9]{0,4})$/).refine(id => Number(id) < WORKBOOK_MODEL_LIMITS.styles), definition: z.record(z.unknown()), horizontal: workbookSourceHorizontalAlignmentSchema.optional() }).strict()).max(WORKBOOK_MODEL_LIMITS.styles),
}).strict().refine(data => new Set(data.styles.map(style => style.id)).size === data.styles.length, 'Duplicate alignment style ID.').superRefine((data, context) => {
  try { canonicalWorkbookJsonValue(data); } catch { context.addIssue({ code: 'custom', message: 'Alignment data exceeds the bounded JSON domain.' }); }
});
export type WorkbookAlignmentData = z.infer<typeof workbookAlignmentDataSchema>;
export function workbookAlignmentDataProjection(raw: WorkbookAlignmentData): WorkbookAlignmentProjection {
  canonicalWorkbookJsonValue(raw);
  const data = workbookAlignmentDataSchema.parse(raw);
  const styles = new Map(data.styles.map(entry => [entry.id, {
    definition: canonicalWorkbookJsonValue(entry.definition),
    horizontal: entry.horizontal,
  }]));
  return {
    rowPriority: data.rowPriority,
    snapshot(snapshot) {
      if (snapshot.id !== data.unitId) throw Error('The alignment data belongs to another workbook.');
      for (const [id, entry] of styles) {
        if (!Object.hasOwn(snapshot.styles, id) || canonicalWorkbookJsonValue(snapshot.styles[id]) !== entry.definition) throw Error('The alignment style definition changed.');
      }
      return (sheetId, row, column) => {
        const sheet = snapshot.sheets[sheetId];
        if (!sheet) return null;
        const rowStyle = sheet.rowData?.[row]?.s, columnStyle = sheet.columnData?.[column]?.s;
        const owners = [sheet.defaultStyle, ...(data.rowPriority ? [columnStyle, rowStyle] : [rowStyle, columnStyle]), sheet.cellData?.[row]?.[column]?.s];
        let result: WorkbookSourceHorizontalAlignment | null = 'general';
        for (const owner of owners) {
          if (owner == null) continue;
          const definition = typeof owner === 'string' ? snapshot.styles[owner] : owner;
          if (definition?.ht !== undefined) { result = gridHorizontalAlignment(definition.ht); continue; }
          const entry = typeof owner === 'string' ? styles.get(owner) : undefined;
          if (!entry || !definition || typeof owner !== 'string') { result = null; continue; }
          if (entry.horizontal !== undefined) result = entry.horizontal;
        }
        return result;
      };
    },
  };
}
