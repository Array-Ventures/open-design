import { useLayoutEffect, useState } from 'react';

/** Keep the outgoing document mounted until its existing view-state capture
 * settles. Retirement fences late captures; capture itself owns its deadline. */
export function usePreviewSourceHandoff<T>(candidate: T, scope: string, enabled: boolean, capture: (waitForOpaque: boolean) => Promise<void>): boolean {
  const [ready, setReady] = useState(() => candidate);
  useLayoutEffect(() => {
    if (!enabled) { setReady(() => candidate); return; }
    let retired = false;
    const complete = () => { if (!retired) setReady(() => candidate); };
    void Promise.resolve().then(() => { if (!retired) return capture(true); }).then(complete, complete);
    return () => { retired = true; };
  }, [candidate, scope, enabled, capture]);
  return !enabled || ready === candidate;
}
