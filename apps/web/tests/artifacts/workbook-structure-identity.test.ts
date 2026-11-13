import { afterEach, expect, it } from 'vitest';
import { IUniverInstanceService, LocaleType, Univer, type IWorkbookData } from '@univerjs/core';
import { FUniver } from '@univerjs/core/facade';
import { UniverSheetsPlugin } from '@univerjs/sheets';
import '@univerjs/sheets/facade';
import English from '@univerjs/preset-sheets-core/locales/en-US';
import { gridStructureIdentity, seedWorkbookStructureIdentity } from '../../src/components/embedded/workbook/grid-structure-identity';
const sha = 'a'.repeat(64), closers: (() => void)[] = [];
afterEach(() => closers.splice(0).reverse().forEach(close => close()));
function data() { return { id: 'structure', name: 'Structure', appVersion: '1.4.0', locale: LocaleType.EN_US, sheetOrder: ['a'], styles: {}, sheets: { a: { id: 'a', name: 'Sheet', rowCount: 8, columnCount: 6, cellData: { 2: { 2: { v: 'Keep me' } } }, rowData: { 2: { h: 32, custom: { authored: 'retained' } } }, columnData: { 2: { w: 80 } } } } } as unknown as IWorkbookData; }
function fixture() {
  const seed = seedWorkbookStructureIdentity(data(), sha);
  const univer = new Univer({ locale: LocaleType.EN_US, locales: { [LocaleType.EN_US]: English } }); closers.push(() => univer.dispose());
  univer.registerPlugin(UniverSheetsPlugin); const api = FUniver.newAPI(univer), book = api.createWorkbook(seed); book.setEditable(true);
  univer.__getInjector().get(IUniverInstanceService).focusUnit(book.getId());
  return { api, book, initial: book.save(), sheet: book.getActiveSheet() };
}
it('keeps sparse blank row/column ownership through actual SDK insertion, save and undo/redo', async () => {
  const { api, book, initial, sheet } = fixture();
  expect(gridStructureIdentity(initial, book.save(), sha)).toEqual({});
  sheet.insertRowsBefore(1, 2); sheet.insertColumnsBefore(1, 1);
  expect(gridStructureIdentity(initial, book.save(), sha)).toEqual({ a: { rows: [0, null, null, 1, 2, 3, 4, 5, 6, 7], columns: [0, null, 1, 2, 3, 4, 5] } });
  expect(book.save().sheets.a!.cellData?.[4]?.[3]?.v).toBe('Keep me');
  await api.undo(); await api.undo(); expect(gridStructureIdentity(initial, book.save(), sha)).toEqual({});
  await api.redo(); await api.redo(); expect(gridStructureIdentity(initial, book.save(), sha).a!.rows.slice(0, 5)).toEqual([0, null, null, 1, 2]);
});
it('restores deleted source identities, custom metadata and cells through real SDK undo', async () => {
  const { api, book, initial, sheet } = fixture();
  sheet.deleteRows(2, 1); sheet.deleteColumns(2, 1);
  expect(gridStructureIdentity(initial, book.save(), sha)).toEqual({ a: { rows: [0, 1, 3, 4, 5, 6, 7], columns: [0, 1, 3, 4, 5] } });
  await api.undo(); await api.undo(); const restored = book.save();
  expect(gridStructureIdentity(initial, restored, sha)).toEqual({});
  expect(restored.sheets.a!.cellData?.[2]?.[2]?.v).toBe('Keep me');
  expect(restored.sheets.a!.rowData?.[2]?.custom?.authored).toBe('retained');
  expect(restored.sheets.a!.rowData?.[2]?.h).toBe(32);
});
it('refuses forged, reordered, duplicate and missing baseline identities', () => {
  const initial = seedWorkbookStructureIdentity(data(), sha), current = structuredClone(initial);
  current.sheets.a!.rowData![3] = structuredClone(current.sheets.a!.rowData![2]!);
  expect(() => gridStructureIdentity(initial, current, sha)).toThrow('duplicate');
  expect(() => gridStructureIdentity(initial, initial, 'b'.repeat(64))).toThrow('identity');
  expect(() => gridStructureIdentity(data(), initial, sha)).toThrow('baseline');
});

it('bounds axis metadata before allocation independently of the workbook cell budget', () => {
  const source = data(); source.sheets.a!.rowCount = 1048576;
  expect(() => seedWorkbookStructureIdentity(source, sha)).toThrow('metadata limit');
});
