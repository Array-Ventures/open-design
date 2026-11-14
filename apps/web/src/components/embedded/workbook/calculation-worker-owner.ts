import { workbookMembershipConfigurationSchema, type WorkbookMembershipConfiguration } from './sheet-calculation-permit';
import { workbookCalculationMessageSchema, type WorkbookCalculationResultMessage } from './formula-worker-message';
import { workbookCalculationDeadline } from './formula-worker-deadline';
/** The RPC plugin does not own a supplied Worker instance. This owner retains
 * its exact lifetime and stops a failed/departed worker without restarting it. */
// This pin's Turbopack worker bootstrap uses importScripts, so its generated
// entry must run as a classic worker even though the source uses ESM imports.
export function ownWorkbookCalculationWorker(unavailable: () => void, factory = () => new Worker(new URL('./workbook-formula.worker.ts', import.meta.url), { type: 'classic', name: 'workbook-calculation' })) {
  const failures = new Set<() => void>();
  const worker = factory(), deadline = workbookCalculationDeadline(worker, () => { failed = true; ready = false; settle(false); rejectConfiguration(); for (const listener of failures) listener(); unavailable(); });
  let membership: WorkbookMembershipConfiguration | null = null;
  let configuration: { value: WorkbookMembershipConfiguration; resolve(): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> } | null = null;
  const rejectConfiguration = () => { if (configuration) { clearTimeout(configuration.timer); configuration.reject(Error('Worksheet calculation configuration was withdrawn.')); configuration = null; } };
  let ready = false, active = true, failed = false, settled = false, resolve!: (ready: boolean) => void;
  const listeners = new Set<(result: WorkbookCalculationResultMessage) => void>();
  const loaded = new Promise<boolean>(done => { resolve = done; });
  const settle = (value: boolean) => { if (settled) return; settled = true; clearTimeout(startup); resolve(value); };
  const receive = (event: MessageEvent) => {
    if (!active || failed || event.data?.type !== 'studio:workbook-calculation-worker') return;
    const message = workbookCalculationMessageSchema.safeParse(event.data);
    if (!message.success) { deadline.fail(); return; }
    if (message.data.kind === 'ready') { ready = true; settle(true); }
    else if (message.data.kind === 'membership-ready') {
      const pending = configuration;
      if (!pending || JSON.stringify(message.data.configuration) !== JSON.stringify(pending.value)) { deadline.fail(); return; }
      membership = Object.freeze({ ...pending.value }); clearTimeout(pending.timer); configuration = null; pending.resolve();
    }
    else if (message.data.kind === 'unavailable') deadline.fail();
    else if (ready) { try { for (const listener of listeners) listener(message.data); } catch { deadline.fail(); } }
  };
  const error = (event: ErrorEvent) => { event.preventDefault(); deadline.fail(); };
  const startup = setTimeout(() => deadline.fail(), 5_000);
  worker.addEventListener('message', receive); worker.addEventListener('error', error);
  return {
    worker, loaded, deadline,
    get membership() { return membership; },
    configureMembership(raw: WorkbookMembershipConfiguration): Promise<void> {
      if (!ready || !active || failed || membership || configuration) return Promise.reject(Error('Worksheet calculation configuration is not current.'));
      const value = workbookMembershipConfigurationSchema.parse(raw);
      return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => deadline.fail(), 5_000);
        configuration = { value, resolve, reject, timer };
        worker.postMessage({ type: 'studio:workbook-membership-configure', configuration: value });
      });
    },
    onUnavailable(listener: () => void) { failures.add(listener); return () => { failures.delete(listener); }; },
    onResult(listener: (result: WorkbookCalculationResultMessage) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    get ready() { return ready && active && !failed; },
    dispose() { rejectConfiguration(); membership = null; for (const listener of failures) listener(); failures.clear(); listeners.clear(); active = false; ready = false; settle(false); worker.removeEventListener('message', receive); worker.removeEventListener('error', error); deadline.dispose(); },
  };
}
