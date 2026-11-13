import { expect, it } from 'vitest';
import { workbookAxisProjection } from '../src/runtime/workbook-structure';
it('inserts only inside retained range endpoints and shifts references beyond the rendered grid', () => {
  const map = workbookAxisProjection(4, [null, 0, null, 1, 2, 3, null], 100);
  expect([0, 1, 2, 3, 4, 8].map(map.point)).toEqual([1, 3, 4, 5, 7, 11]);
  expect(map.interval(0, 3)).toEqual([1, 5]);
  expect(map.interval(1, 2)).toEqual([3, 4]);
  expect(map.interval(3, 6)).toEqual([5, 9]);
});
it('shrinks deleted endpoints and reports complete deletion rather than silently redirecting the range', () => {
  const map = workbookAxisProjection(7, [0, null, 3, 5, 6], 100);
  expect(map.point(1)).toBeNull(); expect(map.interval(1, 2)).toBeNull();
  expect(map.interval(1, 4)).toEqual([2, 2]);
  expect(map.interval(0, 6)).toEqual([0, 4]);
  expect(map.interval(4, 9)).toEqual([3, 7]);
});
it('bounds both allocations and reference growth and refuses permutations or duplicate source ownership', () => {
  expect(() => workbookAxisProjection(3, [0, 0], 100)).toThrow('unique');
  expect(() => workbookAxisProjection(3, [1, 0], 100)).toThrow('ordered');
  expect(() => workbookAxisProjection(3, [3], 100)).toThrow('identity');
  expect(() => workbookAxisProjection(100001, [0], 200000)).toThrow('limit');
  expect(() => workbookAxisProjection(2, [0, null, 1], 4).point(3)).toThrow('limit');
});

it('preserves virtual-tail view positions and clamps only at the actual worksheet hard edge', () => {
  const map = workbookAxisProjection(2, [0, null, 1], 4);
  expect(() => map.point(3)).toThrow('limit'); expect(map.pointClamped(3)).toBe(3); expect(map.intervalClamped(2, 3)).toEqual([3, 3]);
  const global = workbookAxisProjection(100, Array.from({ length: 101 }, (_, index) => index < 1 ? index : index === 1 ? null : index - 1), 1048576);
  expect(global.pointClamped(999)).toBe(1000); expect(global.pointClamped(1048575)).toBe(1048575);
});
