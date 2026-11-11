import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { deletePreviewComment, fetchPreviewComments, patchPreviewCommentSortKey, patchPreviewCommentStatus, uploadProjectFiles, upsertPreviewComment } from '../../providers/registry';
import { commentsToAttachments } from '../../comments';
import type { ChatCommentAttachment, PreviewComment, PreviewCommentTarget } from '../../types';
import type { CommentSendResult } from '../comment-send-result';
import { commentFeedbackContext, commentFeedbackNote, prepareHostFeedback, stageHostContext } from './host-context';
import { FeedbackImageUpload } from './feedback-image-upload';
import { useArtifactScope } from './useArtifactScope';

export function useEmbeddedComments(projectId: string) {
  const scope = useArtifactScope(projectId);
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
  useLayoutEffect(() => {
    pendingSend.current.clear(); pendingSave.current = null;
    setComments([]); setState('loading'); setNotice(null);
    return () => { generation.current++; };
  }, [scope]);
  const refresh = useCallback(async () => {
    const signal = scope();
    if (!signal) return;
    const request = ++generation.current;
    try {
      const next = await fetchPreviewComments(projectId, projectId);
      if (!signal.aborted && generation.current === request) { setComments(next); setState('success'); }
    } catch { if (!signal.aborted && generation.current === request) setState('error'); }
  }, [projectId, scope]);
  useEffect(() => {
    void refresh();
    // Thin events are the fast path; this reconciles after a missed event.
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 30_000);
    return () => { generation.current++; clearInterval(timer); };
  }, [refresh]);
  const send = useCallback(async (attachments: ChatCommentAttachment[], images: File[] = []): Promise<CommentSendResult> => {
    const signal = scope();
    if (!signal || signal.aborted) return { status: 'rejected', commentIds: [] };
    const preparationId = await prepareHostFeedback(projectId);
    if (signal.aborted || !preparationId) return { status: 'rejected', commentIds: [] };
    const text = commentFeedbackNote(attachments);
    const feedback = commentFeedbackContext(attachments);
    let prepared: Awaited<ReturnType<FeedbackImageUpload['prepare']>>;
    try { prepared = await pendingSend.current.prepare(projectId, images, JSON.stringify([text, feedback]), signal); }
    catch { if (!signal.aborted) setNotice('Images could not be saved. Your request was not added to chat.'); return { status: 'rejected', commentIds: [] }; }
    if (signal.aborted) return { status: 'rejected', commentIds: [] };
    const imagePaths = [...new Set([...prepared.paths, ...attachments.flatMap(item => [item.screenshotPath, ...(item.imageAttachments ?? []).map(image => image.path)]).filter((path): path is string => Boolean(path && /^(?:\.|_)studio-comments\//.test(path)))])];
    let failure: string | undefined;
    const accepted = await stageHostContext(projectId, text, prepared.operationId, preparationId, imagePaths, feedback, message => { failure = message; });
    if (signal.aborted) return { status: 'rejected', commentIds: [] };
    if (accepted) pendingSend.current.clear();
    setNotice(accepted ? 'Added to your chat draft.' : failure ?? 'The feedback could not be added. Try again.');
    return { status: accepted ? 'queued' : 'rejected', commentIds: accepted ? attachments.map((item) => item.id) : [] };
  }, [projectId, scope]);
  const save = useCallback(async (target: PreviewCommentTarget, note: string, attach: boolean, images: File[] = [], commentId?: string) => {
    const signal = scope();
    if (!signal || signal.aborted) return null;
    const preparationId = attach ? await prepareHostFeedback(projectId) : null;
    if (signal.aborted || attach && !preparationId) return null;
    const key = JSON.stringify([target, note]);
    const pending = pendingSave.current;
    const cached = pending && (!commentId || pending.comment.id === commentId) && pending.key === key && (images.length === 0 || (pending.images.length === images.length && pending.images.every((file, index) => file === images[index]))) ? pending : null;
    const existing = cached?.comment ?? comments.find((item) => item.id === commentId);
    let attachments = existing?.attachments ?? [];
    if (images.length && !cached) {
      const result = await uploadProjectFiles(projectId, images, '_studio-comments', undefined, signal);
      if (signal.aborted) return null;
      if (result.failed.length || result.uploaded.length !== images.length) { setNotice('Images could not be saved. Your comment was not saved.'); return null; }
      attachments = [...attachments, ...result.uploaded.map((item) => ({ path: item.path, name: item.name }))];
    }
    const saved = cached?.comment ?? await upsertPreviewComment(projectId, projectId, { ...(commentId ? { id: commentId } : {}), target, note, attachments });
    if (signal.aborted) return null;
    if (!saved) { setNotice('Comment could not be saved. Your draft is still available.'); return null; }
    const operationId = cached?.operationId ?? crypto.randomUUID();
    pendingSave.current = { key, images, comment: saved, operationId };
    generation.current++;
    setComments((current) => [...current.filter((item) => item.id !== saved.id), saved]);
    if (attach) {
      const selected = commentsToAttachments([saved]);
      let failure: string | undefined;
      const accepted = await stageHostContext(projectId, commentFeedbackNote(selected), operationId, preparationId ?? undefined, [...new Set(selected.flatMap(item => [item.screenshotPath, ...(item.imageAttachments ?? []).map(image => image.path)]).filter((path): path is string => Boolean(path && /^(?:\.|_)studio-comments\//.test(path))))], commentFeedbackContext(selected), message => { failure = message; });
      if (signal.aborted) return null;
      setNotice(accepted ? 'Comment saved and added to your Evebot draft.' : failure ? `Comment saved. ${failure}` : 'Comment saved. Try adding it to chat again.');
      if (!accepted) return { ...saved, handoffPending: true };
    }
    pendingSave.current = null;
    return saved;
  }, [projectId, scope, comments]);
  const remove = useCallback(async (id: string) => {
    const signal = scope();
    if (!signal || signal.aborted) return false;
    const ok = await deletePreviewComment(projectId, projectId, id);
    if (signal.aborted) return false;
    if (ok) {
      if (pendingSave.current?.comment.id === id) pendingSave.current = null;
      generation.current++; setComments((current) => current.filter((item) => item.id !== id));
    }
    else setNotice('Comment could not be removed. Only its author can change it.');
    return ok;
  }, [projectId, scope]);
  const changeStatus = useCallback(async (id: string, status: 'open' | 'resolved') => {
    const signal = scope();
    if (!signal) return false;
    let saved: PreviewComment | null;
    try { saved = await patchPreviewCommentStatus(projectId, projectId, id, status); }
    catch { saved = null; }
    if (signal.aborted) return false;
    if (!saved) { setNotice('Comment status could not be saved. Try again.'); return false; }
    if (pendingSave.current?.comment.id === id) pendingSave.current = null;
    generation.current++;
    setComments(current => current.map(comment => comment.id === saved.id ? saved : comment));
    return true;
  }, [projectId, scope]);
  const reorder = useCallback(async (id: string, sortKey: number) => {
    const signal = scope();
    if (!signal || signal.aborted) return;
    const saved = await patchPreviewCommentSortKey(projectId, projectId, id, sortKey);
    if (signal.aborted) return;
    if (saved) { generation.current++; setComments((current) => current.map((item) => item.id === saved.id ? saved : item)); }
    else { setNotice('Comment order could not be saved.'); await refresh(); }
  }, [projectId, scope, refresh]);
  return { comments, state, notice, refresh, save, remove, changeStatus, reorder, send };
}
