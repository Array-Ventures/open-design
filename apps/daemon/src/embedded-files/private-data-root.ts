import { closeSync, constants, fchmodSync, fstatSync, openSync, realpathSync } from 'node:fs';
import path from 'node:path';

/** Embedded state includes SQLite and retained source versions. Keep its
 * ancestor private even when upstream creates group-writable descendants. */
export function secureEmbeddedDataRoot(directory: string): void {
  if (process.platform !== 'linux' || !process.getuid) throw new Error('Embedded Studio requires Linux storage isolation.');
  const fd = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    const info = fstatSync(fd);
    if (!info.isDirectory() || info.uid !== process.getuid() || realpathSync(`/proc/self/fd/${fd}`) !== path.resolve(directory)) throw new Error('Embedded Studio data must be an owned canonical directory.');
    fchmodSync(fd, 0o700);
  } finally { closeSync(fd); }
}
