import type { WorkbookDocument } from '@open-design/contracts/runtime/workbook';
import { WorkbookFormatError } from './package.js';

const MAX_FIELDS = 1_000_000;
const MAX_BYTES = 50 * 1024 * 1024;

/** Saved raw scalar values, not display formatting or freshly calculated results.
 * A missing formula cache is an error, never a silently invented empty value. */
export function selectedWorksheetCsv(model: WorkbookDocument, sheetId: string): Buffer {
  const sheet = model.sheets.find(sheet => sheet.id === sheetId);
  if (!sheet || sheet.visibility !== 'visible') throw new WorkbookFormatError('The selected visible worksheet is unavailable.');
  const values = new Map<string, string>();
  let rows = 0, columns = 0;
  for (const cell of sheet.cells) {
    if (cell.formula && cell.kind === 'blank') throw new WorkbookFormatError('A formula in this worksheet has no saved result. Save a calculated workbook before exporting CSV.', 'WORKBOOK_UNSUPPORTED');
    if (cell.kind === 'blank') continue;
    const value = cell.kind === 'boolean' ? cell.value ? 'TRUE' : 'FALSE' : String(cell.value);
    values.set(`${cell.row}:${cell.column}`, value);
    rows = Math.max(rows, cell.row + 1); columns = Math.max(columns, cell.column + 1);
  }
  if (rows * columns > MAX_FIELDS) throw new WorkbookFormatError('The selected worksheet exceeds the CSV field limit.', 'WORKBOOK_LIMIT');
  const output: string[] = []; let bytes = 0;
  for (let row = 0; row < rows; row++) {
    const fields: string[] = [];
    for (let column = 0; column < columns; column++) {
      const value = values.get(`${row}:${column}`) ?? '';
      fields.push(/[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
    }
    const line = `${fields.join(',')}\r\n`;
    bytes += Buffer.byteLength(line);
    if (bytes > MAX_BYTES) throw new WorkbookFormatError('The selected worksheet exceeds the CSV byte limit.', 'WORKBOOK_LIMIT');
    output.push(line);
  }
  return Buffer.from(output.join(''), 'utf8');
}
