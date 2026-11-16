import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, URL as NodeURL } from 'node:url';
import type { Metafile } from 'esbuild';

const repoRoot = fileURLToPath(new NodeURL('../../../..', import.meta.url));
const productionEntry = fileURLToPath(new NodeURL('../../src/components/embedded/workbook/workbook-formula.worker.ts', import.meta.url));
const ownedRoots = new Set<string>();
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
process.once('exit', () => { for (const root of ownedRoots) rmSync(root, { recursive: true, force: true }); });

export interface CompiledWorkbookWorker {
  entry: string;
  receipt: {
    esbuildVersion: string;
    sourceEntry: string;
    outputSha256: string;
    inputs: { path: string; sha256: string }[];
  };
  dispose(): void;
}

/** Test build boundary, matching the app's precompiled classic worker rather
 * than charging Node/tsx source transformation to the runtime readiness gate.
 * This is not a claim that esbuild output equals the Next/Turbopack artifact. */
export function compileWorkbookWorker(entry: string, runCompiler: typeof execFileSync = execFileSync): CompiledWorkbookWorker {
  const root = mkdtempSync(join(tmpdir(), 'od-workbook-production-worker-'));
  ownedRoots.add(root);
  const dispose = () => { rmSync(root, { recursive: true, force: true }); ownedRoots.delete(root); };
  try {
    const output = join(root, 'worker.cjs');
    const metadata = join(root, 'build.json');
    runCompiler(process.execPath, ['--experimental-strip-types',
      fileURLToPath(new NodeURL('./build-workbook-worker.ts', import.meta.url)), entry, output, metadata],
    { cwd: repoRoot, stdio: 'pipe', timeout: 15_000, maxBuffer: 1024 * 1024, killSignal: 'SIGKILL' });
    const result = JSON.parse(readFileSync(metadata, 'utf8')) as { version: string; metafile: Metafile };
    const receipt = {
      esbuildVersion: result.version, sourceEntry: resolve(entry),
      outputSha256: digest(readFileSync(output)),
      inputs: Object.keys(result.metafile.inputs).map(path => ({
        path: resolve(repoRoot, path), sha256: digest(readFileSync(resolve(repoRoot, path))),
      })),
    };
    writeFileSync(join(root, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
    return { entry: output, receipt, dispose };
  } catch (error) { dispose(); throw error; }
}

/** Refuse stale/tampered fixture artifacts; never silently rebuild or retry an
 * owner that already failed. Source compilation happens before owner creation. */
export function verifyCompiledWorkbookWorker(worker: Pick<CompiledWorkbookWorker, 'entry' | 'receipt'>): void {
  if (digest(readFileSync(worker.entry)) !== worker.receipt.outputSha256
    || worker.receipt.inputs.some(input => digest(readFileSync(input.path)) !== input.sha256)) {
    throw Error('Compiled workbook worker inputs or output changed.');
  }
}

type WorkerLease = Pick<CompiledWorkbookWorker, 'entry' | 'receipt'> & { release(): void };

/** The same lease algorithm is used by the fixed production-source pool and
 * isolated fault controls. A control cannot replace the production builder. */
export function createCompiledWorkbookWorkerPool(build: () => CompiledWorkbookWorker): () => WorkerLease {
  let currentPool: { artifact: CompiledWorkbookWorker; users: number } | undefined;
  return () => {
    currentPool ??= { artifact: build(), users: 0 };
    const current = currentPool;
    try { verifyCompiledWorkbookWorker(current.artifact); }
    catch (error) {
      if (current.users === 0) {
        current.artifact.dispose();
        if (currentPool === current) currentPool = undefined;
      }
      throw error;
    }
    current.users++;
    let released = false;
    return { entry: current.artifact.entry, receipt: current.artifact.receipt, release() {
      if (released) return;
      released = true;
      if (--current.users === 0) {
        current.artifact.dispose();
        if (currentPool === current) currentPool = undefined;
      }
    } };
  };
}

const productionPool = createCompiledWorkbookWorkerPool(() => compileWorkbookWorker(productionEntry));
export function acquireCompiledWorkbookProductionWorker(): WorkerLease { return productionPool(); }
