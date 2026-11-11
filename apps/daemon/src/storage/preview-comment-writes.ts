import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import type { PreviewComment } from '@open-design/contracts';
import { canonicalCommentJson } from '@open-design/contracts';

function digest(value: unknown): string { return createHash('sha256').update(canonicalCommentJson(value)).digest('hex'); }

/** Background anchor/ordering/author-display updates are not human content edits. */
export function previewCommentEditToken(comment: Partial<PreviewComment>): string {
  const { id, projectId, conversationId, authorMemberId, authorKind, authorAppUserId, filePath, elementId, selector, label, text, position, htmlHint, style, selectionKind, memberCount, podMembers, slideIndex, note, attachments, status } = comment;
  return digest({ id, projectId, conversationId, authorMemberId, authorKind, authorAppUserId, filePath, elementId, selector, label, text, position, htmlHint, style, selectionKind, memberCount, podMembers, slideIndex, note, attachments, status });
}

/** Receipts outlive root deletion; only removing the whole project removes them. */
export function migratePreviewCommentWrites(db: Database.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS preview_comment_writes (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    conversation_id TEXT NOT NULL,
    author_member_id TEXT NOT NULL,
    operation_id TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    comment_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY(project_id, conversation_id, author_member_id, operation_id)
  )`);
}
export class CommentWriteError extends Error {
  constructor(readonly code: 'COMMENT_OPERATION_CONFLICT' | 'COMMENT_EDIT_CONFLICT' | 'COMMENT_DELETED' | 'COMMENT_FORBIDDEN') { super(code); }
}

/** Root, receipt and the caller's relay intent commit in one SQLite transaction. */
export interface PreviewCommentWriteInput {
  projectId: string; conversationId: string; author: string; operationId: string;
  id?: string; expectedEditToken?: string; target: unknown; note: unknown; attachments?: unknown;
}
function requestHash(input: PreviewCommentWriteInput) {
  return digest({ id: input.id, expectedEditToken: input.expectedEditToken, target: input.target, note: input.note, attachments: input.attachments });
}
/** A committed retry needs no filesystem work and never re-runs a mutation. */
export function replayPreviewCommentWrite(db: Database.Database, input: PreviewCommentWriteInput, read: (id: string) => PreviewComment | null): PreviewComment | null {
  const receipt = db.prepare(`SELECT request_hash, comment_id FROM preview_comment_writes
    WHERE project_id=? AND conversation_id=? AND author_member_id=? AND operation_id=?`).get(input.projectId, input.conversationId, input.author, input.operationId) as { request_hash: string; comment_id: string } | undefined;
  if (!receipt) return null;
  if (receipt.request_hash !== requestHash(input)) throw new CommentWriteError('COMMENT_OPERATION_CONFLICT');
  const current = read(receipt.comment_id);
  if (!current) throw new CommentWriteError('COMMENT_DELETED');
  return current;
}
export function writePreviewCommentOnce(db: Database.Database, input: PreviewCommentWriteInput, read: (id: string) => PreviewComment | null, mutate: () => PreviewComment): PreviewComment {
  return db.transaction(() => {
    const replay = replayPreviewCommentWrite(db, input, read);
    if (replay) return replay;
    if (input.id) {
      const current = read(input.id);
      if (!current) throw new CommentWriteError('COMMENT_DELETED');
      // The route may await image validation after its first author check.
      // Read authority again under the same transaction that performs the edit.
      if (current.authorKind === 'user' || current.authorAppUserId?.trim() || current.authorMemberId && current.authorMemberId !== input.author) throw new CommentWriteError('COMMENT_FORBIDDEN');
      if (!input.expectedEditToken || previewCommentEditToken(current) !== input.expectedEditToken) throw new CommentWriteError('COMMENT_EDIT_CONFLICT');
    }
    const result = mutate();
    db.prepare(`INSERT INTO preview_comment_writes
      (project_id, conversation_id, author_member_id, operation_id, request_hash, comment_id, created_at)
      VALUES (?,?,?,?,?,?,?)`).run(input.projectId, input.conversationId, input.author, input.operationId, requestHash(input), result.id, Date.now());
    return result;
  })();
}
