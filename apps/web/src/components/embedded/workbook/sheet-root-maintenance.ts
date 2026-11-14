import type { IUndoRedoService, IUniverInstanceService } from '@univerjs/core';

interface MaintenanceOwner {
  isCurrent(): boolean;
  canRun(): boolean;
  hasWork(): boolean;
  run(): Promise<void>;
}

/** Scheduling only: actual retention, permissions and durability stay with the
 * private controller/Writer. No interval, persisted identity or history copy. */
export function workbookRootMaintenance(history: IUndoRedoService, instances: IUniverInstanceService, owner: MaintenanceOwner) {
  let disposed = false;
  let needed = false;
  let requested = {};
  let observedRevision: number | undefined;
  let running: Promise<void> | null = null;
  let scheduled: object | null = null;
  let cancel: (() => void) | undefined;
  const cancelScheduled = () => { scheduled = null; cancel?.(); cancel = undefined; };
  const schedule = () => {
    if (disposed || scheduled || running || !needed || !owner.hasWork() || !owner.canRun()) return;
    const ticket = {};
    scheduled = ticket;
    const invoke = () => {
      if (scheduled !== ticket || disposed) return;
      scheduled = null; cancel = undefined;
      void runNow().catch(() => { /* Retry on a new boundary or explicit action, never spin. */ });
    };
    if (typeof globalThis.requestIdleCallback === 'function') {
      const id = globalThis.requestIdleCallback(invoke, { timeout: 1000 });
      cancel = () => globalThis.cancelIdleCallback(id);
    } else {
      const id = setTimeout(invoke, 0);
      cancel = () => clearTimeout(id);
    }
  };
  const request = () => {
    if (disposed) return;
    requested = {};
    needed = true;
    schedule();
  };
  function runNow(): Promise<void> {
    if (running) return running;
    cancelScheduled();
    if (disposed || !needed) return Promise.resolve();
    if (!owner.hasWork()) { needed = false; return Promise.resolve(); }
    if (!owner.canRun()) return Promise.resolve();
    needed = false;
    const requestAtStart = requested;
    const work = Promise.resolve().then(() => {
      // Stop/rebind gates may change after the idle task schedules this turn.
      // Never begin a new protected operation under a stopped owner.
      if (disposed || !owner.canRun()) { needed = true; return; }
      return owner.run();
    }).catch(error => { needed = true; throw error; });
    const complete = work.finally(() => {
      if (running === complete) running = null;
      // A genuinely new history/focus/ACK boundary can earn one follow-up;
      // failure with no new boundary never creates a background retry loop.
      if (requested !== requestAtStart) schedule();
    });
    running = complete;
    return complete;
  }
  const observe = () => {
    // The listeners are O(1): no snapshot copies, model parsing or full-ID scan.
    // Never let a lifecycle/inspection failure alter a native SDK command.
    try {
      if (disposed || !owner.isCurrent() || !owner.hasWork()) return;
      const revision = history.getUndoRedoCheckpoint().revision;
      if (revision !== observedRevision) { observedRevision = revision; request(); }
      else if (needed) schedule();
    } catch { needed = true; }
  };
  const historySubscription = history.undoRedoStatus$.subscribe(observe);
  const focusSubscription = instances.focused$.subscribe(observe);
  request();
  return {
    request,
    runNow,
    settled: () => running?.then(() => {}, () => {}) ?? Promise.resolve(),
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelScheduled();
      historySubscription.unsubscribe();
      focusSubscription.unsubscribe();
    },
  };
}
