import { afterEach, expect, it, vi } from 'vitest';
import { ownWorkbookCalculationWorker } from '../../src/components/embedded/workbook/calculation-worker-owner';
import { ownArrayProjectionWorker } from '../../src/components/embedded/workbook/array-projection-owner';
const created: { url: URL; options: WorkerOptions; worker: ClassicWorker }[] = [];
class ClassicWorker extends EventTarget {
  terminate = vi.fn(); postMessage = vi.fn();
  constructor(url: URL, options: WorkerOptions) { super(); created.push({ url, options, worker: this }); }
}
afterEach(() => { vi.unstubAllGlobals(); created.length = 0; });
it('launches both pinned Turbopack entries as named classic workers and retains exact disposal ownership', async () => {
  vi.stubGlobal('Worker', ClassicWorker);
  const unavailable = vi.fn(), scalar = ownWorkbookCalculationWorker(unavailable), arrays = ownArrayProjectionWorker({} as never, 'unit', 'a'.repeat(64), unavailable);
  try {
  expect(created.map(({ url, options }) => [url.pathname.split('/').at(-1), options])).toEqual([
    ['workbook-formula.worker.ts', { type: 'classic', name: 'workbook-calculation' }],
    ['workbook-array.worker.ts', { type: 'classic', name: 'workbook-array-calculation' }],
  ]);
  expect(created[1]!.worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'studio:workbook-array-projection', kind: 'initialize', unitId: 'unit' }));
  } finally { scalar.dispose(); arrays.dispose(); }
  expect(await scalar.loaded).toBe(false); expect(await arrays.loaded).toBe(false);
  for (const { worker } of created) expect(worker.terminate).toHaveBeenCalledTimes(1);
  expect(unavailable).not.toHaveBeenCalled();
});
