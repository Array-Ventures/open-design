import { expect, it } from 'vitest';
import { workbookAxisProjection } from '@open-design/contracts/runtime/workbook-structure';
import { workbookStructuralFormula } from '../../src/artifacts/workbook/structure-formulas.js';
const sheets = [{ id: 'a', name: 'Budget' }, { id: 'b', name: "Bob's plan" }];
const identity = (n: number) => Array.from({ length: n }, (_, index) => index);
const projections = new Map([['a', { rows: workbookAxisProjection(8, [0, null, 1, 2, 3, 4, 5, 6, 7], 1048576), columns: workbookAxisProjection(6, identity(6), 16384) }]]);
it('rewrites qualified and local ranges through the pinned lexer while preserving absolute markers and quoted literals', () => {
  const rewrite = (value: string, id = 'a') => workbookStructuralFormula(value, id, sheets, projections);
  expect(rewrite('=SUM(A1:$B$3)+$A$2+A$2+$A2')).toBe('=SUM(A1:$B$4)+$A$3+A$3+$A3');
  expect(rewrite('="A2 Budget!A2"&A2')).toBe('="A2 Budget!A2"&A3');
  expect(rewrite("=Budget!A2+'Bob''s plan'!A2", 'b')).toBe("=Budget!A3+'Bob''s plan'!A2");
  expect(rewrite('=SUM(A:A)+SUM(2:3)')).toBe('=SUM(A:A)+SUM(3:4)');
});
it('shrinks ranges around deleted endpoints and preserves complete deletion as REF errors', () => {
  const deleted = new Map([['a', { rows: workbookAxisProjection(8, [0, 3, 4, 5, 6, 7], 1048576), columns: workbookAxisProjection(6, identity(6), 16384) }]]);
  expect(workbookStructuralFormula('=SUM(A2:A5)+A2+$A$3+A4', 'a', sheets, deleted)).toBe('=SUM(A2:A3)+#REF!+#REF!+A2');
});
it('preserves unrelated formulas exactly and refuses named, table, unknown-sheet and external references', () => {
  expect(workbookStructuralFormula('=#REF!', 'a', sheets, projections)).toBe('=#REF!');
  expect(workbookStructuralFormula('=SUM(A2)+#VALUE!', 'a', sheets, projections)).toBe('=SUM(A3)+#VALUE!');
  expect(workbookStructuralFormula('= 1 + SUM(A1)', 'b', sheets, projections)).toBe('= 1 + SUM(A1)');
  for (const formula of ['=BudgetTotal+1', '=Table1[Amount]', '=Missing!A2', '=[Other.xlsx]Budget!A2']) expect(() => workbookStructuralFormula(formula, 'a', sheets, projections), formula).toThrow();
});
