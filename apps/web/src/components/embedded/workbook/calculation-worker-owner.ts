import { workbookCalculationMessageSchema, type WorkbookCalculationResultMessage } from './formula-worker-message';
import { workbookCalculationDeadline } from './formula-worker-deadline';
/** The RPC plugin does not own a supplied Worker instance. This owner retains
 * its exact lifetime and stops a failed/departed worker without restarting it. */
export function ownWorkbookCalculationWorker(unavailable: () => void, factory = () => new Worker(new URL('./workbook-formula.worker.ts', import.meta.url), { type: 'module', name: 'workbook-calculation' })) {
  const worker = factory(), deadline = workbookCalculationDeadline(worker, () => { failed = true; ready = false; settle(false); unavailable(); });
  let ready = false, active = true, failed = false, settled = false, resolve!: (ready: boolean) => void;
  const listeners = new Set<(result: WorkbookCalculationResultMessage) => void>();
  const loaded = new Promise<boolean>(done => { resolve = done; });
  const settle = (value: boolean) => { if (settled) return; settled = true; clearTimeout(startup); resolve(value); };
  const receive = (event: MessageEvent) => {
    if (!active || failed || event.data?.type !== 'studio:workbook-calculation-worker') return;
    const message = workbookCalculationMessageSchema.safeParse(event.data);
    if (!message.success) { deadline.fail(); return; }
    if (message.data.kind === 'ready') { ready = true; settle(true); }
    else if (message.data.kind === 'unavailable') deadline.fail();
    else if (ready) { try { for (const listener of listeners) listener(message.data); } catch { deadline.fail(); } }
  };
  const error = (event: ErrorEvent) => { event.preventDefault(); deadline.fail(); };
  const startup = setTimeout(() => deadline.fail(), 5_000);
  worker.addEventListener('message', receive); worker.addEventListener('error', error);
  return {
    worker, loaded, deadline,
    onResult(listener: (result: WorkbookCalculationResultMessage) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    get ready() { return ready && active && !failed; },
    dispose() { listeners.clear(); active = false; ready = false; settle(false); worker.removeEventListener('message', receive); worker.removeEventListener('error', error); deadline.dispose(); },
  };
}
