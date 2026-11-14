import { expect, it } from 'vitest';
import type { IWorkbookData } from '@univerjs/core';
import type { ISetFormulaCalculationResultMutation } from '@univerjs/engine-formula';
import { completeWorkbookScalarSourceGuards, workbookFormulaSourceGuard } from '../../src/components/embedded/workbook/formula-result-sources';
import { gridWorkbook } from '../../src/components/embedded/workbook/grid-model';
import { workbookDocumentSchema, WORKBOOK_MODEL_LIMITS } from '@open-design/contracts/runtime/workbook';
import browserModel from '../fixtures/workbook-browser-membership-model.json';

const book = () => gridWorkbook(workbookDocumentSchema.parse(browserModel), 'source-fixture', 'Source fixture').data as IWorkbookData;
const result = (id: string): ISetFormulaCalculationResultMutation => ({ unitData: { [id]: { '1': { 2: { 2: { v: 12, t: 2 } } }, '2': { 0: { 0: { v: 12, t: 2 } } } } }, unitOtherData: {} });
it('completes both formula identities without changing result values or the current workbook', () => {
  const current = book(), before = structuredClone(current), calculated = result(current.id), vector = structuredClone(calculated.unitData);
  completeWorkbookScalarSourceGuards(calculated, current);
  expect(calculated.sourceFormulaData).toEqual({ [current.id]: { '1': { 2: { 2: { f: '=SUM(B2:B3)' } } }, '2': { 0: { 0: { f: "='Rich cells'!B2" } } } } });
  expect(calculated.unitData).toEqual(vector);
  expect(current).toEqual(before);
});
it.each([undefined, null, {}, { f: '=999' }, { f: '=SUM(B2:B3)', si: 'forged' }])('refuses a supplied invalid guard %j without repairing its identity', supplied => {
  const current = book(), calculated = result(current.id);
  const guards = { 2: supplied };
  calculated.sourceFormulaData = { [current.id]: { '1': { 2: guards } } } as ISetFormulaCalculationResultMutation['sourceFormulaData'];
  expect(() => completeWorkbookScalarSourceGuards(calculated, current)).toThrow(/identity changed/);
  expect(Object.hasOwn(guards, 2)).toBe(true);
  expect(guards[2]).toEqual(supplied);
});
it('retains a valid supplied object and does not invent identities for literals or absent cells', () => {
  const current = book(), calculated = result(current.id), supplied = { f: '=SUM(B2:B3)', x: 0, y: 0 };
  calculated.sourceFormulaData = { [current.id]: { '1': { 2: { 2: supplied } } } };
  calculated.unitData[current.id]!['1']![1] = { 1: { v: 999, t: 2 } };
  calculated.unitData[current.id]!['1']![3] = { 3: { v: 999, t: 2 } };
  completeWorkbookScalarSourceGuards(calculated, current);
  expect(calculated.sourceFormulaData[current.id]!['1']![2]![2]).toBe(supplied);
  expect(calculated.sourceFormulaData[current.id]!['1']![1]).toBeUndefined();
  expect(calculated.sourceFormulaData[current.id]!['1']![3]).toBeUndefined();
});
it('bounds source f/si and shares the exact canonical source guard with display admission', () => {
  const current = book(), cell = current.sheets['1']!.cellData![2]![2]!;
  expect(workbookFormulaSourceGuard(current, '1', 2, 2)).toEqual({ f: '=SUM(B2:B3)' });
  cell.si = 's'.repeat(WORKBOOK_MODEL_LIMITS.text + 1);
  expect(() => workbookFormulaSourceGuard(current, '1', 2, 2)).toThrow(/malformed/);
  delete cell.si;
  cell.f = 'f'.repeat(WORKBOOK_MODEL_LIMITS.text + 1);
  expect(() => workbookFormulaSourceGuard(current, '1', 2, 2)).toThrow(/malformed/);
});
