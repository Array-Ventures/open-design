import { blankWorkbookSheet } from '../../src/components/embedded/workbook/sheet-birth-context';
import type { WorkbookCheckpoint, WorkbookWriteIntent } from '../../src/components/embedded/workbook/workbook-writer';
import { sourceDeleteScope } from './workbook-source-delete-fixture';
import { standInWorkbookResult } from './workbook-birth-transport';

/** Checked stand-in scalar preview/receipt for native-owner tests only. It is
 * not an XLSX reader, worker, transport authorization or style/axis converter. */
export function membershipResult(initial: WorkbookCheckpoint['source'], intent: WorkbookWriteIntent, hash: string) {
  if (intent.plan.structure?.length || intent.plan.styles?.length || intent.plan.dimensions?.length || intent.plan.visibility?.length) throw Error('This stand-in only models scalar value/name membership results.');
  const target = structuredClone(initial);
  target.sourceSha256 = hash;
  if (intent.plan.sheets) target.model.sheets = intent.plan.sheets.map(projection => {
    const source = initial.model.sheets.find(sheet => sheet.id === projection.sheetId);
    const sheet = source ? structuredClone(source) : blankWorkbookSheet(projection.sheetId, projection.name);
    sheet.name = projection.name;
    return sheet;
  });
  for (const edit of intent.plan.edits) {
    const sheet = target.model.sheets.find(value => value.id === edit.sheetId);
    if (!sheet) throw Error('The stand-in edit target is absent.');
    sheet.cells = sheet.cells.filter(cell => cell.row !== edit.cell.row || cell.column !== edit.cell.column);
    sheet.cells.push(structuredClone(edit.cell));
  }
  return standInWorkbookResult(sourceDeleteScope, intent, target, `version-${intent.plan.sourceSha256[0]}`, `version-${hash[0]}`);
}
