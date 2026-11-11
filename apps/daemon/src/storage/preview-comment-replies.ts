import type Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import type { PreviewCommentReply } from '@open-design/contracts';

/** Run after legacy comment-table rebuilds so their DROP cannot cascade replies. */
export function migratePreviewCommentReplies(db: Database.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS preview_comment_replies (
    id TEXT PRIMARY KEY,
    comment_id TEXT NOT NULL REFERENCES preview_comments(id) ON DELETE CASCADE,
    author_member_id TEXT NOT NULL,
    author_display_name TEXT,
    operation_id TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    note TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    deleted_at INTEGER,
    UNIQUE(comment_id, author_member_id, operation_id)
  );
  CREATE INDEX IF NOT EXISTS idx_preview_comment_replies_thread
    ON preview_comment_replies(comment_id, created_at, id);`);
  const columns = db.prepare('PRAGMA table_info(preview_comment_replies)').all() as { name: string }[];
  if (!columns.some(column => column.name === 'revision')) db.exec('ALTER TABLE preview_comment_replies ADD COLUMN revision INTEGER NOT NULL DEFAULT 1');
}

type ReplyRow = {
  id: string; comment_id: string; author_member_id: string; author_display_name: string | null;
  operation_id: string; request_hash: string; note: string; created_at: number; updated_at: number; revision: number; deleted_at: number | null;
};
function reply(row: ReplyRow): PreviewCommentReply {
  return { id: row.id, commentId: row.comment_id, authorMemberId: row.author_member_id,
    ...(row.author_display_name ? { authorDisplayName: row.author_display_name } : {}),
    note: row.note, createdAt: row.created_at, updatedAt: row.updated_at, revision: row.revision };
}
export function listPreviewCommentReplies(db: Database.Database, commentId: string): PreviewCommentReply[] {
  return (db.prepare('SELECT * FROM preview_comment_replies WHERE comment_id = ? AND deleted_at IS NULL ORDER BY created_at, id').all(commentId) as ReplyRow[]).map(reply);
}
export function createPreviewCommentReply(db: Database.Database, input: {
  commentId: string; authorMemberId: string; authorDisplayName?: string; operationId: string; note: string;
}): PreviewCommentReply {
  return db.transaction(() => {
    const requestHash = createHash('sha256').update(input.note).digest('hex');
    const existing = db.prepare('SELECT * FROM preview_comment_replies WHERE comment_id = ? AND author_member_id = ? AND operation_id = ?')
      .get(input.commentId, input.authorMemberId, input.operationId) as ReplyRow | undefined;
    if (existing) {
      if (existing.request_hash !== requestHash || existing.deleted_at !== null) throw new Error('REPLY_OPERATION_CONFLICT');
      return reply(existing);
    }
    const id = randomUUID(), now = Date.now();
    db.prepare(`INSERT INTO preview_comment_replies
      (id, comment_id, author_member_id, author_display_name, operation_id, request_hash, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, input.commentId, input.authorMemberId, input.authorDisplayName ?? null, input.operationId, requestHash, input.note, now, now);
    return { id, commentId: input.commentId, authorMemberId: input.authorMemberId,
      ...(input.authorDisplayName ? { authorDisplayName: input.authorDisplayName } : {}), note: input.note, createdAt: now, updatedAt: now, revision: 1 };
  })();
}
/** The query itself enforces author and parent scope, including on retries. */
export function editPreviewCommentReply(db: Database.Database, commentId: string, id: string, author: string, note: string, expectedRevision: number): PreviewCommentReply | null {
  return db.transaction(() => {
    const current = db.prepare('SELECT * FROM preview_comment_replies WHERE id = ? AND comment_id = ? AND author_member_id = ? AND deleted_at IS NULL')
      .get(id, commentId, author) as ReplyRow | undefined;
    if (!current) return null;
    // Replaying the immediately preceding successful write returns its receipt
    // without incrementing the revision. A later write makes this retry stale.
    if (current.revision === expectedRevision + 1 && current.note === note) return reply(current);
    if (current.revision !== expectedRevision) throw new Error('REPLY_REVISION_CONFLICT');
    const row = db.prepare(`UPDATE preview_comment_replies SET note = ?, updated_at = ?, revision = revision + 1
      WHERE id = ? RETURNING *`).get(note, Date.now(), id) as ReplyRow;
    return reply(row);
  })();
}
export function deletePreviewCommentReply(db: Database.Database, commentId: string, id: string, author: string, expectedRevision: number): boolean {
  // Retain the create receipt: a delayed retry must not resurrect a deleted reply.
  return db.transaction(() => {
    const current = db.prepare('SELECT * FROM preview_comment_replies WHERE id = ? AND comment_id = ? AND author_member_id = ?').get(id, commentId, author) as ReplyRow | undefined;
    if (!current) return false;
    if (current.revision !== expectedRevision) throw new Error('REPLY_REVISION_CONFLICT');
    return db.prepare(`UPDATE preview_comment_replies SET deleted_at = COALESCE(deleted_at, ?), note = ''
      WHERE id = ?`).run(Date.now(), id).changes > 0;
  })();
}
