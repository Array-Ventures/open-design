import type { PreviewCommentRepliesResponse, PreviewCommentReply, PreviewCommentReplyCreateRequest, PreviewCommentReplyEditRequest, PreviewCommentReplyResponse } from '@open-design/contracts';

export class CommentReplyError extends Error {
  constructor(readonly status: number) {
    super(status === 409 ? 'This reply changed. Reload the thread before editing.' : 'The reply could not be saved. Your draft is still available.');
  }
}
function threadUrl(projectId: string, commentId: string) {
  const project = encodeURIComponent(projectId);
  return `/api/projects/${project}/conversations/${project}/comments/${encodeURIComponent(commentId)}/replies`;
}
async function request<T>(url: string, method: string, signal: AbortSignal, body?: unknown): Promise<T> {
  const response = await fetch(url, { method, signal, cache: 'no-store',
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
  if (!response.ok) throw new CommentReplyError(response.status);
  return response.json() as Promise<T>;
}
export async function fetchCommentReplies(projectId: string, commentId: string, signal: AbortSignal): Promise<PreviewCommentReply[]> {
  return (await request<PreviewCommentRepliesResponse>(threadUrl(projectId, commentId), 'GET', signal)).replies;
}
export async function createCommentReply(projectId: string, commentId: string, input: PreviewCommentReplyCreateRequest, signal: AbortSignal): Promise<PreviewCommentReply> {
  return (await request<PreviewCommentReplyResponse>(threadUrl(projectId, commentId), 'POST', signal, input)).reply;
}
export async function editCommentReply(projectId: string, commentId: string, replyId: string, input: PreviewCommentReplyEditRequest, signal: AbortSignal): Promise<PreviewCommentReply> {
  return (await request<PreviewCommentReplyResponse>(`${threadUrl(projectId, commentId)}/${encodeURIComponent(replyId)}`, 'PATCH', signal, input)).reply;
}
export async function deleteCommentReply(projectId: string, commentId: string, replyId: string, expectedRevision: number, signal: AbortSignal): Promise<void> {
  await request(`${threadUrl(projectId, commentId)}/${encodeURIComponent(replyId)}`, 'DELETE', signal, { expectedRevision });
}
