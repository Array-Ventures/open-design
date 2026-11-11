import { useCallback, useEffect, useRef, useState } from 'react';
import { deletePreviewComment, fetchPreviewComments, patchPreviewCommentSortKey, uploadProjectFiles, upsertPreviewComment } from '../../providers/registry';
import { commentsToAttachments } from '../../comments';
import type { ChatCommentAttachment, PreviewComment, PreviewCommentTarget } from '../../types';
import type { CommentSendResult } from '../comment-send-result';
import { commentFeedbackContext, commentFeedbackNote, prepareHostFeedback, stageHostContext } from './host-context';
import { FeedbackImageUpload } from './feedback-image-upload';

export function useEmbeddedComments(projectId: string) {
  const pendingSend = useRef(new FeedbackImageUpload());
  const pendingSave = useRef<{ key: string; images: File[]; comment: PreviewComment; operationId: string } | null>(null);
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
    const preparationId = await prepareHostFeedback(projectId);
    if (!preparationId) return { status: 'rejected', commentIds: [] };
    const text = commentFeedbackNote(attachments);
    const feedback = commentFeedbackContext(attachments);
    let prepared: Awaited<ReturnType<FeedbackImageUpload['prepare']>>;
    try { prepared = await pendingSend.current.prepare(projectId, images, JSON.stringify([text, feedback])); }
    catch { setNotice('Images could not be saved. Your request was not added to chat.'); return { status: 'rejected', commentIds: [] }; }
    const imagePaths = [...new Set([...prepared.paths, ...attachments.flatMap(item => [item.screenshotPath, ...(item.imageAttachments ?? []).map(image => image.path)]).filter((path): path is string => Boolean(path && /^(?:\.|_)studio-comments\//.test(path)))])];
    let failure: string | undefined;
    const accepted = await stageHostContext(projectId, text, prepared.operationId, preparationId, imagePaths, feedback, message => { failure = message; });
    if (accepted) pendingSend.current.clear();
    setNotice(accepted ? 'Added to your chat draft.' : failure ?? 'The feedback could not be added. Try again.');
    return { status: accepted ? 'queued' : 'rejected', commentIds: accepted ? attachments.map((item) => item.id) : [] };
  }, [projectId]);
  const save = useCallback(async (target: PreviewCommentTarget, note: string, attach: boolean, images: File[] = [], commentId?: string) => {
    const preparationId = attach ? await prepareHostFeedback(projectId) : null;
    if (attach && !preparationId) return null;
    const key = JSON.stringify([target.filePath, target.elementId, target.selector, target.slideIndex, target.selectionKind, target.text, target.label, note]);
    const pending = pendingSave.current;
    const cached = pending && pending.comment.id === commentId && pending.key === key && (images.length === 0 || (pending.images.length === images.length && pending.images.every((file, index) => file === images[index]))) ? pending : null;
    const existing = cached?.comment ?? comments.find((item) => item.id === commentId);
    let attachments = existing?.attachments ?? [];
    if (images.length && !cached) {
      const result = await uploadProjectFiles(projectId, images, '_studio-comments');
      if (result.failed.length || result.uploaded.length !== images.length) { setNotice('Images could not be saved. Your comment was not saved.'); return null; }
      attachments = [...attachments, ...result.uploaded.map((item) => ({ path: item.path, name: item.name }))];
    }
    const saved = cached?.comment ?? await upsertPreviewComment(projectId, projectId, { ...(commentId ? { id: commentId } : {}), target, note, attachments });
    if (!saved) { setNotice('Comment could not be saved. Your draft is still available.'); return null; }
    const operationId = cached?.operationId ?? crypto.randomUUID();
    pendingSave.current = { key, images, comment: saved, operationId };
    generation.current++;
    setComments((current) => [...current.filter((item) => item.id !== saved.id), saved]);
    if (attach) {
      const selected = commentsToAttachments([saved]);
      let failure: string | undefined;
      const accepted = await stageHostContext(projectId, commentFeedbackNote(selected), operationId, preparationId ?? undefined, [...new Set(commentsToAttachments([saved]).flatMap(item => [item.screenshotPath, ...(item.imageAttachments ?? []).map(image => image.path)]).filter((path): path is string => Boolean(path && /^(?:\.|_)studio-comments\//.test(path))))], commentFeedbackContext(selected), message => { failure = message; });
      setNotice(accepted ? 'Comment saved and added to your Evebot draft.' : failure ? `Comment saved. ${failure}` : 'Comment saved. Try adding it to chat again.');
      if (!accepted) return { ...saved, handoffPending: true };
    }
    pendingSave.current = null;
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
