import { useLayoutEffect, useRef, useState } from 'react';
import type { PreviewComment, PreviewCommentReply } from '@open-design/contracts';
import { RiArrowUpLine, RiCloseLine, RiChat3Line, RiRefreshLine } from '@remixicon/react';
import { Button } from './boardui/button';
import { TextareaBase } from './boardui/textarea';
import { cx } from './boardui/cx';
import { CommentThreadMenu } from './CommentThreadMenu';
import { ResolveCommentButton, useCommentReview } from './CommentReview';
import { useEmbeddedViewer } from './host-viewer';
import { confirmHostFeedbackDiscard } from './host-context';
import { createCommentReply, deleteCommentReply, editCommentReply, fetchCommentReplies } from './comment-reply-api';

export function CommentAuthor({ name, createdAt }: { name?: string; createdAt: number }) {
  return <div className="flex min-w-0 flex-1 items-center gap-2">
    <span aria-hidden className="flex size-6 shrink-0 items-center justify-center rounded-full bg-background-secondary-default text-caption-1-semibold text-text-secondary">{(name || 'Unknown').slice(0, 1).toUpperCase()}</span>
    <span className="min-w-0 truncate text-body-2-medium text-text-primary">{name || 'Unknown author'}</span>
    {createdAt > 0 ? <time dateTime={new Date(createdAt).toISOString()} title={new Date(createdAt).toLocaleString()} className="shrink-0 text-caption-1-regular text-text-tertiary">{new Date(createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</time> : null}
  </div>;
}

/** The component stays mounted while the same card shows its all-comments page. */
export function SavedCommentThread({ projectId, comment, hidden, deleted = false, onDirty, onClose, onViewAll, onEditRoot, onDeleteRoot, canEditRoot, canDeleteRoot, existingImages }: {
  projectId: string; comment: PreviewComment; hidden: boolean; onDirty(value: boolean): void;
  deleted?: boolean;
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
  const readVersion = useRef(0);
  const draftRef = useRef(draft); draftRef.current = draft;
  const receipt = useRef<{ note: string; operationId: string } | null>(null);
  const notify = useRef(onDirty); notify.current = onDirty;
  const dirty = busy || (editing ? draft !== editing.note : draft !== '');
  const latestEditing = editing ? replies.find(reply => reply.id === editing.id) : null;
  const editStale = Boolean(editing && (!latestEditing || latestEditing.revision !== editing.revision));
  const dirtyRef = useRef(dirty); dirtyRef.current = dirty;
  useLayoutEffect(() => { notify.current(dirty); }, [dirty]);
  useLayoutEffect(() => {
    const controller = new AbortController(); scope.current = controller;
    const version = ++readVersion.current;
    setReplies([]); setDraft(''); setEditing(null); setLoading(true); setError(null); setBusy(false); pending.current = false; receipt.current = null;
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
    setDraft(next?.note ?? ''); setEditing(next); setError(null); receipt.current = null;
    if (root) onEditRoot();
  }
  async function submit() {
    const controller = scope.current, note = draftRef.current;
    if (!controller || controller.signal.aborted || pending.current || !viewer || !note.trim() || deleted || editStale) return;
    const target = editing;
    if (!receipt.current || receipt.current.note !== note) receipt.current = { note, operationId: crypto.randomUUID() };
    const operationId = receipt.current.operationId;
    pending.current = true; setBusy(true); notify.current(true); setError(null);
    try {
      const saved = target
        ? await editCommentReply(projectId, comment.id, target.id, { note, expectedRevision: target.revision }, controller.signal)
        : await createCommentReply(projectId, comment.id, { note, operationId }, controller.signal);
      if (controller.signal.aborted) return;
      readVersion.current++; setLoading(false);
      setReplies(current => target ? current.map(item => item.id === saved.id ? saved : item) : current.some(item => item.id === saved.id) ? current : [...current, saved]);
      if (draftRef.current === note) { setDraft(''); setEditing(null); receipt.current = null; }
      else if (target) setEditing(saved);
    } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Your reply could not be saved.'); }
    finally { if (!controller.signal.aborted) { pending.current = false; setBusy(false); } }
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
      if (!controller.signal.aborted) { readVersion.current++; setLoading(false); setReplies(current => current.filter(item => item.id !== reply.id)); if (editing?.id === reply.id) { if (draftRef.current === draftBeforeDelete) setDraft(''); setEditing(null); } }
    } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'The reply could not be deleted.'); }
    finally { if (!controller.signal.aborted) { pending.current = false; setBusy(false); } }
  }
  return <section hidden={hidden} aria-label="Comment thread" className={cx('flex-col gap-3', hidden ? 'hidden' : 'flex')} data-testid="saved-comment-thread">
    <header className="flex min-w-0 items-center gap-1">
      <CommentAuthor name={comment.authorDisplayName} createdAt={comment.createdAt} />
      <ResolveCommentButton comment={comment} allowed={canDeleteRoot} blocked={dirty} onResolved={() => { if (!dirtyRef.current) onClose(); }} />
      <CommentThreadMenu canEdit={canEditRoot && !busy} canDelete={Boolean(canDeleteRoot && onDeleteRoot && !busy)} onEdit={() => { void changeEditor(null, true); }} onDelete={async () => {
        const controller = scope.current;
        if (!controller || controller.signal.aborted || pending.current) return;
        if (dirtyRef.current && !await confirmHostFeedbackDiscard(projectId, 'comment')) return;
        if (controller.signal.aborted || pending.current) return;
        pending.current = true; setBusy(true); setDeletingRoot(true); notify.current(true);
        try { await onDeleteRoot?.(); }
        finally { if (!controller.signal.aborted) { pending.current = false; setBusy(false); setDeletingRoot(false); } }
      }} onReopen={comment.status === 'resolved' && canDeleteRoot && review ? () => review.changeStatus(comment.id, 'open') : undefined} />
      {onViewAll ? <Button variant="ghost" size="small" iconOnly leadingIcon={RiChat3Line} aria-label="View all comments" title="View all comments" onClick={onViewAll} /> : null}
      <Button variant="ghost" size="small" iconOnly leadingIcon={RiCloseLine} aria-label="Close" title="Close" onClick={onClose} />
    </header>
    <p className="m-0 whitespace-pre-wrap break-words text-body-regular text-text-primary">{comment.note}</p>
    {deleted ? <p role="status" className="m-0 text-caption-1-regular text-text-tertiary">This thread was deleted. Your unsaved reply is still here.</p> : null}
    {existingImages.length ? <div className="comment-popover-images">{existingImages.map(image => <a key={image.url} className="comment-popover-image-thumb" href={image.url} target="_blank" rel="noopener noreferrer"><img src={image.url} alt={image.name} /></a>)}</div> : null}
    {replies.map(reply => <article key={reply.id} aria-label={`Reply from ${reply.authorDisplayName || 'Unknown author'}`} className="flex flex-col gap-2">
      <header className="flex items-center gap-1"><CommentAuthor name={reply.authorDisplayName} createdAt={reply.createdAt} />
        {reply.authorMemberId === viewer?.memberId ? <CommentThreadMenu kind="reply" canEdit={!busy} canDelete={!busy} onEdit={() => { void changeEditor(reply); }} onDelete={() => remove(reply)} /> : null}
      </header><p className="m-0 whitespace-pre-wrap break-words text-body-regular text-text-primary">{reply.note}</p>
    </article>)}
    {loading ? <span role="status" className="text-caption-1-regular text-text-tertiary">Loading comments…</span> : null}
    {error ? <div role="alert" className="flex items-center gap-2 text-caption-1-regular text-text-error-primary"><span className="min-w-0 flex-1">{error}</span><Button variant="ghost" size="small" iconOnly leadingIcon={RiRefreshLine} aria-label="Reload comments" title="Reload comments" disabled={busy} onClick={() => { void refresh(); }} /></div> : null}
    {editStale ? <div role="status" className="flex items-center gap-2 text-caption-1-regular text-text-tertiary"><span className="min-w-0 flex-1">{latestEditing ? 'This reply changed. Your draft is preserved.' : 'This reply was deleted. Your draft is preserved.'}</span>
      {latestEditing ? <Button variant="ghost" size="small" iconOnly leadingIcon={RiRefreshLine} aria-label="Continue editing latest reply" title="Keep your draft and edit the latest revision" disabled={busy} onClick={() => { setEditing(latestEditing); setError(null); }} /> : null}
    </div> : null}
    <TextareaBase aria-label={editing ? 'Edit reply' : 'Reply'} placeholder="Add your comment" rows={2} autoResize maxRows={5} resize="none" value={draft} disabled={!viewer || deletingRoot}
      onChange={event => { draftRef.current = event.target.value; setDraft(event.target.value); notify.current(busy || (editing ? event.target.value !== editing.note : event.target.value !== '')); }}
      onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); } }} />
    {draft || editing ? <div className="flex items-center justify-end gap-1">
      {editing ? <Button variant="ghost" size="small" iconOnly leadingIcon={RiCloseLine} aria-label="Cancel reply edit" title="Cancel edit" disabled={busy} onClick={() => { void changeEditor(null); }} /> : null}
      <Button variant="ghost" size="small" iconOnly leadingIcon={RiArrowUpLine} aria-label={editing ? 'Save reply' : 'Add reply'} title={editing ? 'Save reply' : 'Add reply'} disabled={busy || !draft.trim() || !viewer || deleted || editStale} onClick={() => { void submit(); }} />
    </div> : null}
  </section>;
}
