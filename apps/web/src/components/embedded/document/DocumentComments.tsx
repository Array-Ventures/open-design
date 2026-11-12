import { useEffect, useMemo, useRef, useState } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $createRangeSelection, $getNearestNodeFromDOMNode, $getSelection, $isRangeSelection, $isTextNode, $setSelection } from 'lexical';
import { RiArrowLeftLine, RiArrowUpLine, RiChatNewLine, RiCloseLine } from '@remixicon/react';
import type { PreviewComment, PreviewCommentTarget } from '../../../types';
import { projectRawUrl } from '../../../providers/registry';
import { commentsToAttachments } from '../../../comments';
import { canDeleteComment, canEditComment, canSendCommentToAgent } from '../../../comments/comment-authority';
import { ArtifactAnnotationControls } from '../ArtifactAnnotationControls';
import type { ArtifactFeedbackProps } from '../LiveArtifactFeedbackPreview';
import { useEmbeddedViewer } from '../host-viewer';
import { confirmHostFeedbackDiscard } from '../host-context';
import { Button } from '../boardui/button';
import { TextareaBase } from '../boardui/textarea';
import { ScrollFade, useScrollFade } from '../boardui/scroll-fade';
import { CommentMentions } from '../CommentMentions';
import { CommentAuthor, SavedCommentThread } from '../SavedCommentThread';
import { CommentReviewFilter, useCommentReview } from '../CommentReview';
import { useRootCommentEditor } from '../useRootCommentEditor';
import { RootCommentRecovery } from '../RootCommentRecovery';
import { commentIconButton } from '../comment-button-style';
import { captureDocumentComment, documentCommentQuote, documentCommentTarget, readDocumentCommentAnchor, resolveDocumentComment, type DocumentCommentAnchor } from './document-comment-anchor';

/** Uses the existing authorized comment/CAS/reply/handoff services. The editor
 * owns exact text anchors; annotations never replace or freeze the document. */
export function DocumentComments({ projectId, fileName, feedback, onDirtyChange, onOpenChange }: { onOpenChange?(open: boolean): void; onDirtyChange?(dirty: boolean): void; projectId: string; fileName: string; feedback: ArtifactFeedbackProps }) {
  const [editor] = useLexicalComposerContext(), viewer = useEmbeddedViewer(), review = useCommentReview();
  const [open, setOpen] = useState(false), [list, setList] = useState(false);
  useEffect(() => { onOpenChange?.(open); return () => onOpenChange?.(false); }, [open, onOpenChange]);
  const [selected, setSelected] = useState<PreviewComment | null>(null), [target, setTarget] = useState<PreviewCommentTarget | null>(null);
  const [draft, setDraft] = useState(''), [editing, setEditing] = useState(false), [busy, setBusy] = useState(false), [replyDirty, setReplyDirty] = useState(false), [handoffPending, setHandoffPending] = useState(false), [notice, setNotice] = useState<string | null>(null);
  const [width, setWidth] = useState(320), [replyRevision, setReplyRevision] = useState(0);
  const [revision, update] = useState(0);
  const cardScroll = useScrollFade();
  useEffect(() => { cardScroll.reset(); }, [open, list, selected?.id, cardScroll.reset]);
  const anchor = useRef<DocumentCommentAnchor | null>(null), life = useRef(true), pending = useRef(false);
  const returnFocus = useRef<() => void>(() => {});
  const current = feedback.previewComments?.find(comment => comment.id === selected?.id) ?? null;
  const authority = { viewerMemberId: viewer?.memberId ?? null, collabEnabled: true, isProjectOwner: false };
  const persisted = useMemo(() => feedback.previewComments?.filter(comment => comment.filePath === fileName && readDocumentCommentAnchor(comment)) ?? [], [feedback.previewComments, fileName]);
  const dirty = busy || replyDirty || handoffPending || editing && draft !== (selected?.note ?? '');
  const notify = useRef(onDirtyChange); notify.current = onDirtyChange;
  useEffect(() => { notify.current?.(dirty); }, [dirty, draft, replyRevision]);
  useEffect(() => () => notify.current?.(false), []);
  const dirtyRef = useRef(dirty); dirtyRef.current = dirty;
  const draftVersion = useRef<{ parts: readonly unknown[]; value: number }>({ parts: [], value: 0 });
  const draftParts = [draft, busy, replyRevision, editing, handoffPending, selected?.id, target];
  if (!draftParts.every((part, index) => Object.is(part, draftVersion.current.parts[index]))) draftVersion.current = { parts: draftParts, value: draftVersion.current.value + 1 };
  const draftCurrent = useRef(draft); draftCurrent.current = draft;
  const root = useRootCommentEditor({ existing: current, retained: selected, draft, hasExtras: false, selectionKey: selected?.id ?? JSON.stringify(target), onDraft: setDraft });
  const capture = () => editor.getEditorState().read(() => {
    const dom = window.getSelection(), element = editor.getRootElement();
    if (dom?.anchorNode && dom.focusNode && element?.contains(dom.anchorNode) && element.contains(dom.focusNode)) {
      anchor.current = null;
      const start = $getNearestNodeFromDOMNode(dom.anchorNode), end = $getNearestNodeFromDOMNode(dom.focusNode);
      if ($isTextNode(start) && $isTextNode(end)) {
        const selection = $createRangeSelection(); selection.setTextNodeRange(start, dom.anchorOffset, end, dom.focusOffset);
        anchor.current = captureDocumentComment(selection);
      }
    } else {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) anchor.current = captureDocumentComment(selection);
    }
  }, { editor });
  useEffect(() => {
    life.current = true;
    const stop = editor.registerUpdateListener(({ dirtyElements, dirtyLeaves }) => { capture(); if (dirtyElements.size || dirtyLeaves.size) update(value => value + 1); });
    document.addEventListener('selectionchange', capture);
    return () => { life.current = false; stop(); document.removeEventListener('selectionchange', capture); };
  }, [editor]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirtyRef.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', beforeUnload); return () => window.removeEventListener('beforeunload', beforeUnload);
  }, []);
  const allowed = async () => {
    if (pending.current) return false;
    const version = draftVersion.current.value;
    const accepted = !dirtyRef.current || await confirmHostFeedbackDiscard(projectId, 'comment');
    return accepted && life.current && !pending.current && version === draftVersion.current.value;
  };
  const reset = () => { feedback.onDiscardPreviewCommentWrite?.(); setSelected(null); setTarget(null); setDraft(''); setEditing(false); setReplyDirty(false); setHandoffPending(false); setNotice(null); };
  const close = async () => { if (!await allowed() || !life.current) return; reset(); setOpen(false); returnFocus.current(); };
  const begin = async () => {
    capture();
    if (!await allowed() || !life.current) return;
    const captured = anchor.current;
    reset(); setOpen(true); setList(false);
    if (!captured || !editor.getEditorState().read(() => resolveDocumentComment(captured))) { setNotice('Select text in the document to comment.'); return; }
    setTarget(documentCommentTarget(fileName, captured)); setEditing(true);
  };
  const show = async (comment: PreviewComment) => {
    // Returning to the retained thread is navigation, not a target change.
    if (selected?.id === comment.id) { setOpen(true); setList(false); return; }
    if (!await allowed() || !life.current) return;
    reset(); setSelected(comment); setTarget(comment); setOpen(true); setList(false);
    const savedAnchor = readDocumentCommentAnchor(comment);
    editor.update(() => {
      const selection = savedAnchor && resolveDocumentComment(savedAnchor);
      if (selection) $setSelection(selection);
      else setNotice('The selected text changed or was removed. The saved thread is still available.');
    }, { discrete: true });
  };
  const save = async (attach: boolean) => {
    if (!target || !draft.trim() || pending.current || !feedback.onSavePreviewComment || root.deleted || root.stale) return;
    pending.current = true; setBusy(true);
    const note = draft;
    await root.save(async baseline => {
      const saved = await feedback.onSavePreviewComment!(target, note, attach, [], selected?.id, baseline);
      if (!life.current || !saved) return null;
      setSelected(saved); setHandoffPending(Boolean(saved.handoffPending));
      if (!saved.keepDraft && !saved.handoffPending && draftCurrent.current === note) { setEditing(false); setDraft(saved.note); }
      return saved;
    });
    pending.current = false; if (life.current) setBusy(false);
  };
  const remove = async () => {
    // SavedCommentThread has already confirmed its own unsent reply draft.
    if (!selected || !canDeleteComment(selected, authority) || pending.current) return;
    pending.current = true; setBusy(true);
    try { if (await feedback.onRemovePreviewComment?.(selected.id) && life.current) { reset(); setList(true); } }
    catch { if (life.current) setNotice('The comment could not be deleted. Try again.'); }
    finally { pending.current = false; if (life.current) setBusy(false); }
  };
  const send = async () => {
    if (!selected || pending.current || replyDirty || !canSendCommentToAgent(current ?? selected, authority)) return;
    pending.current = true; setBusy(true);
    try {
      const result = await feedback.onSendBoardCommentAttachments?.(commentsToAttachments([current ?? selected]));
      if (life.current) setNotice(result?.status === 'queued' ? 'Added to your chat draft.' : 'The comment was not added. Try again.');
    } catch { if (life.current) setNotice('The comment was not added. Try again.'); }
    finally { pending.current = false; if (life.current) setBusy(false); }
  };
  const location = useMemo(() => target && readDocumentCommentAnchor(target), [target]);
  const located = useMemo(() => location ? editor.getEditorState().read(() => Boolean(resolveDocumentComment(location))) : true, [editor, location, revision]);
  return <>
    <ArtifactAnnotationControls projectId={projectId} commenting={open && !list} marking={false} markupAvailable={false} dirty={dirty} disabled={!viewer}
      onComment={() => { void (open && !list ? close() : begin()); }} onMark={() => {}} onComments={focus => { returnFocus.current = focus; void allowed().then(ok => { if (ok && life.current) { setOpen(true); setList(true); } }); }} onDiscard={() => { if (!pending.current) { reset(); setOpen(false); } }} />
    {open ? <aside role="dialog" aria-label="Document comments" onKeyDown={event => { if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); void close(); } }} className="absolute end-3 top-3 z-30 flex min-h-0 max-h-[calc(100%_-_24px)] max-w-[calc(100%_-_24px)] flex-col rounded-2xl border border-separator-border bg-background-primary-default shadow-lg" style={{ width }}>
      <div role="separator" aria-label="Resize document comments" aria-orientation="vertical" aria-valuemin={240} aria-valuemax={480} aria-valuenow={width} tabIndex={0}
        className="absolute inset-y-0 -start-1 w-2 cursor-col-resize focus-visible:ring-2 focus-visible:ring-border-focus-ring"
        onKeyDown={event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const grows = event.key === (getComputedStyle(event.currentTarget).direction === 'rtl' ? 'ArrowRight' : 'ArrowLeft'); setWidth(value => event.key === 'Home' ? 240 : event.key === 'End' ? 480 : Math.max(240, Math.min(480, value + (grows ? 16 : -16)))); } }}
        onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); }}
        onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) { const parent = event.currentTarget.parentElement?.getBoundingClientRect(); if (parent) setWidth(Math.max(240, Math.min(480, (getComputedStyle(event.currentTarget).direction === 'rtl' ? event.clientX - parent.left : parent.right - event.clientX)))); } }} onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} />
      <header className="flex shrink-0 items-center gap-1 border-b border-separator-border px-3 py-2">
        {!list ? <Button variant="ghost" size="small" iconOnly className={commentIconButton} leadingIcon={RiArrowLeftLine} aria-label="All comments" onClick={() => { setList(true); }} /> : null}
        <span className="min-w-0 flex-1 truncate text-body-2-medium text-text-primary">{list ? 'Comments' : 'Selected text'}</span>
        <CommentReviewFilter />
        <Button variant="ghost" size="small" iconOnly className={commentIconButton} leadingIcon={RiCloseLine} aria-label="Close comments" onClick={() => { void close(); }} />
      </header>
      <div className="relative flex min-h-0 flex-col">
      <div onScroll={cardScroll.onScroll} className="min-h-0 overflow-y-auto">
      {list ? <div className="flex min-h-0 flex-col gap-2 p-3">
        {feedback.previewCommentsState === 'error' ? <Button variant="ghost" size="small" onClick={feedback.onRetryPreviewComments}>Retry comments</Button> : null}
        {persisted.filter(comment => review?.showResolved || comment.status !== 'resolved').map(comment => <Button key={comment.id} variant="ghost" className="h-auto min-h-0 justify-start rounded-lg bg-transparent p-2 text-start text-text-primary hover:bg-background-secondary-hover active:bg-background-secondary-default" onClick={() => { void show(comment); }}><span className="flex min-w-0 flex-col gap-1"><CommentAuthor name={comment.authorDisplayName} createdAt={comment.createdAt} /><span className="line-clamp-2 text-body-2-regular text-text-primary">{comment.note}</span><span className="line-clamp-2 whitespace-pre-wrap break-words text-caption-1-regular text-text-tertiary">{documentCommentQuote(comment)}</span></span></Button>)}
        {!persisted.filter(comment => review?.showResolved || comment.status !== 'resolved').length ? <span className="text-body-2-regular text-text-tertiary">{persisted.length ? 'No open comments.' : 'No comments yet. Select text to add one.'}</span> : null}
      </div> : null}
      {!list && (notice || !located) ? <p role="status" className="m-0 px-3 py-2 text-caption-1-regular text-text-tertiary">{notice ?? 'The selected text changed. The original selection is retained.'}</p> : null}
      {!list && editing ? <div className="flex min-h-0 flex-col gap-2 p-3">
        <blockquote tabIndex={0} aria-label="Selected document text" className="focus-visible:ring-2 focus-visible:ring-border-focus-ring m-0 max-h-32 overflow-y-auto whitespace-pre-wrap break-words border-s-2 border-separator-border ps-2 text-caption-1-regular text-text-tertiary">{documentCommentQuote(target)}</blockquote>
        <RootCommentRecovery failure={root.failure} stale={root.stale} deleted={root.deleted} busy={busy} onRebase={root.rebase} />
        <CommentMentions value={draft} onChange={setDraft}><TextareaBase aria-label="Comment on selected text" value={draft} onChange={event => setDraft(event.target.value)} rows={3} maxLength={20000} /></CommentMentions>
        <div className="flex justify-end gap-1"><Button variant="ghost" size="small" iconOnly className={commentIconButton} leadingIcon={RiChatNewLine} aria-label="Save comment and add to chat" disabled={busy || !draft.trim() || root.deleted || root.stale} onClick={() => { void save(true); }} /><Button variant="ghost" size="small" iconOnly className={commentIconButton} leadingIcon={RiArrowUpLine} aria-label="Save comment" disabled={busy || !draft.trim() || root.deleted || root.stale} onClick={() => { void save(false); }} /></div>
      </div> : null}
      {selected && !editing ? <div hidden={list} className="flex min-h-0 flex-1 flex-col p-3">
        <blockquote tabIndex={0} aria-label="Selected document text" className="focus-visible:ring-2 focus-visible:ring-border-focus-ring m-0 mb-2 max-h-32 overflow-y-auto whitespace-pre-wrap break-words border-s-2 border-separator-border ps-2 text-caption-1-regular text-text-tertiary">{documentCommentQuote(current ?? selected)}</blockquote>
        <SavedCommentThread key={selected.id} projectId={projectId} hideClose comment={current ?? selected} deleted={!current} hidden={list} onDirty={value => { setReplyDirty(value); setReplyRevision(revision => revision + 1); }} onClose={() => { void close(); }} onViewAll={() => setList(true)}
          onEditRoot={() => { setEditing(true); setDraft((current ?? selected).note); }} onDeleteRoot={remove} canEditRoot={canEditComment(current ?? selected, authority)} canDeleteRoot={canDeleteComment(current ?? selected, authority)} existingImages={(current ?? selected).attachments?.map(image => ({ ...image, url: projectRawUrl(projectId, image.path) })) ?? []} />
        {canSendCommentToAgent(current ?? selected, authority) ? <Button variant="ghost" size="small" iconOnly className={commentIconButton} leadingIcon={RiChatNewLine} aria-label="Add comment to chat" disabled={replyDirty || busy} onClick={() => { void send(); }} /> : null}
      </div> : null}
      </div>
      <ScrollFade progress={cardScroll.progress} />
      </div>
    </aside> : null}
  </>;
}
