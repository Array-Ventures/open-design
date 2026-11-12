import { expect, it } from 'vitest';
import type { IWorkbookData } from '@univerjs/presets';
import { workbookCalculationInputSha256, workbookWorkerInputProvenance, workbookCalculationChangesInputs } from '../../src/components/embedded/workbook/formula-input-provenance';
const book = { id: 'input-proof', appVersion: '1.4.0', locale: 'enUS' as IWorkbookData['locale'], name: 'Inputs', sheetOrder: ['s'], styles: {}, sheets: { s: { id: 's', name: 'Sheet', rowCount: 100, columnCount: 20, cellData: { 0: { 0: { v: 2, t: 2 }, 1: { f: '=A1+3', v: 999, t: 2 } } } } } } as IWorkbookData;
it('binds authored values, types and exact formulas but never formula caches or display styles', () => {
  const cached = structuredClone(book); cached.sheets.s!.cellData![0]![1]!.v = 5; cached.sheets.s!.cellData![0]![1]!.s = 'color';
  expect(workbookCalculationInputSha256(cached)).toBe(workbookCalculationInputSha256(book));
  for (const change of [(copy: IWorkbookData) => { copy.sheets.s!.cellData![0]![0]!.v = 3; }, (copy: IWorkbookData) => { copy.sheets.s!.cellData![0]![0]!.t = 1; }, (copy: IWorkbookData) => { copy.sheets.s!.cellData![0]![1]!.f = '=a1 + 3'; }]) {
    const copy = structuredClone(book); change(copy); expect(workbookCalculationInputSha256(copy)).not.toBe(workbookCalculationInputSha256(book));
  }
});
it('invalidates a calculation if an input changes away and back during execution', () => {
  const provenance = workbookWorkerInputProvenance(); expect(provenance.tag(book).valid).toBe(false); provenance.started([book]);
  expect(provenance.tag(book).valid).toBe(true); provenance.changed(); provenance.changed();
  expect(provenance.tag(book)).toMatchObject({ valid: false, generation: 1 }); provenance.started([book]); expect(provenance.tag(book)).toMatchObject({ valid: true, generation: 2 });
});
it('recognizes actual value/formula clears while excluding style-only mutations', () => {
  expect(workbookCalculationChangesInputs({ cellValue: { 0: { 0: { s: 'style' } } } })).toBe(false);
  for (const params of [{ cellValue: null }, { cellValue: { 0: { 0: null } } }, { cellValue: { 0: { 0: { f: '=1' } } } }, { cellValue: { 0: { 0: { v: 2 } } } }]) expect(workbookCalculationChangesInputs(params)).toBe(true);
});
