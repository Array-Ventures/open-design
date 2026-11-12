import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { validateProjectPath } from '../../projects.js';
import { readPinnedFile, withEmbeddedProject, writePinnedFile } from '../../embedded-files/pinned-project.js';
import { commitWorkbook, WorkbookSourceChangedError, type WorkbookCommitInput } from './commit.js';
import { WORKBOOK_HISTORY_BYTES } from './history-storage.js';

/** Contained adapter for the native host's eventual authorized save endpoint.
 * It never accepts a caller-selected host directory or parses XLSX in process.
 * Authorization is supplied by the route's verified current workspace context. */
export async function commitEmbeddedWorkbook(db: Database.Database, projectsRoot: string, input: WorkbookCommitInput, metadata: Record<string, unknown>, authorize: () => Promise<void>, mode: 'commit' | 'reconcile' = 'commit') {
  const fileName = validateProjectPath(input.fileName) as string;
  return commitWorkbook(db, projectsRoot, { ...input, fileName }, metadata, {
    authorize,
    mayWrite: mode === 'commit',
    read: async () => {
      try { return await withEmbeddedProject(input.projectId, metadata, async project => (await project.read(fileName, WORKBOOK_HISTORY_BYTES)).buffer); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
    },
    write: async (bytes, expected) => withEmbeddedProject(input.projectId, metadata, project => project.withParent(fileName, false, async (parent, leaf) => {
      let observed: Buffer;
      try { observed = (await readPinnedFile(parent, leaf, WORKBOOK_HISTORY_BYTES)).buffer; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new WorkbookSourceChangedError('The workbook was removed before save.'); throw error; }
      if (createHash('sha256').update(observed).digest('hex') !== expected) throw new WorkbookSourceChangedError('The workbook changed before save.');
      await writePinnedFile(parent, leaf, bytes);
    })),
  });
}
