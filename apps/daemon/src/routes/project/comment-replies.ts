import type { Express, Request, Response } from 'express';
import type Database from 'better-sqlite3';
import { SHARE_COMMENT_MAX_BYTES, type PreviewComment } from '@open-design/contracts';
import { jsonBodyByteLength } from '../../http/json-body-size.js';
import { createPreviewCommentReply, deletePreviewCommentReply, editPreviewCommentReply, listPreviewCommentReplies } from '../../storage/preview-comment-replies.js';
import { CommentImageError, validateCommentImages } from './comment-images.js';

type ReplyParams = { id: string; cid: string; commentId: string; replyId: string };
type Authority = { comment: PreviewComment; author: string | undefined; displayName: string | undefined };
export function registerEmbeddedCommentReplyRoutes(app: Express, db: Database.Database,
  authorize: (req: Request<ReplyParams>, res: Response, write: boolean) => Promise<Authority | null>) {
  // Evebot owns workspace sharing. Do not silently add unsynchronized replies
  // to the upstream collaboration protocol, which has no reply wire format.
  if (process.env.OD_EMBEDDED_STUDIO !== '1') return;
  const base = '/api/projects/:id/conversations/:cid/comments/:commentId/replies';
  app.get<ReplyParams>(base, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const authority = await authorize(req, res, false);
    if (!authority) return;
    res.json({ replies: listPreviewCommentReplies(db, authority.comment.id) });
  });
  const mutate = (method: 'post' | 'patch' | 'delete') => {
    app[method]<ReplyParams>(method === 'post' ? base : `${base}/:replyId`, async (req, res) => {
      const authority = await authorize(req, res, true);
      if (!authority) return;
      if (!authority.author) return res.status(401).json({ error: 'identity required' });
      if (jsonBodyByteLength(req) > SHARE_COMMENT_MAX_BYTES) return res.status(413).json({ error: 'reply request too large' });
      const { comment, author } = authority;
      const expectedRevision = req.body?.expectedRevision;
      if (method !== 'post' && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)) return res.status(400).json({ error: 'reply revision required' });
      try {
        if (method === 'delete') {
          if (!deletePreviewCommentReply(db, comment.id, req.params.replyId, author, expectedRevision)) return res.status(404).json({ error: 'reply not found' });
          return res.json({ ok: true });
        }
        const note = req.body?.note;
        if (typeof note !== 'string') return res.status(400).json({ error: 'reply text required' });
        const attachments = req.body?.attachments === undefined ? undefined : await validateCommentImages(db, req.params.id, req.body.attachments);
        if (method === 'patch') {
          const reply = editPreviewCommentReply(db, comment.id, req.params.replyId, author, note, expectedRevision, attachments);
          return reply ? res.json({ reply }) : res.status(404).json({ error: 'reply not found' });
        }
        const operationId = req.body?.operationId;
        if (typeof operationId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(operationId)) return res.status(400).json({ error: 'operation UUID required' });
        return res.json({ reply: createPreviewCommentReply(db, { commentId: comment.id, authorMemberId: author, ...(authority.displayName ? { authorDisplayName: authority.displayName } : {}), ...(attachments ? { attachments } : {}), operationId, note }) });
      } catch (error) {
        if (error instanceof CommentImageError || error instanceof Error && error.message === 'REPLY_CONTENT_REQUIRED') return res.status(400).json({ error: error instanceof CommentImageError ? error.message : 'Reply text or images required' });
        if (error instanceof Error && error.message === 'REPLY_REVISION_CONFLICT') return res.status(409).json({ error: 'reply changed; reload before editing' });
        if (error instanceof Error && error.message === 'REPLY_OPERATION_CONFLICT') return res.status(409).json({ error: 'reply operation already used' });
        throw error;
      }
    });
  };
  mutate('post'); mutate('patch'); mutate('delete');
}
