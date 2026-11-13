import { afterEach, expect, it } from 'vitest';
import { IUniverInstanceService, LocaleType, Univer, type IWorkbookData } from '@univerjs/core';
import { FUniver } from '@univerjs/core/facade';
import { UniverSheetsPlugin } from '@univerjs/sheets';
import '@univerjs/sheets/facade';
import English from '@univerjs/preset-sheets-core/locales/en-US';
import type { WorkbookDocument } from '@open-design/contracts/runtime/workbook';
import { gridWorkbook } from '../../src/components/embedded/workbook/grid-model';
import { workbookGridEdits } from '../../src/components/embedded/workbook/grid-edits';
import { ownWorkbookAxisIdentity, seedWorkbookStructureIdentity } from '../../src/components/embedded/workbook/grid-structure-identity';
import { WorkbookWriter } from '../../src/components/embedded/workbook/workbook-writer';
const sha = 'a'.repeat(64), closers: (() => void)[] = [];
afterEach(() => closers.splice(0).reverse().forEach(close => close()));
function model(): WorkbookDocument { return { version: 1, worksheetStructureEditable: true, date1904: false, activeSheetId: 'a', styles: [{}], features: { charts: 0, drawings: 0, externalLinks: 0, macros: false, signed: false }, sheets: [{ id: 'a', name: 'Data', visibility: 'visible', rowCount: 100, columnCount: 26, cells: [{ row: 1, column: 1, kind: 'number', value: 12 }], merges: [], rowDimensions: [], columnDimensions: [], frozenRows: 0, frozenColumns: 0 }] }; }
function fixture() {
  const source = model(), seed = seedWorkbookStructureIdentity(gridWorkbook(source, 'structure', 'Structure').data as IWorkbookData, sha);
  const univer = new Univer({ locale: LocaleType.EN_US, locales: { [LocaleType.EN_US]: English } }); closers.push(() => univer.dispose());
  let book: ReturnType<FUniver['createWorkbook']> | undefined;
  const owner = ownWorkbookAxisIdentity(univer, () => book?.save(), () => true); closers.push(() => owner.dispose());
  univer.registerPlugin(UniverSheetsPlugin); const api = FUniver.newAPI(univer); book = api.createWorkbook(seed); book.setEditable(true);
  univer.__getInjector().get(IUniverInstanceService).focusUnit(book.getId());
  return { source, book, api, sheet: book.getActiveSheet(), initial: book.save() };
}
it('derives structure-only plans from actual SDK movement instead of clearing and rewriting source cells', () => {
  const { source, book, initial, sheet } = fixture(); sheet.insertRowsBefore(1, 1); sheet.insertColumnsBefore(1, 1);
  const plan = workbookGridEdits(source, sha, initial, book.save());
  expect(plan.edits).toEqual([]); expect(plan.styles).toBeUndefined(); expect(plan.dimensions).toBeUndefined();
  expect(plan.structure).toHaveLength(1); expect(plan.structure![0]!.rows.slice(0, 4)).toEqual([0, null, 1, 2]); expect(plan.structure![0]!.columns.slice(0, 4)).toEqual([0, null, 1, 2]);
});
it('expresses additional cells in final coordinates and preserves ordinary older draft behavior', () => {
  const { source, book, initial, sheet } = fixture(); sheet.insertRowsBefore(1, 1); sheet.getRange(2, 1).setValue(24);
  const plan = workbookGridEdits(source, sha, initial, book.save());
  expect(plan.edits).toEqual([{ sheetId: 'a', cell: { row: 2, column: 1, kind: 'number', value: 24 } }]);
  const legacy = gridWorkbook(source, 'structure', 'Structure').data as IWorkbookData, changed = structuredClone(legacy); changed.sheets.a!.cellData![1]![1]!.v = 36;
  expect(workbookGridEdits(source, sha, legacy, changed).structure).toBeUndefined(); expect(workbookGridEdits(source, sha, legacy, changed).edits[0]!.cell.value).toBe(36);
});
it('journals and flushes structure-only changes and derives the next save relative to the acknowledged snapshot', async () => {
  const { source, book, initial, sheet } = fixture(); const writes: unknown[] = [], checkpoints: unknown[] = [];
  const writer = new WorkbookWriter({ model: source, sourceSha256: sha }, initial, async intent => {
    writes.push(structuredClone(intent.plan));
    const next = structuredClone(source); next.sheets[0]!.rowCount = 101; next.sheets[0]!.cells[0]!.row = 2; next.sheets[0]!.cells[0]!.value = intent.plan.edits[0]?.cell.value ?? 12;
    return { model: next, sourceSha256: (writes.length === 1 ? 'b' : 'c').repeat(64) };
  }, () => {}, undefined, { save: async value => { checkpoints.push(value); } });
  sheet.insertRowsBefore(1, 1); writer.update(book.save()); expect(writer.state().dirty).toBe(true); await writer.flush();
  expect(writes).toHaveLength(1); expect((writes[0] as { structure: unknown[] }).structure).toHaveLength(1); expect(checkpoints.some(Boolean)).toBe(true); expect(writer.state().dirty).toBe(false);
  sheet.getRange(2, 1).setValue(36); writer.update(book.save()); await writer.flush();
  expect(writes).toHaveLength(2); expect((writes[1] as { sourceSha256: string; structure?: unknown }).sourceSha256).toBe('b'.repeat(64)); expect((writes[1] as { structure?: unknown }).structure).toBeUndefined();
  await writer.close();
});

it('keeps acknowledged blank-axis metadata beyond the source reader window clean without admitting forged dimensions', () => {
  const { source, book, sheet } = fixture(); sheet.insertRowsBefore(1, 1); sheet.insertColumnsBefore(1, 1);
  const acknowledged = book.save(), refreshed = structuredClone(source);
  refreshed.sheets[0]!.cells[0]!.row = 2; refreshed.sheets[0]!.cells[0]!.column = 2;
  // The real reader derives 100x26 from materialized content even though the
  // acknowledged SDK still owns a 101x27 editor window with dense metadata.
  expect(refreshed.sheets[0]).toMatchObject({ rowCount: 100, columnCount: 26 });
  expect(acknowledged.sheets.a!.rowData![100]).toBeDefined();
  expect(acknowledged.sheets.a!.columnData![26]).toBeDefined();
  expect(workbookGridEdits(refreshed, 'b'.repeat(64), acknowledged, acknowledged)).toEqual({ sourceSha256: 'b'.repeat(64), edits: [] });
  expect(refreshed.sheets[0]).toMatchObject({ rowCount: 100, columnCount: 26 });
  const forged = structuredClone(acknowledged); forged.sheets.a!.rowData![100] = {};
  expect(() => workbookGridEdits(refreshed, 'b'.repeat(64), acknowledged, forged)).toThrow('identity');
  const oversized = structuredClone(acknowledged); oversized.sheets.a!.rowCount = 100_001;
  expect(() => workbookGridEdits(refreshed, 'b'.repeat(64), acknowledged, oversized)).toThrow('limit');
});

it('carries only needed ACK-owned tail formatting windows as identity projections while keeping clean ACKs empty', () => {
  const { source, book, sheet } = fixture(); sheet.insertRowsBefore(1, 1); sheet.insertColumnsBefore(1, 1);
  const acknowledged = book.save(), refreshed = structuredClone(source);
  refreshed.sheets[0]!.cells[0]!.row = 2; refreshed.sheets[0]!.cells[0]!.column = 2;
  const current = structuredClone(acknowledged);
  current.sheets.a!.rowData![100]!.h = 36;
  current.sheets.a!.columnData![26]!.w = 131;
  current.sheets.a!.cellData![100] = { 26: { s: { fs: 22.25 } } };
  const plan = workbookGridEdits(refreshed, 'b'.repeat(64), acknowledged, current);
  expect(plan.structure).toEqual([{ sheetId: 'a', sourceRows: 101, sourceColumns: 27, rows: Array.from({ length: 101 }, (_, index) => index), columns: Array.from({ length: 27 }, (_, index) => index) }]);
  expect(plan.dimensions).toContainEqual({ sheetId: 'a', axis: 'row', index: 100, size: 27 });
  expect(plan.dimensions).toContainEqual({ sheetId: 'a', axis: 'column', index: 26, size: 18 });
  expect(plan.styles).toEqual([{ sheetId: 'a', row: 100, column: 26, fontSize: 22.25 }]);
  expect(workbookGridEdits(refreshed, 'b'.repeat(64), acknowledged, acknowledged)).toEqual({ sourceSha256: 'b'.repeat(64), edits: [] });
  const inside = structuredClone(acknowledged); inside.sheets.a!.rowData![2]!.h = 36;
  expect(workbookGridEdits(refreshed, 'b'.repeat(64), acknowledged, inside).structure).toBeUndefined();
});

it('recognizes an admitted sheet-only plan as dirty without enabling a grid producer', async () => {
  const { workbookPlanHasChanges } = await import('../../src/components/embedded/workbook/grid-plan');
  expect(workbookPlanHasChanges({ sourceSha256: 'a'.repeat(64), edits: [] })).toBe(false);
  expect(workbookPlanHasChanges({ sourceSha256: 'a'.repeat(64), edits: [], sheets: [{ sheetId: '1', name: 'Renamed', origin: 'source' }] })).toBe(true);
});
