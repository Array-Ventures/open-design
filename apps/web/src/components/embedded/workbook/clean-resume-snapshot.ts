import type { ICellData, IWorkbookData } from '@univerjs/core';
import { workbookSheetCommandSha256 } from './sheet-calculation-permit';

/** Formula caches are derived presentation, not authored inputs. Everything
 * else, including formula identities, rich text and view/custom data, remains
 * in this full-snapshot comparison. The live owner separately proves its
 * unchanged input epoch and qualified, fully applied calculation state. */
export function workbookCleanResumeSnapshotIdentity(book: IWorkbookData): string {
  const sheets = Object.fromEntries(Object.entries(book.sheets).map(([id, sheet]) => [id, {
    ...sheet,
    cellData: sheet.cellData && Object.fromEntries(Object.entries(sheet.cellData).map(([row, cells]) => [row,
      Object.fromEntries(Object.entries(cells as Record<string, ICellData | null>).map(([column, cell]) => {
        if (!cell?.f) return [column, cell];
        const { v: _value, t: _type, ...authored } = cell;
        return [column, authored];
      })),
    ])),
  }]));
  return workbookSheetCommandSha256({ id: 'studio.workbook.clean-resume-snapshot', params: { snapshot: { ...book, sheets } } });
}
