import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { deletePreviewComment, fetchPreviewComments, patchPreviewCommentSortKey, patchPreviewCommentStatus, upsertPreviewComment } from '../../providers/registry';
import { commentsToAttachments } from '../../comments';
import type { ChatCommentAttachment, PreviewComment, PreviewCommentTarget } from '../../types';
import type { CommentSaveResult, CommentSendResult } from '../comment-send-result';
import { commentFeedbackContext, commentFeedbackNote, prepareHostFeedback, stageHostContext } from './host-context';
import { FeedbackImageUpload } from './feedback-image-upload';
import { RootCommentWrite } from './root-comment-write';
import { RootCommentWriteError } from '../../providers/comment-write-error';
import { useArtifactScope } from './useArtifactScope';

export function useEmbeddedComments(projectId: string) {
  const scope = useArtifactScope(projectId);
  const writeIntent = useRef(0);
  const rootWrite = useRef(new RootCommentWrite());
  const saving = useRef<AbortSignal | null>(null);
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
    pendingSend.current.clear(); writeIntent.current++; rootWrite.current = new RootCommentWrite(); pendingSave.current = null; saving.current = null;
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
  const save = useCallback(async (target: PreviewCommentTarget, note: string, attach: boolean, images: File[] = [], commentId?: string, capturedBaseline?: PreviewComment): Promise<CommentSaveResult | null> => {
    const signal = scope();
    if (!signal || signal.aborted || saving.current === signal) return null;
    saving.current = signal;
    const intent = writeIntent.current;
    const writer = rootWrite.current;
    try {
      const preparationId = attach ? await prepareHostFeedback(projectId) : null;
      if (signal.aborted || writeIntent.current !== intent || attach && !preparationId) return null;
      const key = JSON.stringify([target, note]);
      const pending = pendingSave.current;
      const cached = pending && (!commentId || pending.comment.id === commentId) && pending.key === key && (images.length === 0 || (pending.images.length === images.length && pending.images.every((file, index) => file === images[index]))) ? pending : null;
      const baseline = capturedBaseline ?? comments.find(item => item.id === commentId);
      if (commentId && (!baseline || baseline.id !== commentId)) throw new RootCommentWriteError(404);
      let saved = cached?.comment;
      let operationId = cached?.operationId;
      if (!saved) {
        let attempt;
        try { attempt = await writer.prepare(projectId, target, note, images, baseline, signal); }
        catch { if (!signal.aborted && writeIntent.current === intent) setNotice('Images could not be saved. Your comment was not saved.'); return null; }
        if (signal.aborted || writeIntent.current !== intent) return null;
        const { input } = attempt;
        let response;
        try { response = await upsertPreviewComment(projectId, projectId, input, undefined, signal); }
        catch (error) {
          if (error instanceof RootCommentWriteError) {
            if (error.status === 0 || error.status === 408 || error.status >= 500) writer.uncertain(input);
            else if (error.status !== 404 && error.status !== 410) writer.rejected(input);
          }
          throw error;
        }
        if (signal.aborted || writeIntent.current !== intent) return null;
        if (!response) { writer.uncertain(input); setNotice('Comment could not be saved. Your draft is still available.'); return null; }
        saved = response; operationId = input.operationId!;
        if (attempt.superseded) {
          generation.current++;
          setComments(current => [...current.filter(item => item.id !== response.id), response]);
          pendingSave.current = null; writer.clear();
          setNotice('Previous save confirmed. Your newer draft is still unsaved.');
          return { ...response, keepDraft: true, consumedImages: attempt.files };
        }
      }
      pendingSave.current = { key, images, comment: saved, operationId: operationId! };
      generation.current++;
      setComments(current => [...current.filter(item => item.id !== saved.id), saved]);
      if (attach) {
        const selected = commentsToAttachments([saved]);
        let failure: string | undefined;
        const accepted = await stageHostContext(projectId, commentFeedbackNote(selected), operationId!, preparationId ?? undefined, [...new Set(selected.flatMap(item => [item.screenshotPath, ...(item.imageAttachments ?? []).map(image => image.path)]).filter((path): path is string => Boolean(path && /^(?:\.|_)studio-comments\//.test(path))))], commentFeedbackContext(selected), message => { failure = message; });
        if (signal.aborted || writeIntent.current !== intent) return null;
        setNotice(accepted ? 'Comment saved and added to your Evebot draft.' : failure ? `Comment saved. ${failure}` : 'Comment saved. Try adding it to chat again.');
        if (!accepted) return { ...saved, handoffPending: true };
      }
      pendingSave.current = null; writer.clear();
      return saved;
    } catch (error) {
      if (signal.aborted || writeIntent.current !== intent) return null;
      if (error instanceof RootCommentWriteError) {
        if ([403, 404, 409, 410].includes(error.status)) await refresh();
        if (signal.aborted || writeIntent.current !== intent) return null;
        setNotice(error.message);
      }
      throw error;
    } finally { if (saving.current === signal) saving.current = null; }
  }, [projectId, scope, comments, refresh]);
  const discardSave = useCallback(() => {
    writeIntent.current++; pendingSave.current = null; rootWrite.current = new RootCommentWrite();
  }, []);
  const remove = useCallback(async (id: string) => {
    const signal = scope();
    if (!signal || signal.aborted) return false;
    const ok = await deletePreviewComment(projectId, projectId, id);
    if (signal.aborted) return false;
    if (ok) {
      if (pendingSave.current?.comment.id === id) { pendingSave.current = null; rootWrite.current.clear(); }
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
    if (pendingSave.current?.comment.id === id) { pendingSave.current = null; rootWrite.current.clear(); }
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
  return { comments, state, notice, refresh, save, discardSave, remove, changeStatus, reorder, send };
}
