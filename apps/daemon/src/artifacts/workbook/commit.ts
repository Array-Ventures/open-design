import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { workbookWriteIdentitySchema, type WorkbookWriteReceipt } from '@open-design/contracts/runtime/workbook';
import { withProjectFileVersionBytesLock } from '../../project-file-versions.js';
import { admitWorkbookWrite, finishWorkbookWrite, readWorkbookWrite, recordWorkbookSourceVersion, type WorkbookWriteIdentity } from '../../storage/workbook-writes.js';
import { requireWorkbookHistoryBytes } from './history-storage.js';

export interface WorkbookCommitInput { projectId: string; actor: string; operationId: string; fileName: string; sourceSha256: string; bytes: Buffer }
export interface WorkbookCommitFiles {
  authorize: () => Promise<void>;
  /** Recovery after revocation may settle a receipt but must not install bytes. */
  mayWrite?: boolean;
  read: () => Promise<Buffer | null>;
  /** The adapter must use the registered descriptor-pinned project writer and
   * recheck the expected digest at its last supported commit boundary. */
  write: (bytes: Buffer, expectedSha256: string) => Promise<void>;
}
export class WorkbookSourceChangedError extends Error { readonly code = 'WORKBOOK_SOURCE_CHANGED'; }
const digest = (value: Buffer | null) => value === null ? null : createHash('sha256').update(value).digest('hex');

/** Receipt/history coordinator only. The caller retains the prepared bytes in
 * durable storage for retries, verifies authority and supplies contained file
 * operations. This does not claim kernel CAS against unmanaged sandbox writes. */
export async function commitWorkbook(db: Database.Database, projectsRoot: string, raw: WorkbookCommitInput, metadata: unknown, files: WorkbookCommitFiles): Promise<WorkbookWriteReceipt> {
  const bytes = requireWorkbookHistoryBytes(raw.bytes), targetSha256 = digest(bytes)!;
  workbookWriteIdentitySchema.parse({ operationId: raw.operationId, sourceSha256: raw.sourceSha256 });
  if (!raw.actor || raw.actor.trim() !== raw.actor || raw.actor.length > 200) throw new Error('Invalid workbook actor identity.');
  return withProjectFileVersionBytesLock(projectsRoot, raw.projectId, raw.fileName, metadata, async history => {
    await files.authorize();
    const identity: WorkbookWriteIdentity = { projectId: raw.projectId, actor: raw.actor, operationId: raw.operationId, fileName: history.safeName, sourceSha256: raw.sourceSha256, targetSha256 };
    let receipt = readWorkbookWrite(db, identity) ?? admitWorkbookWrite(db, identity);
    // Terminal replay does no file I/O and never changes the history head. A
    // later revision or renamed file cannot make an old receipt run again.
    if (receipt.state !== 'pending') return receipt;
    let current = await files.read(), actual = digest(current);
    if (actual !== identity.sourceSha256 && actual !== targetSha256) return finishWorkbookWrite(db, identity, { state: 'conflict', actualSha256: actual });
    if (actual !== targetSha256) {
      if (files.mayWrite === false) return finishWorkbookWrite(db, identity, { state: 'conflict', actualSha256: actual });
      const prior = await history.ensureCurrentVersion(current!, { source: 'manual', label: 'Before workbook edit' });
      if (!prior) throw new Error('Workbook source history was not captured.');
      receipt = recordWorkbookSourceVersion(db, identity, prior.id);
      await files.authorize();
      current = await files.read(); actual = digest(current);
      if (actual !== identity.sourceSha256) return finishWorkbookWrite(db, identity, { state: 'conflict', actualSha256: actual });
      try { await files.write(bytes, identity.sourceSha256); }
      catch (error) {
        if (!(error instanceof WorkbookSourceChangedError)) throw error;
        return finishWorkbookWrite(db, identity, { state: 'conflict', actualSha256: digest(await files.read()) });
      }
      current = await files.read(); actual = digest(current);
      if (actual !== targetSha256) return finishWorkbookWrite(db, identity, { state: 'conflict', actualSha256: actual });
    }
    const version = await history.ensureCurrentVersion(bytes, { source: 'manual', label: 'Saved workbook', ...(receipt.sourceVersionId ? { parentVersionId: receipt.sourceVersionId } : {}) });
    if (!version) throw new Error('Workbook saved history was not captured.');
    return finishWorkbookWrite(db, identity, { state: 'applied', versionId: version.id });
  });
}
