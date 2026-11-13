import { describe, expect, it } from 'vitest';
import type { WorkbookTable } from '@open-design/contracts/runtime/workbook';
import { calculationFormula } from '../../src/artifacts/workbook/formula-input.js';

const tables: WorkbookTable[] = [{ name: 'Sales', sheetId: '1', range: { startRow: 3, endRow: 6, startColumn: 2, endColumn: 4 }, columns: ['Amount', 'Flag', 'Double'], header: true, totals: false }];
const cell = { row: 4, column: 4, kind: 'blank' as const, value: null };
describe('workbook formula input normalization', () => {
  it.each([
    ['=Sales[@Amount]*2', 'Sales[[#This Row],[Amount]]*2'],
    ['=Sales[@[Amount]]*2', 'Sales[[#This Row],[Amount]]*2'],
    ['=[@Amount]*2', 'Sales[[#This Row],[Amount]]*2'],
    ['="Sales[@Amount]"', '"Sales[@Amount]"'],
    ['="a""Sales[@Amount]"', '"a""Sales[@Amount]"'],
    ["='Sales[@Amount]'!A1", "'Sales[@Amount]'!A1"],
    ['=[@book]Sheet!A1', '[@book]Sheet!A1'],
    ['=OtherSales[@Amount]', 'OtherSales[@Amount]'],
    ['=Sales[@Amount', 'Sales[@Amount'],
    ["=Sales[@[A']B]]", "Sales[[#This Row],[A']B]]"],
  ])('normalizes only actual current-row references in %s', (input, expected) => {
    expect(calculationFormula(input, '1', cell, tables)).toBe(expected);
  });
  it('does not infer a table for a cell outside its range', () => {
    expect(calculationFormula('=[@Amount]', '1', { ...cell, row: 20 }, tables)).toBe('[@Amount]');
  });
});
