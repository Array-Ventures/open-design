import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

/** Disposable fixture children only. Always reap the exact process we spawned,
 * including failure/timeout, before the caller removes its fixture directory. */
export async function killWorkbookFixtureAt(script: URL, configuration: string, checkpoint: string): Promise<void> {
  const child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(script), '--child', configuration], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let stderr = '', timer: ReturnType<typeof setTimeout> | undefined;
  child.stderr!.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-64 * 1024); });
  const exit = once(child, 'exit');
  try {
    const message = await Promise.race([
      once(child, 'message').then(([message]) => message as { checkpoint: string }),
      exit.then(() => { throw new Error(`Workbook fixture exited before its mark: ${stderr}`); }),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error(`Workbook checkpoint timed out: ${stderr}`)), 15_000); }),
    ]);
    assert.equal(message.checkpoint, checkpoint); child.kill('SIGKILL');
    const [, signal] = await exit; assert.equal(signal, 'SIGKILL');
  } finally {
    if (timer) clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await exit.catch(() => {});
  }
}
