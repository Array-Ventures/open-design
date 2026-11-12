import { expect, it } from 'vitest';
import type { IWorkbookData } from '@univerjs/presets';
import { assertWorkbookCalculationBudget, assertWorkbookCalculationMutation } from '../../src/components/embedded/workbook/formula-worker-budget';
const book = { id: 'bounded', name: 'Bounded', appVersion: '1.4.0', locale: 'enUS' as IWorkbookData['locale'], sheetOrder: ['s'], styles: {}, sheets: { s: { id: 's', name: 'Inputs', rowCount: 100, columnCount: 20, cellData: { 0: { 0: { v: 2, t: 2 } } } } } } as IWorkbookData;
const mutation = 'sheet.mutation.set-range-values';
it('admits the actual bounded source and refuses expanded or foreign geometry', () => {
  expect(() => assertWorkbookCalculationBudget([book], true)).not.toThrow();
  for (const changed of [{ ...book, sheets: { s: { ...book.sheets.s!, rowCount: 10000 } } }, { ...book, sheets: { s: { ...book.sheets.s!, columnCount: Number.NaN } } }, { ...book, sheets: { s: { ...book.sheets.s!, cellData: { 100: { 0: { v: 2 } } } } } }]) expect(() => assertWorkbookCalculationBudget([changed], true)).toThrow();
  expect(() => assertWorkbookCalculationBudget([book, book])).toThrow();
});
it('bounds values/paste coordinates and refuses unreviewed structural mutation before execution', () => {
  const command = { id: mutation, params: { unitId: book.id, subUnitId: 's', cellValue: { 99: { 19: { v: 10 } } } } };
  expect(() => assertWorkbookCalculationMutation(command, [book], mutation)).not.toThrow();
  for (const changed of [{ ...command, id: 'sheet.mutation.insert-row' }, { ...command, id: 'sheet.mutation.set-worksheet-row-count' }, { ...command, id: 'sheet.mutation.future-growth' }, { ...command, params: { ...command.params, cellValue: { 100: { 0: { v: 3 } } } } }, { ...command, params: { ...command.params, cellValue: { 0: { 20: { v: 3 } } } } }, { ...command, params: { ...command.params, unitId: 'other' } }]) expect(() => assertWorkbookCalculationMutation(changed, [book], mutation)).toThrow();
});
