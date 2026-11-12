import type { IWorkbookData } from '@univerjs/core';
import type { WorkbookDocument } from '@open-design/contracts/runtime/workbook';
import { arrayProjectionMessageSchema, type ArrayProjection } from './array-projection-message';
import { workbookCalculationInputSha256 } from './formula-input-provenance';
import { assertWorkbookCalculationBudget } from './formula-worker-budget';
import { workbookCalculationDeadline } from './formula-worker-deadline';

/** One source-bound worker and one atomic, read-only projection stream. A new
 * source/controller gets a new owner. Results never mutate authored snapshots. */
export function ownArrayProjectionWorker(model: WorkbookDocument, unitId: string, sourceSha256: string, unavailable: () => void,
  factory = () => new Worker(new URL('./workbook-array.worker.ts', import.meta.url), { type: 'module', name: 'workbook-array-calculation' })) {
  const worker = factory(), listeners = new Set<(projection: ArrayProjection) => void>();
  let active = true, ready = false, failed = false, settled = false, generation = 0, expected: { generation: number; inputSha256: string } | undefined;
  let resolve!: (ready: boolean) => void;
  const loaded = new Promise<boolean>(done => { resolve = done; });
  const settle = (value: boolean) => { if (settled) return; settled = true; clearTimeout(startup); resolve(value); };
  const deadline = workbookCalculationDeadline(worker, () => { failed = true; ready = false; expected = undefined; settle(false); unavailable(); });
  const startup = setTimeout(() => deadline.fail(), 5_000);
  const receive = (event: MessageEvent) => {
    if (!active || failed || event.data?.type !== 'studio:workbook-array-projection') return;
    const parsed = arrayProjectionMessageSchema.safeParse(event.data);
    if (!parsed.success) { deadline.fail(); return; }
    const message = parsed.data;
    if (message.kind === 'ready') { if (ready) { deadline.fail(); return; } ready = true; settle(true); return; }
    if (message.kind === 'unavailable') { deadline.fail(); return; }
    const result = message.projection, tag = result.workbookCalculation;
    if (!ready || result.sourceSha256 !== sourceSha256 || tag.unitId !== unitId || !tag.valid) { deadline.fail(); return; }
    if (!expected || tag.generation !== expected.generation) return;
    if (tag.inputSha256 !== expected.inputSha256) { deadline.fail(); return; }
    if (!deadline.complete(tag.generation)) return;
    expected = undefined;
    try { for (const listener of listeners) listener(result); } catch { deadline.fail(); }
  };
  const error = (event: ErrorEvent) => { event.preventDefault(); deadline.fail(); };
  worker.addEventListener('message', receive); worker.addEventListener('error', error);
  worker.postMessage({ type: 'studio:workbook-array-projection', kind: 'initialize', model, unitId, sourceSha256 });
  return {
    loaded,
    fail() { deadline.fail(); },
    get ready() { return ready && active && !failed; },
    calculate(snapshot: IWorkbookData) {
      if (!ready || !active || failed) return null;
      try {
        assertWorkbookCalculationBudget([snapshot], true);
        if (snapshot.id !== unitId) throw new Error('Projection unit changed.');
        const ticket = deadline.begin(); if (ticket === null) return null;
        generation = ticket; expected = { generation, inputSha256: workbookCalculationInputSha256(snapshot) };
        worker.postMessage({ type: 'studio:workbook-array-projection', kind: 'calculate', snapshot, generation }); return generation;
      } catch { deadline.fail(); return null; }
    },
    onResult(listener: (projection: ArrayProjection) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    dispose() { if (!active) return; active = false; ready = false; expected = undefined; listeners.clear(); settle(false); worker.removeEventListener('message', receive); worker.removeEventListener('error', error); deadline.dispose(); },
  };
}
