import type { FUniver } from '@univerjs/presets';
import { z } from 'zod';
import { SetHorizontalTextAlignCommand } from '@univerjs/sheets';
import { workbookHorizontalAlignmentSchema, type WorkbookHorizontalAlignment } from '@open-design/contracts/runtime/workbook';
import { gridHorizontalAlignmentValue, type WorkbookAlignmentProvenance } from './grid-horizontal-alignment';

export interface WorkbookFormatScope { projectId: string; controllerId: string; blocked: boolean; saving?: boolean }
const color = z.string().regex(/^#[a-fA-F0-9]{6}$/);
export const workbookFormatActionSchema = z.discriminatedUnion('property', [
  z.object({ property: z.literal('horizontalAlignment'), value: workbookHorizontalAlignmentSchema }).strict(),
  z.object({ property: z.literal('bold'), value: z.boolean() }).strict(),
  z.object({ property: z.literal('italic'), value: z.boolean() }).strict(),
  z.object({ property: z.literal('fontSize'), value: z.number().positive().max(512) }).strict(),
  z.object({ property: z.literal('fontColor'), value: color.nullable() }).strict(),
  z.object({ property: z.literal('fillColor'), value: color.nullable() }).strict(),
]);
const requestSchema = z.object({ type: z.literal('studio:workbook-format'), projectId: z.string().uuid(), controllerId: z.string().uuid(), selectionKey: z.string().max(200), action: workbookFormatActionSchema }).strict();
export type WorkbookFormatAction = z.infer<typeof workbookFormatActionSchema>;
/** Use the real pinned facade commands, so style edits enter normal undo/history
 * and snapshot notifications. A stale selection request never targets a new one. */
export function workbookFormattingBridge(api: FUniver, scope: () => WorkbookFormatScope | undefined, origins?: WorkbookAlignmentProvenance) {
  const ownedBook = api.getActiveWorkbook();
  const ownerId = ownedBook?.getId();
  let error: string | null = null;
  let active = true;
  function selected() {
    const book = api.getActiveWorkbook(), sheet = book?.getActiveSheet(), selected = sheet?.getSelection()?.getActiveRange();
    if (!sheet || !selected || book?.getId() !== ownerId || !book?.getWorkbookPermission().canEdit()) return null;
    const range = selected.getRange(), cells = (range.endRow - range.startRow + 1) * (range.endColumn - range.startColumn + 1);
    if (!Number.isSafeInteger(cells) || cells <= 0 || cells > 100_000
      || ![range.startRow, range.startColumn, range.endRow, range.endColumn].every(Number.isSafeInteger)
      || range.startRow < 0 || range.startColumn < 0 || range.endRow < range.startRow || range.endColumn < range.startColumn || range.endRow >= sheet.getMaxRows() || range.endColumn >= sheet.getMaxColumns()) return null;
    const data = selected.getCellDatas();
    const checked = new Map<import('@univerjs/core').IStyleData, boolean>();
    let horizontalAlignment: WorkbookHorizontalAlignment | null | undefined;
    // Blank cells still inherit row/column/default alignment. The facade's
    // alignment getter conflates unsupported alignments with automatic.
    for (let row = range.startRow; row <= range.endRow; row++) for (let column = range.startColumn; column <= range.endColumn; column++) {
      // Keep scanning rich cells even after alignment has become mixed.
      if (data[row - range.startRow]?.[column - range.startColumn]?.p) return null;
      if (horizontalAlignment === null) continue;
      const alignment = origins?.live(sheet.getSheet(), row, column, checked) ?? null;
      horizontalAlignment = horizontalAlignment === undefined || horizontalAlignment === alignment ? alignment : null;
    }
    return { selected, range, horizontalAlignment: horizontalAlignment ?? null, unitId: book.getId(), sheetId: sheet.getSheetId(), selectionKey: `${sheet.getSheetId()}:${range.startRow}:${range.startColumn}:${range.endRow}:${range.endColumn}` };
  }
  function publish() {
    if (!active) return;
    const current = scope(); if (!current) return;
    const range = selected(), style = range?.selected.getCellStyleData();
    window.parent.postMessage({ type: 'studio:workbook-format-state', projectId: current.projectId, controllerId: current.controllerId,
      selected: Boolean(range && !current.blocked && !current.saving), selectionKey: range?.selectionKey ?? '', bold: style?.bl === 1, italic: style?.it === 1,
      horizontalAlignment: range?.horizontalAlignment ?? null,
      fontSize: typeof style?.fs === 'number' && style.fs > 0 && style.fs <= 512 ? style.fs : null,
      fontColor: typeof style?.cl?.rgb === 'string' && color.safeParse(style.cl.rgb).success ? style.cl.rgb : null,
      fillColor: typeof style?.bg?.rgb === 'string' && color.safeParse(style.bg.rgb).success ? style.bg.rgb : null, error }, window.location.origin);
  }
  const receive = (event: MessageEvent) => {
    if (!active || event.source !== window.parent || event.origin !== window.location.origin) return;
    const current = scope(); if (!current || current.blocked || current.saving) return;
    if (event.data?.type === 'studio:artifact-request' && event.data.projectId === current.projectId) { publish(); return; }
    const parsed = requestSchema.safeParse(event.data); if (!parsed.success || parsed.data.projectId !== current.projectId || parsed.data.controllerId !== current.controllerId) return;
    const range = selected(); if (!range || range.selectionKey !== parsed.data.selectionKey) { error = 'Select the workbook cells again before formatting.'; publish(); return; }
    try {
      const action = parsed.data.action;
      if (action.property === 'horizontalAlignment') {
        if (range.horizontalAlignment !== action.value && !api.syncExecuteCommand(SetHorizontalTextAlignCommand.id, { unitId: range.unitId, subUnitId: range.sheetId, range: range.range, value: gridHorizontalAlignmentValue[action.value] })) throw Error('Alignment command refused.');
      }
      else if (action.property === 'bold') range.selected.setFontWeight(action.value ? 'bold' : 'normal');
      else if (action.property === 'italic') range.selected.setFontStyle(action.value ? 'italic' : 'normal');
      else if (action.property === 'fontSize') range.selected.setFontSize(action.value);
      else if (action.property === 'fontColor') range.selected.setFontColor(action.value ?? 'rgb(0, 0, 0)');
      // Null removes an override and revives inherited fill. Transparent paint
      // is the pinned renderer's no-fill override; the sparse delta maps it to
      // patternType=none, never a white authored fill.
      else range.selected.setBackgroundColor(action.value ?? 'rgba(0,0,0,0)');
      error = null;
    } catch { error = 'This selection could not be formatted. Your workbook is still open.'; }
    publish();
  };
  window.addEventListener('message', receive);
  const selection = ownedBook?.onSelectionChange(() => { error = null; publish(); });
  publish();
  return { publish, dispose: () => { if (!active) return; active = false; selection?.dispose(); window.removeEventListener('message', receive); } };
}
