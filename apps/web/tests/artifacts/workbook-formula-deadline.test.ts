import { afterEach, expect, it, vi } from 'vitest';
import { workbookCalculationDeadline } from '../../src/components/embedded/workbook/formula-worker-deadline';
afterEach(() => vi.useRealTimers());
it('only matching completion clears its deadline and a timeout terminates ownership once', async () => {
  vi.useFakeTimers(); const terminate = vi.fn(), unavailable = vi.fn(), clock = workbookCalculationDeadline({ terminate }, unavailable, 25);
  const first = clock.begin()!, second = clock.begin()!;
  expect(clock.complete(first)).toBe(false); await vi.advanceTimersByTimeAsync(25);
  expect(terminate).toHaveBeenCalledOnce(); expect(unavailable).toHaveBeenCalledOnce();
  expect(clock.complete(second)).toBe(false); expect(clock.begin()).toBeNull(); clock.fail(); clock.dispose(); expect(terminate).toHaveBeenCalledOnce();
});
it('disposal and successful completion never publish a late unavailable status', async () => {
  vi.useFakeTimers(); const terminate = vi.fn(), unavailable = vi.fn(), clock = workbookCalculationDeadline({ terminate }, unavailable, 25);
  expect(clock.complete(clock.begin()!)).toBe(true); await vi.advanceTimersByTimeAsync(25); expect(terminate).not.toHaveBeenCalled();
  clock.begin(); clock.dispose(); await vi.advanceTimersByTimeAsync(25); expect(terminate).toHaveBeenCalledOnce(); expect(unavailable).not.toHaveBeenCalled();
});
