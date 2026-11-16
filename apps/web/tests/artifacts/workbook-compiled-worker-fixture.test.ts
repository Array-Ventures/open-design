// @vitest-environment jsdom
import { once } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL as NodeURL } from 'node:url';
import { Worker as NodeWorker } from 'node:worker_threads';
import { expect, it } from 'vitest';
import { compileWorkbookWorker, acquireCompiledWorkbookProductionWorker, verifyCompiledWorkbookWorker } from '../helpers/compiled-workbook-worker';
import { NodeWorkbookWorker } from '../helpers/workbook-node-worker';
import { ownWorkbookCalculationWorker } from '../../src/components/embedded/workbook/calculation-worker-owner';

it('builds the actual production entry before its unchanged runtime owner and records exact inputs/output', async () => {
  const compiled = acquireCompiledWorkbookProductionWorker();
  const entry = compiled.entry;
  let worker: NodeWorkbookWorker | undefined;
  let owner: ReturnType<typeof ownWorkbookCalculationWorker> | undefined;
  try {
    const receipt = JSON.parse(readFileSync(join(entry, '..', 'receipt.json'), 'utf8'));
    expect(receipt.esbuildVersion).toBe('0.28.0');
    const source = fileURLToPath(new NodeURL('../../src/components/embedded/workbook/workbook-formula.worker.ts', import.meta.url));
    expect(receipt.sourceEntry).toBe(source);
    expect(receipt.inputs).toContainEqual({ path: source, sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(receipt.outputSha256).toMatch(/^[a-f0-9]{64}$/);
    const second = acquireCompiledWorkbookProductionWorker();
    expect(second.entry).toBe(entry); second.release();
    worker = new NodeWorkbookWorker(true, false, false, true);
    owner = ownWorkbookCalculationWorker(() => {}, () => worker as unknown as Worker);
    expect(await owner.loaded).toBe(true); expect(owner.ready).toBe(true);
  } finally { owner?.dispose(); await worker?.thread.terminate(); compiled.release(); }
  expect(existsSync(entry)).toBe(false);
});

it('retains one immutable bundle only while its test worker leases remain live', () => {
  const first = acquireCompiledWorkbookProductionWorker(), second = acquireCompiledWorkbookProductionWorker();
  try {
    expect(second.entry).toBe(first.entry);
    first.release(); first.release(); // Idempotent close cannot consume another lease.
    expect(existsSync(second.entry)).toBe(true);
    verifyCompiledWorkbookWorker(second);
  } finally { first.release(); second.release(); }
  expect(existsSync(second.entry)).toBe(false);
});

it('refuses changed compiled output and changed source inputs instead of rebuilding behind the owner', () => {
  const root = mkdtempSync(join(tmpdir(), 'od-workbook-compile-input-'));
  const input = join(root, 'entry.ts');
  writeFileSync(input, "self.postMessage({ type: 'fixture-ready' });\n");
  let compiled: ReturnType<typeof compileWorkbookWorker> | undefined;
  try {
    const artifact = compiled = compileWorkbookWorker(input);
    verifyCompiledWorkbookWorker(artifact);
    const bytes = readFileSync(compiled.entry);
    writeFileSync(compiled.entry, '// changed output');
    expect(() => verifyCompiledWorkbookWorker(artifact)).toThrow('inputs or output changed');
    writeFileSync(compiled.entry, bytes);
    writeFileSync(input, "self.postMessage({ type: 'different-fixture' });\n");
    expect(() => verifyCompiledWorkbookWorker(artifact)).toThrow('inputs or output changed');
  } finally { compiled?.dispose(); rmSync(root, { recursive: true, force: true }); }
});

it('fails the browser build on Node-only imports before any worker is launched', () => {
  const root = mkdtempSync(join(tmpdir(), 'od-workbook-compile-node-'));
  const input = join(root, 'entry.ts');
  writeFileSync(input, "import { readFileSync } from 'node:fs'; self.postMessage(readFileSync('/not-allowed'));\n");
  try { expect(() => compileWorkbookWorker(input)).toThrow(/Could not resolve "node:fs"/); }
  finally { rmSync(root, { recursive: true, force: true }); }
});

it('keeps the existing network refusal in the real Node fixture after compilation', async () => {
  let hits = 0;
  const server = createServer((_request, response) => { hits++; response.end('owned sentinel'); });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('Owned sentinel did not bind');
  const root = mkdtempSync(join(tmpdir(), 'od-workbook-compile-network-'));
  const input = join(root, 'entry.ts');
  writeFileSync(input, `void fetch('http://127.0.0.1:${address.port}/must-not-run');\n`);
  let compiled: ReturnType<typeof compileWorkbookWorker> | undefined;
  let thread: NodeWorker | undefined;
  try {
    compiled = compileWorkbookWorker(input);
    thread = new NodeWorker(new NodeURL('../fixtures/workbook-formula-rpc-worker.ts', import.meta.url), {
      workerData: { packageRoot: realpathSync(fileURLToPath(new NodeURL('../../node_modules/@univerjs/preset-sheets-core/package.json', import.meta.url))), productionEntry: compiled.entry },
      execArgv: ['--experimental-transform-types', '--no-warnings'],
      resourceLimits: { maxOldGenerationSizeMb: 192, maxYoungGenerationSizeMb: 32 },
    });
    const outcome = await Promise.race([
      once(thread, 'error').then(([error]) => ({ kind: 'error' as const, error })),
      new Promise<{ kind: 'exit'; code: number }>(done => thread!.once('exit', code => done({ kind: 'exit', code }))),
    ]);
    expect(outcome.kind).toBe('error');
    if (outcome.kind === 'error') expect(outcome.error.message).toBe('Fixture formulas must not fetch network data.');
    expect(hits).toBe(0);
  } finally {
    await thread?.terminate(); compiled?.dispose(); rmSync(root, { recursive: true, force: true });
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
