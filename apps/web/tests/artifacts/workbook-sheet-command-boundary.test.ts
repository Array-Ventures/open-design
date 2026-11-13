import { afterEach, expect, it } from 'vitest';
import { Univer, LocaleType, ICommandService, IUniverInstanceService, IConfigService, type IWorkbookData } from '@univerjs/core';
import { UniverSheetsPlugin, InsertSheetCommand, RemoveSheetCommand } from '@univerjs/sheets';
import { FUniver } from '@univerjs/core/facade';
import '@univerjs/sheets/facade';
import SheetsEnUS from '@univerjs/sheets/locale/en-US';

const closing: (() => void)[] = [];
afterEach(() => { for (const close of closing.splice(0)) close(); });
function fixture(ids = ['1', '2', '3'], threshold?: number, large = false) {
  const univer = new Univer({ locale: LocaleType.EN_US, locales: { [LocaleType.EN_US]: SheetsEnUS } }); closing.push(() => univer.dispose());
  univer.registerPlugin(UniverSheetsPlugin, threshold === undefined ? {} : { largeSheetOperation: { largeSheetCellCountThreshold: threshold } });
  const api = FUniver.newAPI(univer);
  const sheet = (id: string) => ({ id, name: `Sheet ${id}`, rowCount: large && id === '2' ? 6001 : 100, columnCount: large && id === '2' ? 1 : 26,
    cellData: large && id === '2' ? Object.fromEntries(Array.from({ length: 6001 }, (_, row) => [row, Object.fromEntries(Array.from({ length: 1 }, (_, column) => [column, { v: 12, t: 2 }]))])) : { 0: { 0: { v: id === '2' ? 12 : 10, t: 2 } } },
    ...(id === '2' && !large ? { mergeData: [{ startRow: 3, endRow: 4, startColumn: 3, endColumn: 4 }], rowData: { 1: { h: 33 } } } : {}) });
  const book = api.createWorkbook({ id: 'sheet-chronology', name: 'Chronology', sheetOrder: ids, styles: {}, sheets: Object.fromEntries(ids.map(id => [id, sheet(id)])) });
  univer.__getInjector().get(IUniverInstanceService).focusUnit(book.getId());
  return { api, book, configuration: univer.__getInjector().get(IConfigService), commands: univer.__getInjector().get(ICommandService) };
}

it('captures deletion undo without reverting the earlier unrelated-sheet edit', async () => {
  const { api, book, commands } = fixture();
  const before = book.save();
  book.getSheetBySheetId('3')!.getRange('A1').setValue(20); // BEFORE delete, hence below it on the real undo stack
  expect(commands.syncExecuteCommand(RemoveSheetCommand.id, { unitId: book.getId(), subUnitId: '2' })).toBe(true);
  const acknowledged = book.save(); // SDK snapshot only: real writer ACK integration remains a separate gate
  expect(acknowledged.sheetOrder).toEqual(['1', '3']);
  expect(acknowledged.sheets['3']!.cellData![0]![0]!.v).toBe(20);
  await api.undo();
  const restored = book.save();
  expect(restored.sheetOrder).toEqual(['1', '2', '3']);
  expect(restored.sheets['2']).toMatchObject({ id: '2', cellData: { 0: { 0: { v: 12 } } }, rowData: { 1: { h: 33 } }, mergeData: before.sheets['2']!.mergeData });
  expect(restored.sheets['3']!.cellData![0]![0]!.v).toBe(20);
  expect(before.sheets['3']!.cellData![0]![0]!.v).toBe(10); // whole-file restore would be wrong
});

it('proves original add redo retains its initial blank config rather than later live edits', async () => {
  const { api, book, commands } = fixture(['1']);
  const birth = { id: '2', name: 'Born', rowCount: 100, columnCount: 26, cellData: {}, custom: { birth: 'immutable-test-birth' } };
  expect(commands.syncExecuteCommand(InsertSheetCommand.id, { unitId: book.getId(), index: 1, sheet: birth })).toBe(true);
  book.getSheetBySheetId('2')!.getRange('A1').setValue(17);
  const savedSnapshot = book.save(); expect(savedSnapshot.sheets['2']!.cellData![0]![0]!.v).toBe(17);
  await api.undo(); // undo edit BEFORE undoing add; no selective jump
  await api.undo();
  const deletedSnapshot = book.save(); expect(deletedSnapshot.sheetOrder).toEqual(['1']);
  await api.redo();
  const restored = book.save();
  expect(restored.sheetOrder).toEqual(['1', '2']);
  expect(restored.sheets['2']).toMatchObject({ id: '2', name: 'Born', rowCount: 100, columnCount: 26, custom: birth.custom });
  expect(restored.sheets['2']!.cellData?.[0]?.[0]?.v ?? null).toBeNull();
  await api.redo(); expect(book.save().sheets['2']!.cellData![0]![0]!.v).toBe(17);
});

// Generic SDK behavior only: the current qualified XLSX reader's 26-column
// floor plus 100k area cap excludes a persisted 6001-row source. No production
// plugin override is enabled or justified by this probe.
it.each([undefined, 100_001])('proves the pinned deletion threshold counts matrix rows, with real undo behavior (threshold=%s)', async threshold => {
  const { api, book, commands, configuration } = fixture(['1', '2', '3'], threshold, true);
  let rows = 0; book.getSheetBySheetId('2')!.getSheet().getCellMatrix().forEach(() => { rows++; });
  expect(rows).toBe(6001);
  expect(configuration.getConfig('sheets.config')).toEqual(threshold === undefined ? {} : { largeSheetOperation: { largeSheetCellCountThreshold: threshold } });
  book.getSheetBySheetId('3')!.getRange('A1').setValue(20);
  expect(commands.syncExecuteCommand(RemoveSheetCommand.id, { unitId: book.getId(), subUnitId: '2' })).toBe(true);
  await api.undo();
  const snapshot: IWorkbookData = book.save();
  expect(snapshot.sheetOrder).toEqual(threshold === undefined ? ['1', '3'] : ['1', '2', '3']);
  expect(snapshot.sheets['3']!.cellData![0]![0]!.v).toBe(20);
  if (threshold !== undefined) {
    expect(Object.keys(snapshot.sheets['2']!.cellData!)).toHaveLength(6001);
    await api.undo(); expect(book.save().sheets['3']!.cellData![0]![0]!.v).toBe(10);
  }
});
