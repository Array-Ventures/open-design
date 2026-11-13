import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { afterEach, expect, it } from 'vitest';
import { vi } from 'vitest';
import * as filesystem from 'node:fs/promises';
vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>();
  return { ...actual, lstat: vi.fn(actual.lstat) };
});
import { assertStudioProcessExited, studioProcessIdentity } from '../../src/embedded-files/process-identity.js';

let child: ChildProcess | undefined;
afterEach(async () => {
  vi.mocked(filesystem.lstat).mockReset();
  if (child && child.exitCode === null && child.signalCode === null) { const exit = once(child, 'exit'); child.kill('SIGTERM'); await exit; }
});

it('recognizes PID reuse by a different owner without inspecting that process', async () => {
  const identity = (await studioProcessIdentity(process.pid))!;
  const metadata = await filesystem.lstat(`/proc/${process.pid}`);
  vi.mocked(filesystem.lstat).mockResolvedValueOnce(Object.assign(metadata, { uid: identity.uid + 1 }));
  await expect(assertStudioProcessExited(identity)).resolves.toBeUndefined();
});

it('rechecks ownership if a PID is reused while its identity is being read', async () => {
  const identity = (await studioProcessIdentity(process.pid))!;
  const original = await filesystem.lstat(`/proc/${process.pid}`);
  const changed = Object.assign(await filesystem.lstat(`/proc/${process.pid}`), { uid: identity.uid + 1 });
  vi.mocked(filesystem.lstat).mockResolvedValueOnce(original).mockResolvedValueOnce(changed).mockResolvedValueOnce(changed);
  await expect(assertStudioProcessExited(identity)).resolves.toBeUndefined();
});

it('requires actual supervised process exit even when no HTTP listener exists', async () => {
  child = spawn(process.execPath, ['-e', 'process.send("ready");setInterval(()=>{},1000)'], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  await once(child, 'message');
  const identity = await studioProcessIdentity(child.pid!);
  expect(identity).toMatchObject({ pid: child.pid, uid: process.getuid!() });
  await expect(assertStudioProcessExited(identity!)).rejects.toThrow('still alive');
  const exit = once(child, 'exit'); child.kill('SIGTERM'); await exit;
  await expect(assertStudioProcessExited(identity!)).resolves.toBeUndefined();
});

it('distinguishes a different process generation and rejects malformed receipts', async () => {
  const identity = (await studioProcessIdentity(process.pid))!;
  await expect(assertStudioProcessExited(identity)).rejects.toThrow('still alive');
  await expect(assertStudioProcessExited({ ...identity, startTicks: String(BigInt(identity.startTicks) + 1n) })).resolves.toBeUndefined();
  await expect(studioProcessIdentity(0)).rejects.toThrow('Invalid');
  await expect(assertStudioProcessExited({ ...identity, startTicks: 'invalid' })).rejects.toThrow('Invalid');
});
