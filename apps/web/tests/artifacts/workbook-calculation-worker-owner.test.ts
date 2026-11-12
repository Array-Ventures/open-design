import { afterEach, expect, it, vi } from 'vitest';
import { ownWorkbookCalculationWorker } from '../../src/components/embedded/workbook/calculation-worker-owner';
class OwnedWorker extends EventTarget {
  terminate = vi.fn();
  message(kind: string) { this.dispatchEvent(new MessageEvent('message', { data: { type: 'studio:workbook-calculation-worker', kind } })); }
}
afterEach(() => vi.useRealTimers());
it('owns startup, exact worker failure and terminal cleanup without a late ready callback', async () => {
  vi.useFakeTimers(); const worker = new OwnedWorker(), unavailable = vi.fn(), owner = ownWorkbookCalculationWorker(unavailable, () => worker as unknown as Worker);
  worker.message('ready'); expect(await owner.loaded).toBe(true); expect(owner.ready).toBe(true);
  owner.deadline.begin(); await vi.advanceTimersByTimeAsync(5000);
  expect(unavailable).toHaveBeenCalledOnce(); expect(worker.terminate).toHaveBeenCalledOnce(); expect(owner.ready).toBe(false);
  worker.message('ready'); expect(owner.ready).toBe(false); owner.dispose(); expect(worker.terminate).toHaveBeenCalledOnce();
});
it('settles startup on departure and refuses a late worker result', async () => {
  vi.useFakeTimers(); const worker = new OwnedWorker(), unavailable = vi.fn(), owner = ownWorkbookCalculationWorker(unavailable, () => worker as unknown as Worker);
  owner.dispose(); expect(await owner.loaded).toBe(false); worker.message('ready'); await vi.advanceTimersByTimeAsync(5000);
  expect(owner.ready).toBe(false); expect(unavailable).not.toHaveBeenCalled(); expect(worker.terminate).toHaveBeenCalledOnce();
});
it('fails closed when setup never reports readiness or explicitly refuses admission', async () => {
  vi.useFakeTimers(); const worker = new OwnedWorker(), unavailable = vi.fn(), owner = ownWorkbookCalculationWorker(unavailable, () => worker as unknown as Worker);
  await vi.advanceTimersByTimeAsync(5000); expect(await owner.loaded).toBe(false); expect(unavailable).toHaveBeenCalledOnce();
  const refused = new OwnedWorker(), second = ownWorkbookCalculationWorker(unavailable, () => refused as unknown as Worker); refused.message('unavailable');
  expect(await second.loaded).toBe(false); expect(refused.terminate).toHaveBeenCalledOnce(); owner.dispose(); second.dispose();
});
