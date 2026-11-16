// @vitest-environment jsdom
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, it } from 'vitest';
import { compileWorkbookWorker, createCompiledWorkbookWorkerPool } from '../helpers/compiled-workbook-worker';

it('removes a fresh unleased artifact when its first verification fails, retaining the original refusal', () => {
  const root = mkdtempSync(join(tmpdir(), 'od-workbook-first-lease-'));
  const input = join(root, 'entry.ts');
  writeFileSync(input, "self.postMessage({ type: 'fixture-ready' });\n");
  let corrupt = true;
  const outputs: string[] = [];
  const acquire = createCompiledWorkbookWorkerPool(() => {
    const artifact = compileWorkbookWorker(input);
    outputs.push(artifact.entry);
    if (corrupt) writeFileSync(artifact.entry, '// physically changed before first lease');
    return artifact;
  });
  let unexpected: ReturnType<typeof acquire> | undefined;
  try {
    expect(() => { unexpected = acquire(); }).toThrow('Compiled workbook worker inputs or output changed.');
    const failedOutput = outputs[0]!;
    expect(existsSync(dirname(failedOutput))).toBe(false);
    corrupt = false;
    const next = acquire();
    try { expect(next.entry).not.toBe(failedOutput); expect(existsSync(next.entry)).toBe(true); }
    finally { next.release(); }
    expect(existsSync(dirname(next.entry))).toBe(false);
  } finally { unexpected?.release(); rmSync(root, { recursive: true, force: true }); }
});

it('bounds the native compiler child and removes its owned root on an injected fatal timeout', () => {
  const error = Object.assign(new Error('Owned fixture compiler timed out'), { code: 'ETIMEDOUT' });
  let observed: unknown[] = [];
  const runner = (...args: unknown[]): never => { observed = args; throw error; };
  let caught: unknown;
  try { compileWorkbookWorker('/owned-fixture-input.ts', runner); }
  catch (failure) { caught = failure; }
  expect(caught).toBe(error);
  expect(observed[2]).toMatchObject({ timeout: 15_000, maxBuffer: 1024 * 1024, killSignal: 'SIGKILL', stdio: 'pipe' });
  const output = (observed[1] as string[])[3]!;
  expect(existsSync(dirname(output))).toBe(false);
});
