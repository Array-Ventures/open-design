import { commentIconButton as iconButton } from './comment-button-style';
import { useLayoutEffect, useRef, useState } from 'react';
import type { PreviewComment, PreviewCommentAttachment, PreviewCommentReply, PreviewCommentReplyCreateRequest } from '@open-design/contracts';
import { RiArrowUpLine, RiCloseLine, RiRefreshLine, RiAttachment2, RiChatNewLine } from '@remixicon/react';
import { Button } from './boardui/button';
import { TextareaBase } from './boardui/textarea';
import { cx } from './boardui/cx';
import { CommentThreadMenu } from './CommentThreadMenu';
import { useReplyImages, type ImageDraft } from './useReplyImages';
import { ReplyImages } from './ReplyImages';
import { ScrollFade, useScrollFade } from './boardui/scroll-fade';
import { CommentMentions } from './CommentMentions';
import { ResolveCommentButton, useCommentReview } from './CommentReview';
import { useEmbeddedViewer } from './host-viewer';
import { confirmHostFeedbackDiscard } from './host-context';
import { CommentReplyError, createCommentReply, deleteCommentReply, editCommentReply, fetchCommentReplies } from './comment-reply-api';
import { isImeComposing } from '../../utils/imeComposing';

function commentAge(createdAt: number): string {
  const minutes = Math.max(0, Math.floor((Date.now() - createdAt) / 60_000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`;
  if (minutes < 10080) return `${Math.floor(minutes / 1440)}d`;
  return new Date(createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function CommentAuthor({ name, createdAt }: { name?: string; createdAt: number }) {
  return <div className="flex min-w-0 flex-1 items-center gap-2">
    <span aria-hidden className="flex size-6 shrink-0 items-center justify-center rounded-full bg-background-secondary-default text-caption-1-semibold text-text-secondary">{(name || 'Unknown').slice(0, 1).toUpperCase()}</span>
    <span className="min-w-0 truncate text-body-2-medium text-text-primary">{name || 'Unknown author'}</span>
    {Number.isFinite(createdAt) && createdAt > 0 ? <time dateTime={new Date(createdAt).toISOString()} title={new Date(createdAt).toLocaleString()} className="shrink-0 text-caption-1-regular text-text-tertiary">{commentAge(createdAt)}</time> : null}
  </div>;
}

/** The component stays mounted while the same card shows its all-comments page. */
export function SavedCommentThread({ projectId, comment, hidden, deleted = false, hideClose = false, onDirty, onClose, onViewAll, onEditRoot, onDeleteRoot, canEditRoot, canDeleteRoot, existingImages }: {
  projectId: string; comment: PreviewComment; hidden: boolean; onDirty(value: boolean): void;
  deleted?: boolean; hideClose?: boolean;
  onClose(): void; onViewAll?(): void; onEditRoot(): void; onDeleteRoot?(): unknown | Promise<unknown>;
  canEditRoot: boolean; canDeleteRoot: boolean; existingImages: { url: string; name: string }[];
}) {
  const viewer = useEmbeddedViewer();
  const review = useCommentReview();
  const [replies, setReplies] = useState<PreviewCommentReply[]>([]);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<PreviewCommentReply | null>(null);
  const [busy, setBusy] = useState(false);
  const [deletingRoot, setDeletingRoot] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scope = useRef<AbortController | null>(null);
  const pending = useRef(false);
  const composing = useRef(false);
  const readVersion = useRef(0);
  const draftRef = useRef(draft); draftRef.current = draft;
  const receipt = useRef<{ input: PreviewCommentReplyCreateRequest; images: ImageDraft; uploaded: PreviewCommentAttachment[]; uncertain: boolean } | null>(null);
  const notify = useRef(onDirty); notify.current = onDirty;
  const images = useReplyImages(projectId, JSON.stringify([comment.id, editing?.id ?? null]), () => notify.current(true));
  const picker = useRef<HTMLInputElement>(null);
  const historyFade = useScrollFade();
  const dirty = busy || Boolean(receipt.current?.uncertain) || images.hasChanges(editing?.attachments ?? []) || (editing ? draft !== editing.note : draft !== '');
  const latestEditing = editing ? replies.find(reply => reply.id === editing.id) : null;
  const editStale = Boolean(editing && (!latestEditing || latestEditing.revision !== editing.revision));
  const dirtyRef = useRef(dirty); dirtyRef.current = dirty;
  useLayoutEffect(() => { notify.current(dirty); }, [dirty]);
  useLayoutEffect(() => {
    const controller = new AbortController(); scope.current = controller;
    const version = ++readVersion.current;
    setReplies([]); setDraft(''); setEditing(null); setLoading(true); setError(null); setBusy(false); pending.current = false; receipt.current = null; images.reset();
    void fetchCommentReplies(projectId, comment.id, controller.signal).then(next => { if (!controller.signal.aborted && readVersion.current === version) setReplies(next); })
      .catch(() => { if (!controller.signal.aborted && readVersion.current === version) setError('Comments could not be loaded.'); })
      .finally(() => { if (!controller.signal.aborted && readVersion.current === version) setLoading(false); });
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void refresh(true); }, 30_000);
    return () => { clearInterval(timer); controller.abort(); notify.current(false); };
  }, [projectId, comment.id, viewer?.memberId]);
  async function refresh(quiet = false) {
    const controller = scope.current;
    if (!controller || controller.signal.aborted) return;
    const version = ++readVersion.current;
    if (!quiet) setLoading(true); setError(null);
    try { const next = await fetchCommentReplies(projectId, comment.id, controller.signal); if (!controller.signal.aborted && readVersion.current === version) setReplies(next); }
    catch { if (!controller.signal.aborted && readVersion.current === version) setError('Comments could not be loaded.'); }
    finally { if (!controller.signal.aborted && readVersion.current === version) setLoading(false); }
  }
  async function changeEditor(next: PreviewCommentReply | null, root = false) {
    const controller = scope.current;
    if (!controller || controller.signal.aborted || pending.current) return;
    if (dirtyRef.current && !await confirmHostFeedbackDiscard(projectId, 'comment')) return;
    if (controller.signal.aborted) return;
    setDraft(next?.note ?? ''); setEditing(next); setError(null); receipt.current = null; images.reset(next?.attachments ?? []);
    if (root) onEditRoot();
  }
  async function submit() {
    const controller = scope.current, note = draftRef.current;
    const retry = receipt.current?.uncertain ? receipt.current : null;
    const imageSnapshot = retry?.images ?? images.read();
    if (!controller || controller.signal.aborted || pending.current || !viewer || (!retry && !note.trim() && !imageSnapshot.files.length && !imageSnapshot.kept.length) || deleted || editStale) return;
    const imageProblem = retry ? null : images.validate();
    if (imageProblem) { setError(imageProblem); return; }
    const target = editing;
    let attempt = retry;
    let sent = false;
    pending.current = true; setBusy(true); notify.current(true); setError(null);
    try {
      const uploaded = retry?.uploaded ?? (imageSnapshot.files.length ? await images.prepare(imageSnapshot, controller.signal) : []);
      if (controller.signal.aborted) return;
      const attachments = [...imageSnapshot.kept, ...uploaded];
      const imageChanges = imageSnapshot.files.length > 0 || JSON.stringify(imageSnapshot.kept) !== JSON.stringify(target?.attachments ?? []);
      const imageInput = (target ? imageChanges : attachments.length) ? { attachments } : {};
      if (!target && !attempt) {
        attempt = { input: { note, operationId: crypto.randomUUID(), ...imageInput }, images: imageSnapshot, uploaded, uncertain: false };
        receipt.current = attempt;
      }
      sent = true;
      const saved = target
        ? await editCommentReply(projectId, comment.id, target.id, { note, expectedRevision: target.revision, ...imageInput }, controller.signal)
        : await createCommentReply(projectId, comment.id, attempt!.input, controller.signal);
      if (controller.signal.aborted) return;
      readVersion.current++; setLoading(false);
      setReplies(current => target ? current.map(item => item.id === saved.id ? saved : item) : current.some(item => item.id === saved.id) ? current : [...current, saved]);
      const unchanged = draftRef.current === (attempt?.input.note ?? note) && images.read() === imageSnapshot;
      receipt.current = null;
      if (unchanged) { setDraft(''); setEditing(null); receipt.current = null; images.reset(); }
      else { images.accepted(imageSnapshot, uploaded, Boolean(target)); if (target) setEditing(saved); }
    } catch (failure) {
      if (!controller.signal.aborted) {
        if (attempt && sent) {
          if (!(failure instanceof CommentReplyError) || failure.status === 408 || failure.status >= 500) attempt.uncertain = true;
          else receipt.current = null;
        }
        setError(failure instanceof Error ? failure.message : 'Your reply could not be saved.');
      }
    }
    finally { if (!controller.signal.aborted) { pending.current = false; setBusy(false); } }
  }
  function changeDraft(value: string) {
    draftRef.current = value;
    setDraft(value);
    notify.current(busy || Boolean(receipt.current?.uncertain) || images.hasChanges(editing?.attachments ?? []) || (editing ? value !== editing.note : value !== ''));
  }
  async function remove(reply: PreviewCommentReply) {
    const controller = scope.current;
    if (!controller || controller.signal.aborted || pending.current) return;
    pending.current = true; setBusy(true); notify.current(true); setError(null);
    try {
      if (editing?.id === reply.id && dirtyRef.current && !await confirmHostFeedbackDiscard(projectId, 'comment')) return;
      if (controller.signal.aborted) return;
      const draftBeforeDelete = draftRef.current;
      await deleteCommentReply(projectId, comment.id, reply.id, reply.revision, controller.signal);
      if (!controller.signal.aborted) { readVersion.current++; setLoading(false); setReplies(current => current.filter(item => item.id !== reply.id)); if (editing?.id === reply.id) { if (draftRef.current === draftBeforeDelete) setDraft(''); setEditing(null); images.detach(); } }
    } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'The reply could not be deleted.'); }
    finally { if (!controller.signal.aborted) { pending.current = false; setBusy(false); } }
  }
  return <section hidden={hidden} aria-label="Comment thread" className={cx('min-h-0 flex-1 flex-col gap-3', hidden ? 'hidden' : 'flex')} data-testid="saved-comment-thread">
    <header className="flex min-w-0 items-center gap-1">
      <CommentAuthor name={comment.authorDisplayName} createdAt={comment.createdAt} />
      <ResolveCommentButton comment={comment} allowed={canDeleteRoot} blocked={dirty} onResolved={() => { if (!dirtyRef.current) onClose(); }} />
      <CommentThreadMenu onViewAll={onViewAll} canEdit={canEditRoot && !busy} canDelete={Boolean(canDeleteRoot && onDeleteRoot && !busy)} onEdit={() => { void changeEditor(null, true); }} onDelete={async () => {
        const controller = scope.current;
        if (!controller || controller.signal.aborted || pending.current) return;
        if (dirtyRef.current && !await confirmHostFeedbackDiscard(projectId, 'comment')) return;
        if (controller.signal.aborted || pending.current) return;
        pending.current = true; setBusy(true); setDeletingRoot(true); notify.current(true);
        try { await onDeleteRoot?.(); }
        finally { if (!controller.signal.aborted) { pending.current = false; setBusy(false); setDeletingRoot(false); } }
      }} onReopen={comment.status === 'resolved' && canDeleteRoot && review ? () => review.changeStatus(comment.id, 'open') : undefined} />
      {!hideClose ? <Button className={iconButton} variant="ghost" size="small" iconOnly leadingIcon={RiCloseLine} aria-label="Close" title="Close" onClick={onClose} /> : null}
    </header>
    <div className="relative flex min-h-0 flex-1 flex-col">
    <div role="region" aria-label="Thread history" tabIndex={0} onScroll={historyFade.onScroll} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring">
    <p className="m-0 whitespace-pre-wrap break-words text-body-regular text-text-primary">{comment.note}</p>
    {deleted ? <p role="status" className="m-0 text-caption-1-regular text-text-tertiary">This thread was deleted. Your unsaved reply is still here.</p> : null}
    {existingImages.length ? <div className="comment-popover-images">{existingImages.map(image => <a key={image.url} className="comment-popover-image-thumb" href={image.url} target="_blank" rel="noopener noreferrer"><img src={image.url} alt={image.name} /></a>)}</div> : null}
    {replies.map(reply => <article key={reply.id} aria-label={`Reply from ${reply.authorDisplayName || 'Unknown author'}`} className="flex flex-col gap-2">
      <header className="flex items-center gap-1"><CommentAuthor name={reply.authorDisplayName} createdAt={reply.createdAt} />
        {reply.authorMemberId === viewer?.memberId ? <CommentThreadMenu kind="reply" canEdit={!busy} canDelete={!busy} onEdit={() => { void changeEditor(reply); }} onDelete={() => remove(reply)} /> : null}
      </header><ReplyImages projectId={projectId} saved={reply.attachments ?? []} />{reply.note.trim() ? <p className="m-0 whitespace-pre-wrap break-words text-body-regular text-text-primary">{reply.note}</p> : null}
    </article>)}
    {loading ? <span role="status" className="text-caption-1-regular text-text-tertiary">Loading comments…</span> : null}
    </div>
    <ScrollFade progress={historyFade.progress} />
    </div>
    <div className="flex shrink-0 flex-col gap-3">
    {error || receipt.current?.uncertain ? <div role="alert" className="flex items-center gap-2 text-caption-1-regular text-text-error-primary"><span className="min-w-0 flex-1">{error || 'Save not confirmed.'}</span>{receipt.current?.uncertain ? <Button className={iconButton} variant="ghost" size="small" iconOnly leadingIcon={RiRefreshLine} aria-label="Retry reply save" title="Retry save" disabled={busy} onClick={() => { void submit(); }} /> : null}<Button className={iconButton} variant="ghost" size="small" iconOnly leadingIcon={RiRefreshLine} aria-label="Reload comments" title="Reload comments" disabled={busy} onClick={() => { void refresh(); }} /></div> : null}
    {editStale ? <div role="status" className="flex items-center gap-2 text-caption-1-regular text-text-tertiary"><span className="min-w-0 flex-1">{latestEditing ? 'This reply changed. Your draft is preserved.' : 'This reply was deleted. Your draft is preserved.'}</span>
      {latestEditing ? <Button className={iconButton} variant="ghost" size="small" iconOnly leadingIcon={RiRefreshLine} aria-label="Continue editing latest reply" title="Keep your draft and edit the latest revision" disabled={busy} onClick={() => { images.rebase(editing?.attachments ?? [], latestEditing.attachments ?? []); setEditing(latestEditing); setError(null); }} />
        : !deleted ? <Button className={iconButton} variant="ghost" size="small" iconOnly leadingIcon={RiChatNewLine} aria-label="Keep draft as a new reply" title="Keep draft as a new reply" disabled={busy || !viewer} onClick={() => { setEditing(null); receipt.current = null; setError(null); }} /> : null}
    </div> : null}
    <ReplyImages projectId={projectId} saved={images.draft.kept} fresh={images.previews} onRemoveSaved={images.removeKept} onRemoveFresh={images.removeFresh} />
    <div className="relative">
    <CommentMentions value={draft} onChange={changeDraft}><TextareaBase className={cx('min-h-7 ps-8', editing ? 'pe-16' : 'pe-8')} aria-label={editing ? 'Edit reply' : 'Reply'} placeholder="Add your comment" rows={1} autoResize maxRows={5} resize="none" value={draft} disabled={!viewer || deletingRoot}
      onChange={event => changeDraft(event.target.value)}
      onPaste={event => { const files = Array.from(event.clipboardData.files); if (!files.length || !viewer || deletingRoot || deleted) return; event.preventDefault(); setError(images.add(files)); }}
      onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
      onKeyDown={event => { if (!isImeComposing(event, composing.current) && event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submit(); } }} />
    </CommentMentions>
      <input ref={picker} type="file" multiple accept=".png,.jpg,.jpeg,.gif,.webp" aria-label="Reply image files" className="hidden" disabled={!viewer || deletingRoot || deleted} onChange={event => { const files = Array.from(event.target.files ?? []); if (files.length) setError(images.add(files)); event.target.value = ''; }} />
      <Button className={cx(iconButton, 'absolute bottom-1.5 start-1.5')} variant="ghost" size="small" iconOnly leadingIcon={RiAttachment2} aria-label="Attach reply images" title="Attach images" disabled={!viewer || deletingRoot || deleted} onClick={() => picker.current?.click()} />
      {draft || editing || images.draft.files.length || images.draft.kept.length ? <div className="absolute bottom-1.5 end-1.5 flex items-center gap-0">
      {editing ? <Button className={iconButton} variant="ghost" size="small" iconOnly leadingIcon={RiCloseLine} aria-label="Cancel reply edit" title="Cancel edit" disabled={busy} onClick={() => { void changeEditor(null); }} /> : null}
      <Button className={iconButton} variant="ghost" size="small" iconOnly leadingIcon={RiArrowUpLine} aria-label={editing ? 'Save reply' : 'Add reply'} title={editing ? 'Save reply' : 'Add reply'} disabled={busy || (!draft.trim() && !images.draft.files.length && !images.draft.kept.length) || !viewer || deleted || editStale} onClick={() => { void submit(); }} />
      </div> : null}
    </div>
    </div>
  </section>;
}
