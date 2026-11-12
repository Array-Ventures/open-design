/** Ownership for one pinned calculation worker. A timeout is terminal: it must
 * not quietly restart against a different draft, or label cached results live. */
export function workbookCalculationDeadline(worker: { terminate(): void }, unavailable: () => void, timeoutMs = 5_000) {
  let generation = 0, timer: ReturnType<typeof setTimeout> | undefined, terminal = false;
  const clear = () => { clearTimeout(timer); timer = undefined; };
  const fail = () => { if (terminal) return; terminal = true; clear(); worker.terminate(); unavailable(); };
  return {
    begin() {
      if (terminal) return null;
      const current = ++generation; clear(); timer = setTimeout(fail, timeoutMs); return current;
    },
    complete(current: number) { if (terminal || current !== generation) return false; clear(); return true; },
    fail,
    dispose() { if (terminal) return; terminal = true; clear(); worker.terminate(); },
  };
}
