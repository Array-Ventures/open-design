import { expect, it } from 'vitest';
import { assertWorkbookStructuralScalarTokens, QUALIFIED_WORKBOOK_FUNCTIONS } from '../src/runtime/workbook-formula-policy';
const types = { FUNCTION: 3, REFERENCE: 4, ARRAY: 5, TABLE: 7, DEFINED_NAME: 6 };
const fn = (token: string) => ({ nodeType: types.FUNCTION, token }), ref = (token: string) => ({ nodeType: types.REFERENCE, token });
const runtime = { types, isLiteral: (token: string) => ['TRUE', 'FALSE', '#REF!'].includes(token), referenceShape: (token: string): 'single' | 'range' | 'whole-axis' => token === 'A:A' ? 'whole-axis' : token.includes(':') ? 'range' : 'single' };
it('uses the existing qualified scalar kernels and permits bounded reduction arguments', () => {
  expect(QUALIFIED_WORKBOOK_FUNCTIONS.has('SUM')).toBe(true); expect(QUALIFIED_WORKBOOK_FUNCTIONS.has('SEQUENCE')).toBe(false);
  expect(() => assertWorkbookStructuralScalarTokens('=SUM(A1:A3)+A1', [fn('SUM'), '(', ref('A1:A3'), ')', '+', ref('A1')], runtime)).not.toThrow();
  expect(() => assertWorkbookStructuralScalarTokens('=IF(TRUE,SUM(A1:A3),1)', [fn('IF'), '(', fn('TRUE'), ',', fn('SUM'), '(', ref('A1:A3'), ')', ',', '1', ')'], runtime)).not.toThrow();
});
it('refuses broadcasting, whole-axis counting, unqualified kernels and array/spill syntax', () => {
  for (const nodes of [[ref('A1:A3'), '+', '1'], [fn('IF'), '(', fn('TRUE'), ',', ref('A1:A3'), ',', '1', ')'], [fn('COUNTIF'), '(', ref('A:A'), ',', '0', ')'], [fn('SEQUENCE'), '(', '3', ')'], [{ nodeType: types.ARRAY, token: '{1,2}' }], [ref('A1'), '#']]) expect(() => assertWorkbookStructuralScalarTokens('=fixture', nodes, runtime)).toThrow();
});
