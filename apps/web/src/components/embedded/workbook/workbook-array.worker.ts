/// <reference lib="webworker" />
import type { IWorkbookData } from '@univerjs/core';
import { workbookDocumentSchema } from '@open-design/contracts/runtime/workbook';
import { qualifiedArrayKernel } from './qualified-array-kernel';
import { arrayProjectionSchema } from './array-projection-message';
const channel = 'studio:workbook-array-projection';
let kernel: ReturnType<typeof qualifiedArrayKernel> | undefined, pending: { snapshot: IWorkbookData; generation: number } | undefined, running = false, terminal = false;
function fail() { terminal = true; pending = undefined; kernel?.invalidate(); self.postMessage({ type: channel, kind: 'unavailable' }); }
async function drain() {
  if (running || !kernel || terminal) return;
  running = true;
  try {
    while (pending && !terminal) {
      const current = pending; pending = undefined;
      const result = await kernel.calculate(current.snapshot, current.generation);
      // A newer input supersedes this complete private pass; never publish it.
      if (!pending && !terminal) self.postMessage({ type: channel, kind: 'result', projection: arrayProjectionSchema.parse(result) });
    }
  } catch { fail(); } finally { running = false; }
}
self.addEventListener('message', event => {
  if (terminal || event.data?.type !== channel) return;
  try {
    if (event.data.kind === 'initialize') {
      if (kernel) throw new Error('Source already initialized.');
      kernel = qualifiedArrayKernel(workbookDocumentSchema.parse(event.data.model), event.data.unitId, event.data.sourceSha256);
      self.postMessage({ type: channel, kind: 'ready' });
    } else if (event.data.kind === 'calculate') {
      if (!kernel || !Number.isSafeInteger(event.data.generation) || event.data.generation < 1) throw new Error('Invalid calculation request.');
      pending = { snapshot: event.data.snapshot, generation: event.data.generation }; void drain();
    } else throw new Error('Unknown projection request.');
  } catch { fail(); }
});
