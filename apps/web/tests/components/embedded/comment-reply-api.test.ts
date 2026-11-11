import { afterEach, expect, it, vi } from 'vitest';
import { CommentReplyError, createCommentReply, deleteCommentReply, editCommentReply, fetchCommentReplies } from '../../../src/components/embedded/comment-reply-api';

afterEach(() => vi.unstubAllGlobals());
it('uses the selected project container and preserves the retry identity and lifetime', async () => {
  const reply = { id: 'reply', commentId: 'root', note: 'Keep this', revision: 2 };
  const fetcher = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ reply }), { status: 200 }));
  vi.stubGlobal('fetch', fetcher);
  const signal = new AbortController().signal;
  const input = { operationId: 'stable-retry-id', note: 'Keep this' };
  expect(await createCommentReply('project', 'root/a', input, signal)).toEqual(reply);
  expect(fetcher).toHaveBeenCalledWith('/api/projects/project/conversations/project/comments/root%2Fa/replies', expect.objectContaining({ method: 'POST', signal, body: JSON.stringify(input) }));
  await editCommentReply('project', 'root', 'reply/a', { expectedRevision: 2, note: 'Newer' }, signal);
  expect(fetcher).toHaveBeenLastCalledWith(expect.stringContaining('/replies/reply%2Fa'), expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ expectedRevision: 2, note: 'Newer' }) }));
  await deleteCommentReply('project', 'root', 'reply', 3, signal);
  expect(fetcher).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ method: 'DELETE', body: JSON.stringify({ expectedRevision: 3 }) }));
});
it('keeps conflicts and transport failures observable instead of claiming success', async () => {
  const signal = new AbortController().signal;
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 409 })));
  await expect(editCommentReply('p', 'c', 'r', { expectedRevision: 1, note: 'Draft' }, signal)).rejects.toMatchObject({ status: 409 });
  await expect(fetchCommentReplies('p', 'c', signal)).rejects.toBeInstanceOf(CommentReplyError);
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('Closed', 'AbortError')));
  await expect(fetchCommentReplies('p', 'c', signal)).rejects.toMatchObject({ name: 'AbortError' });
});
