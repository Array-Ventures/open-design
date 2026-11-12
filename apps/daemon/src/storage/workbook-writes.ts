import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { workbookWriteReceiptSchema, type WorkbookWriteReceipt } from '@open-design/contracts/runtime/workbook';

export interface WorkbookWriteIdentity { projectId: string; actor: string; operationId: string; fileName: string; sourceSha256: string; targetSha256: string }
interface Row { operation_id: string; file_name: string; request_hash: string; state: WorkbookWriteReceipt['state']; source_sha256: string; target_sha256: string; actual_sha256: string | null; version_id: string | null; source_version_id: string | null; created_at: number; updated_at: number }
export class WorkbookWriteError extends Error {
  constructor(readonly code: 'WORKBOOK_OPERATION_CONFLICT' | 'WORKBOOK_SAVE_PENDING') { super(code); }
}
export function migrateWorkbookWrites(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS workbook_writes (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    actor TEXT NOT NULL, operation_id TEXT NOT NULL, file_name TEXT NOT NULL,
    request_hash TEXT NOT NULL, source_sha256 TEXT NOT NULL, target_sha256 TEXT NOT NULL,
    actual_sha256 TEXT, version_id TEXT, source_version_id TEXT,
    state TEXT NOT NULL CHECK(state IN ('pending','applied','conflict')),
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    PRIMARY KEY(project_id,actor,operation_id),
    CHECK(state != 'applied' OR version_id IS NOT NULL)
  ); CREATE UNIQUE INDEX IF NOT EXISTS workbook_write_pending_file ON workbook_writes(project_id,file_name) WHERE state='pending'`);
}
const key = (input: WorkbookWriteIdentity) => [input.projectId, input.actor, input.operationId];
const hash = (input: WorkbookWriteIdentity) => createHash('sha256').update(JSON.stringify({ fileName: input.fileName, sourceSha256: input.sourceSha256, targetSha256: input.targetSha256 })).digest('hex');
function view(row: Row): WorkbookWriteReceipt {
  return workbookWriteReceiptSchema.parse({ operationId: row.operation_id, fileName: row.file_name, state: row.state, sourceSha256: row.source_sha256, targetSha256: row.target_sha256,
    actualSha256: row.actual_sha256, versionId: row.version_id, sourceVersionId: row.source_version_id, createdAt: row.created_at, updatedAt: row.updated_at });
}
export function readWorkbookWrite(db: Database.Database, input: WorkbookWriteIdentity): WorkbookWriteReceipt | null {
  const row = db.prepare('SELECT * FROM workbook_writes WHERE project_id=? AND actor=? AND operation_id=?').get(...key(input)) as Row | undefined;
  if (!row) return null;
  if (row.request_hash !== hash(input)) throw new WorkbookWriteError('WORKBOOK_OPERATION_CONFLICT');
  return view(row);
}
/** Persist before any workspace mutation. The exact request identity cannot be
 * reused for a newer draft, and a pending file operation fences later saves. */
export function admitWorkbookWrite(db: Database.Database, input: WorkbookWriteIdentity): WorkbookWriteReceipt {
  return db.transaction(() => {
    const existing = readWorkbookWrite(db, input); if (existing) return existing;
    if (db.prepare("SELECT 1 FROM workbook_writes WHERE project_id=? AND file_name=? AND state='pending'").get(input.projectId, input.fileName)) throw new WorkbookWriteError('WORKBOOK_SAVE_PENDING');
    const now = Date.now();
    db.prepare("INSERT INTO workbook_writes(project_id,actor,operation_id,file_name,request_hash,source_sha256,target_sha256,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'pending',?,?)")
      .run(...key(input), input.fileName, hash(input), input.sourceSha256, input.targetSha256, now, now);
    return readWorkbookWrite(db, input)!;
  })();
}
export function recordWorkbookSourceVersion(db: Database.Database, input: WorkbookWriteIdentity, versionId: string): WorkbookWriteReceipt {
  return db.transaction(() => {
    const receipt = readWorkbookWrite(db, input); if (!receipt) throw new Error('Workbook receipt is missing.');
    if (receipt.state === 'pending') db.prepare("UPDATE workbook_writes SET source_version_id=coalesce(source_version_id,?),updated_at=? WHERE project_id=? AND actor=? AND operation_id=? AND state='pending'").run(versionId, Date.now(), ...key(input));
    return readWorkbookWrite(db, input)!;
  })();
}
export function finishWorkbookWrite(db: Database.Database, input: WorkbookWriteIdentity, result: { state: 'applied'; versionId: string } | { state: 'conflict'; actualSha256: string | null }): WorkbookWriteReceipt {
  return db.transaction(() => {
    const receipt = readWorkbookWrite(db, input); if (!receipt) throw new Error('Workbook receipt is missing.');
    if (receipt.state === 'pending') db.prepare("UPDATE workbook_writes SET state=?,version_id=?,actual_sha256=?,updated_at=? WHERE project_id=? AND actor=? AND operation_id=? AND state='pending'")
      .run(result.state, result.state === 'applied' ? result.versionId : null, result.state === 'applied' ? input.targetSha256 : result.actualSha256, Date.now(), ...key(input));
    return readWorkbookWrite(db, input)!;
  })();
}
