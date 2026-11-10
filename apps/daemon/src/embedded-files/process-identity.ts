import { lstat, readFile } from 'node:fs/promises';

export type StudioProcessIdentity = { pid: number; uid: number; startTicks: string };

/** Capture directly from a child owned by the lifecycle controller. A caller
 * must hold its exclusive lifecycle lock through stop, capture and restart. */
export async function studioProcessIdentity(pid: number): Promise<StudioProcessIdentity | null> {
  if (process.platform !== 'linux' || !process.getuid) throw new Error('Studio process identity verification requires Linux.');
  if (!Number.isSafeInteger(pid) || pid < 1) throw new Error('Invalid Studio process identity.');
  try {
    const before = await readFile(`/proc/${pid}/stat`, 'utf8');
    const uid = (await lstat(`/proc/${pid}`)).uid;
    const after = await readFile(`/proc/${pid}/stat`, 'utf8');
    // comm may itself contain spaces and parentheses. Fields after the final
    // closing parenthesis start with state (field 3); starttime is field 22.
    const ticks = (value: string) => value.slice(value.lastIndexOf(')') + 2).trim().split(/\s+/)[19];
    const startTicks = ticks(after);
    if (!startTicks || !/^\d+$/.test(startTicks) || ticks(before) !== startTicks || uid !== process.getuid()) throw new Error('Studio process identity changed or is not owned by this controller.');
    return { pid, uid, startTicks };
  } catch (error) {
    if (['ENOENT', 'ESRCH'].includes((error as NodeJS.ErrnoException).code ?? '')) return null;
    throw error;
  }
}

export async function assertStudioProcessExited(identity: StudioProcessIdentity): Promise<void> {
  if (!Number.isSafeInteger(identity.pid) || identity.pid < 1 || !Number.isSafeInteger(identity.uid) || identity.uid !== process.getuid?.() || !/^\d+$/.test(identity.startTicks)) throw new Error('Invalid Studio process receipt.');
  // A PID reused by another OS user is also a different generation. Do not
  // inspect or signal it as if it were our old supervised child.
  const ownerChanged = async () => {
    try { return (await lstat(`/proc/${identity.pid}`)).uid !== identity.uid; }
    catch (error) { if (['ENOENT', 'ESRCH'].includes((error as NodeJS.ErrnoException).code ?? '')) return true; throw error; }
  };
  if (await ownerChanged()) return;
  let current;
  try { current = await studioProcessIdentity(identity.pid); }
  catch (error) { if (await ownerChanged()) return; throw error; }
  if (current && current.uid === identity.uid && current.startTicks === identity.startTicks) throw new Error('The supervised Studio process is still alive. Stop it before capturing storage.');
}
