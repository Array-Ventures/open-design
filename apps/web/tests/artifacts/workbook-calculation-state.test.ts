import { expect, it } from 'vitest';
import { workbookCalculationState } from '../../src/components/embedded/workbook/calculation-state';
it('describes pending, stored and unavailable formulas without presenting cached output as live', () => {
  const base = { pending: false, paused: false, stored: 0, unavailable: 0 };
  expect(workbookCalculationState(base).phase).toBe('live');
  expect(workbookCalculationState({ ...base, stored: 2 }).phase).toBe('stored');
  expect(workbookCalculationState({ ...base, paused: true, stored: 2 })).toEqual({ phase: 'stored', paused: true, stored: 2, unavailable: 0 });
  expect(workbookCalculationState({ ...base, unavailable: 1 }).phase).toBe('unavailable');
  expect(workbookCalculationState({ ...base, pending: true, stored: 1, unavailable: 1 }).phase).toBe('pending');
  expect(workbookCalculationState({ ...base, paused: true }).phase).toBe('live'); // no formulas need no warning
});
