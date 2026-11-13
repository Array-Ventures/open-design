import { useCallback, useEffect, useRef, useState } from 'react';
import { accessWorkbookRestore, listWorkbookRestoreFileNames } from './draft-store';
import { listWorkbookHistory } from './history-transport';
import { WorkbookHostError } from './host-request';

/** A scoped key grants only a candidate filename. Every displayed candidate
 * gets fresh per-file authority before its protected identity is inspected. */
export function useMissingWorkbookRestores(viewerId: string | null, projectId: string, present: readonly string[], generation: number) {
  const scopeKey = JSON.stringify([viewerId, projectId]);
  const owner = useRef(scopeKey); owner.current = scopeKey;
  const presentKey = JSON.stringify([...present].sort());
  const [state, setState] = useState<{ scope: string; files: string[]; cursor: string | null; loading: boolean; error: string | null }>({ scope: '', files: [], cursor: null, loading: false, error: null });
  const [attempt, retry] = useState(0);
  const life = useRef<AbortController | null>(null), busy = useRef(false);
  const load = useCallback(async (cursor?: string) => {
    const signal = life.current?.signal; if (!viewerId || !signal || signal.aborted || busy.current || owner.current !== scopeKey) return;
    const alive = () => !signal.aborted && owner.current === scopeKey && life.current?.signal === signal;
    busy.current = true; setState(value => ({ ...value, loading: true }));
    try {
      const page = await listWorkbookRestoreFileNames({ viewerId, projectId }, { ...(cursor ? { cursor } : {}) });
      let problem = false;
      const found: string[] = [], existing = new Set<string>(JSON.parse(presentKey));
      for (const fileName of page.fileNames) {
        if (!alive()) return;
        if (existing.has(fileName)) continue;
        try {
          await listWorkbookHistory(projectId, fileName, signal, { limit: 1 });
          if (!alive()) return;
          const intent = await accessWorkbookRestore({ viewerId, projectId, fileName });
          if (!alive()) return;
          if (intent) found.push(fileName);
        } catch (cause) {
          if (cause instanceof WorkbookHostError && [401, 403, 404].includes(cause.status)) {
            if (alive()) setState({ scope: scopeKey, files: [], cursor: null, loading: false, error: null });
            return;
          }
          if (alive()) problem = true; // No name/identity is exposed without verified authority.
        }
      }
      if (alive()) setState(value => ({ scope: scopeKey, files: [...new Set([...(cursor && value.scope === scopeKey ? value.files : []), ...found])], cursor: page.cursor, loading: false, error: problem ? 'Local restore recovery could not be checked. Try again.' : null }));
    } catch { if (alive()) setState(value => ({ ...value, scope: scopeKey, error: 'Local restore recovery could not be checked. Try again.' })); }
    finally { if (alive()) { busy.current = false; setState(value => ({ ...value, loading: false })); } }
  }, [viewerId, projectId, presentKey, scopeKey]);
  useEffect(() => {
    const controller = new AbortController(); life.current = controller; busy.current = false;
    setState({ scope: scopeKey, files: [], cursor: null, loading: Boolean(viewerId), error: null });
    void load().catch(() => {});
    return () => { controller.abort(); if (life.current === controller) life.current = null; };
  }, [load, generation, attempt, scopeKey, viewerId]);
  const refresh = useCallback(() => { life.current?.abort(); life.current = null; setState({ scope: scopeKey, files: [], cursor: null, loading: Boolean(viewerId), error: null }); retry(value => value + 1); }, [scopeKey, viewerId]);
  return { scopeKey, error: state.scope === scopeKey ? state.error : null, files: state.scope === scopeKey ? state.files : [], loading: state.scope === scopeKey && state.loading,
    more: state.scope === scopeKey && state.cursor ? () => load(state.cursor!) : null, refresh };
}
