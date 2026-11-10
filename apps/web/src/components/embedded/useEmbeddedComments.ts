import { useCallback, useEffect, useRef, useState } from 'react';
import { deletePreviewComment, fetchPreviewComments, patchPreviewCommentSortKey, uploadProjectFiles, upsertPreviewComment } from '../../providers/registry';
import type { ChatCommentAttachment, PreviewComment, PreviewCommentTarget } from '../../types';
import type { CommentSendResult } from '../comment-send-result';
import { commentContextText, stageHostContext } from './host-context';

export function useEmbeddedComments(projectId: string) {
  const [comments, setComments] = useState<PreviewComment[]>([]);
  const [state, setState] = useState<'loading' | 'error' | 'success'>('loading');
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  const generation = useRef(0);
  const mounted = useRef(true);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    try {
      const next = await fetchPreviewComments(projectId, projectId);
      if (mounted.current && generation.current === request) { setComments(next); setState('success'); }
    } catch { if (mounted.current && generation.current === request) setState('error'); }
  }, [projectId]);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    // Thin events are the fast path; this reconciles after a missed event.
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 30_000);
    return () => { mounted.current = false; generation.current++; clearInterval(timer); };
  }, [refresh]);
  const send = useCallback(async (attachments: ChatCommentAttachment[], images: File[] = []): Promise<CommentSendResult> => {
    let extra = '';
    if (images.length) {
      const result = await uploadProjectFiles(projectId, images, '.studio-comments');
      if (result.failed.length || result.uploaded.length !== images.length) { setNotice('Images could not be saved. Your request was not added to chat.'); return { status: 'rejected', commentIds: [] }; }
      extra = '\n' + result.uploaded.map((image) => `Attached image: ${image.path}`).join('\n');
    }
    const accepted = await stageHostContext(projectId, commentContextText(attachments) + extra);
    setNotice(accepted ? 'Added to your chat draft.' : 'Open a bot or group chat beside Studio, then try adding this request again.');
    return { status: accepted ? 'queued' : 'rejected', commentIds: accepted ? attachments.map((item) => item.id) : [] };
  }, [projectId]);
  const save = useCallback(async (target: PreviewCommentTarget, note: string, attach: boolean, images: File[] = [], commentId?: string) => {
    const existing = comments.find((item) => item.id === commentId);
    let attachments = existing?.attachments ?? [];
    if (images.length) {
      const result = await uploadProjectFiles(projectId, images, '.studio-comments');
      if (result.failed.length || result.uploaded.length !== images.length) { setNotice('Images could not be saved. Your comment was not saved.'); return null; }
      attachments = [...attachments, ...result.uploaded.map((item) => ({ path: item.path, name: item.name }))];
    }
    const saved = await upsertPreviewComment(projectId, projectId, { ...(commentId ? { id: commentId } : {}), target, note, attachments });
    if (!saved) { setNotice('Comment could not be saved. Your draft is still available.'); return null; }
    generation.current++;
    setComments((current) => [...current.filter((item) => item.id !== saved.id), saved]);
    if (attach) {
      const accepted = await stageHostContext(projectId, `File: ${target.filePath}\nSelector: ${target.selector}\nCurrent text: ${target.text}\nRequested change: ${note}\n${attachments.map((image) => `Attached image: ${image.path}`).join('\n')}`);
      setNotice(accepted ? 'Comment saved and added to your Evebot draft.' : 'Comment saved. Open a chat to add it to a draft.');
    }
    return saved;
  }, [projectId, comments]);
  const remove = useCallback(async (id: string) => {
    const ok = await deletePreviewComment(projectId, projectId, id);
    if (ok) { generation.current++; setComments((current) => current.filter((item) => item.id !== id)); }
    else setNotice('Comment could not be removed. Only its author can change it.');
    return ok;
  }, [projectId]);
  const reorder = useCallback(async (id: string, sortKey: number) => {
    const saved = await patchPreviewCommentSortKey(projectId, projectId, id, sortKey);
    if (saved) { generation.current++; setComments((current) => current.map((item) => item.id === saved.id ? saved : item)); }
    else { setNotice('Comment order could not be saved.'); await refresh(); }
  }, [projectId, refresh]);
  return { comments, state, notice, refresh, save, remove, reorder, send };
}
