import { withEmbeddedProject, type PinnedProject } from './pinned-project.js';
import { isIgnoredProjectDirName } from '../project-ignored-dirs.js';
import type { ProjectWatchCallback } from '../project-watchers.js';

async function snapshot(project: PinnedProject): Promise<Map<string, string>> {
  const result = new Map<string, string>(); let remaining = 10_000;
  async function visit(directory: string, depth: number) {
    if (depth > 64) throw new Error('Project watcher depth limit exceeded.');
    for (const entry of await project.entries(directory)) {
      if (--remaining < 0) throw new Error('Project watcher entry limit exceeded.');
      if (entry.name.toLowerCase() === '.ds_store' || isIgnoredProjectDirName(entry.name.toLowerCase())) continue;
      const name = directory ? `${directory}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await visit(name, depth + 1);
      else if (entry.isFile()) {
        const info = await project.stat(name);
        result.set(name, `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`);
      }
    }
  }
  await visit('', 0); return result;
}

/** Watch bot-writable trees through pinned descriptors. Chokidar's path-based
 * recursion cannot guarantee containment during concurrent directory swaps. */
export function subscribeEmbeddedFiles(projectId: string, metadata: Record<string, unknown>, notify: ProjectWatchCallback, interval = 500) {
  let stopped = false; let timer: ReturnType<typeof setTimeout> | undefined;
  let stop!: () => void;
  const stopping = new Promise<void>((resolve) => { stop = resolve; });
  let readyResolve!: () => void; let readyReject!: (error: unknown) => void;
  const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const operation = withEmbeddedProject(projectId, metadata, async (project) => {
    let previous = await snapshot(project); readyResolve();
    while (!stopped) {
      await Promise.race([new Promise<void>((resolve) => { timer = setTimeout(resolve, interval); timer.unref(); }), stopping]);
      if (timer) clearTimeout(timer);
      if (stopped) break;
      try {
        const next = await snapshot(project);
        if (stopped) break;
        const emit = (name: string, kind: 'add' | 'change' | 'unlink') => { try { notify({ type: 'file-changed', path: name, kind }); } catch { /* Isolate subscriber failures. */ } };
        for (const [name, fingerprint] of next) {
          if (!previous.has(name)) emit(name, 'add');
          else if (previous.get(name) !== fingerprint) emit(name, 'change');
        }
        for (const name of previous.keys()) if (!next.has(name)) emit(name, 'unlink');
        previous = next;
      } catch { /* Retry a whole bounded snapshot; never emit a partial tree. */ }
    }
  });
  operation.catch(readyReject);
  return { ready, unsubscribe: async () => { stopped = true; stop(); if (timer) clearTimeout(timer); await operation.catch(() => {}); } };
}
