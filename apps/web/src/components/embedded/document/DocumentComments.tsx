import { COMMAND_PRIORITY_EDITOR } from 'lexical';
import { hasCommentBody, useCommentChatDefault } from '../useCommentChatDefault';
import { Checkbox } from '../boardui/checkbox';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { RiArrowLeftLine, RiArrowUpLine, RiChatNewLine, RiCloseLine } from '@remixicon/react';
import type { PreviewComment, PreviewCommentTarget } from '../../../types';
import { projectRawUrl } from '../../../providers/registry';
import { commentsToAttachments } from '../../../comments';
import { canDeleteComment, canEditComment, canSendCommentToAgent } from '../../../comments/comment-authority';
import { ArtifactAnnotationControls } from '../ArtifactAnnotationControls';
import type { ArtifactFeedbackProps } from '../LiveArtifactFeedbackPreview';
import { useEmbeddedMentionBots, useEmbeddedViewer } from '../host-viewer';
import { confirmHostFeedbackDiscard } from '../host-context';
import { Button } from '../boardui/button';
import { cx } from '../boardui/cx';
import { TextareaBase } from '../boardui/textarea';
import { ScrollFade, useScrollFade } from '../boardui/scroll-fade';
import { CommentMentions } from '../CommentMentions';
import { CommentAuthor, SavedCommentThread } from '../SavedCommentThread';
import { CommentReviewFilter, useCommentReview } from '../CommentReview';
import { COMMENT_DOCUMENT_SELECTION, useDocumentCommentSelection } from './useDocumentCommentSelection';
import { useDocumentCommentHighlight } from './useDocumentCommentHighlight';
import { useDocumentCommentPlacement } from './useDocumentCommentPlacement';
import { useRootCommentEditor } from '../useRootCommentEditor';
import { RootCommentRecovery } from '../RootCommentRecovery';
import { commentIconButton } from '../comment-button-style';
import { documentCommentQuote, documentCommentTarget, readDocumentCommentAnchor, resolveDocumentComment } from './document-comment-anchor';

/** Uses the existing authorized comment/CAS/reply/handoff services. The editor
 * owns exact text anchors; annotations never replace or freeze the document. */
export function DocumentComments({ projectId, fileName, feedback, onDirtyChange, onOpenChange }: { onOpenChange?(open: boolean): void; onDirtyChange?(dirty: boolean): void; projectId: string; fileName: string; feedback: ArtifactFeedbackProps }) {
  const [editor] = useLexicalComposerContext(), viewer = useEmbeddedViewer(), review = useCommentReview();
  const quoteId = useId();
  const [open, setOpen] = useState(false), [list, setList] = useState(false);
  useEffect(() => { onOpenChange?.(open && !list); return () => onOpenChange?.(false); }, [open, list, onOpenChange]);
  const [selected, setSelected] = useState<PreviewComment | null>(null), [target, setTarget] = useState<PreviewCommentTarget | null>(null);
  const [draft, setDraft] = useState(''), [editing, setEditing] = useState(false), [busy, setBusy] = useState(false), [replyDirty, setReplyDirty] = useState(false), [handoffPending, setHandoffPending] = useState(false), [notice, setNotice] = useState<string | null>(null);
  const [commentEpoch, setCommentEpoch] = useState(0);
  const [width, setWidth] = useState(320), [replyRevision, setReplyRevision] = useState(0);
  const [revision, update] = useState(0);
  const cardScroll = useScrollFade();
  useEffect(() => { cardScroll.reset(); }, [open, list, selected?.id, cardScroll.reset]);
  const selectionOwner = useDocumentCommentSelection(editor, JSON.stringify([projectId, fileName]));
  const bots = useEmbeddedMentionBots(), substantive = hasCommentBody(draft, bots);
  const life = useRef(true), pending = useRef(false);
  const returnFocus = useRef<() => void>(() => {});
  const current = feedback.previewComments?.find(comment => comment.id === selected?.id) ?? null;
  const authority = { viewerMemberId: viewer?.memberId ?? null, collabEnabled: true, isProjectOwner: false };
  const mayEdit = Boolean(viewer && canEditComment(current ?? selected, authority));
  const mayStage = Boolean(viewer && feedback.onSendBoardCommentAttachments && canSendCommentToAgent(current ?? selected, authority));
  const { selected: addToChat, choose: setAddToChat } = useCommentChatDefault(draft, JSON.stringify([commentEpoch, handoffPending ? null : selected?.id]), mayEdit && mayStage, editing);
  const persisted = useMemo(() => feedback.previewComments?.filter(comment => comment.filePath === fileName && readDocumentCommentAnchor(comment)) ?? [], [feedback.previewComments, fileName]);
  const dirty = busy || replyDirty || handoffPending || editing && (selected ? draft !== selected.note : substantive);
  const notify = useRef(onDirtyChange); notify.current = onDirtyChange;
  useEffect(() => { notify.current?.(dirty); }, [dirty, draft, replyRevision]);
  useEffect(() => () => notify.current?.(false), []);
  const dirtyRef = useRef(dirty); dirtyRef.current = dirty;
  const draftVersion = useRef<{ parts: readonly unknown[]; value: number }>({ parts: [], value: 0 });
  const draftParts = [draft, busy, replyRevision, editing, handoffPending, selected?.id, target];
  if (!draftParts.every((part, index) => Object.is(part, draftVersion.current.parts[index]))) draftVersion.current = { parts: draftParts, value: draftVersion.current.value + 1 };
  const draftCurrent = useRef(draft); draftCurrent.current = draft;
  const root = useRootCommentEditor({ existing: current, retained: selected, draft, hasExtras: false, selectionKey: selected?.id ?? JSON.stringify(target), onDraft: setDraft });
  useEffect(() => {
    life.current = true;
    const stop = editor.registerUpdateListener(({ dirtyElements, dirtyLeaves }) => {
      if (dirtyElements.size || dirtyLeaves.size) update(value => value + 1);
    });
    return () => { life.current = false; stop(); };
  }, [editor, fileName]);
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
  const showList = () => { selectionOwner.clear(); setList(true); };
  const reset = () => { selectionOwner.clear(); setCommentEpoch(value => value + 1); feedback.onDiscardPreviewCommentWrite?.(); setSelected(null); setTarget(null); setDraft(''); setEditing(false); setReplyDirty(false); setHandoffPending(false); setNotice(null); };
  const browseComments = async (focus: () => void) => {
    returnFocus.current = focus;
    if (pending.current) return;
    // The retained thread stays mounted in the list, including its reply draft.
    // New and edited root comments still leave their composer and need consent.
    if ((!selected || editing) && !await allowed()) return;
    if (!life.current || pending.current) return;
    if (editing) reset();
    setOpen(true); showList();
  };
  const close = async () => { if (!await allowed() || !life.current) return; reset(); setOpen(false); returnFocus.current(); };
  const begin = async () => {
    if (!viewer) return;
    const captured = selectionOwner.take();
    if (!await allowed() || !life.current) return;
    reset(); setOpen(true); setList(false);
    if (!captured || !editor.getEditorState().read(() => resolveDocumentComment(captured))) { setList(true); return; }
    setTarget(documentCommentTarget(fileName, captured)); setEditing(true);
  };
  const beginRef = useRef(begin); beginRef.current = begin;
  useEffect(() => editor.registerCommand(COMMENT_DOCUMENT_SELECTION, () => { void beginRef.current(); return true; }, COMMAND_PRIORITY_EDITOR), [editor]);
  const show = async (comment: PreviewComment) => {
    // Returning to the retained thread is navigation, not a target change.
    if (selected?.id === comment.id) { setOpen(true); setList(false); return; }
    if (!await allowed() || !life.current) return;
    reset(); setSelected(comment); setTarget(comment); setOpen(true); setList(false);
    const savedAnchor = readDocumentCommentAnchor(comment);
    if (!savedAnchor || !editor.getEditorState().read(() => resolveDocumentComment(savedAnchor))) setNotice('The selected text changed or was removed. The saved thread is still available.');
  };
  const save = async (attach: boolean) => {
    if (!mayEdit || attach && !mayStage || !target || !substantive || pending.current || !feedback.onSavePreviewComment || root.deleted || root.stale) return;
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
  useDocumentCommentHighlight(editor, open && !list ? location : null, revision);
  const placement = useDocumentCommentPlacement(editor, location, open && !list, revision, width);
  return <>
    <ArtifactAnnotationControls projectId={projectId} commenting={open && !list} marking={false} markupAvailable={false} dirty={dirty} disabled={!viewer}
      onComment={() => { void (open && !list ? close() : begin()); }} onMark={() => {}} onComments={focus => { void browseComments(focus); }} onDiscard={() => { if (!pending.current) { reset(); setOpen(false); } }} />
    {open ? <aside ref={placement.card} role="dialog" aria-label="Document comments" onFocusCapture={() => selectionOwner.clear()} onKeyDown={event => { if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); void close(); } }} className={cx(editing && "has-focus-visible:ring-2 has-focus-visible:ring-border-focus-ring", "absolute z-30 flex min-h-0 max-w-[calc(100%_-_24px)] flex-col rounded-2xl border border-border-button-default bg-background-primary-default shadow-lg", placement.style ? "left-[var(--document-comment-left)] right-auto top-[var(--document-comment-top)] max-h-[var(--document-comment-max-height)]" : "end-3 top-3 max-h-[calc(100%_-_24px)]")} style={{ width, ...placement.style }}>
      <div role="separator" aria-label="Resize document comments" aria-orientation="vertical" aria-valuemin={240} aria-valuemax={480} aria-valuenow={width} tabIndex={0}
        className="pointer-events-auto absolute inset-y-0 -start-1 w-2 cursor-col-resize focus-visible:ring-2 focus-visible:ring-border-focus-ring"
        onKeyDown={event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const grows = event.key === (getComputedStyle(event.currentTarget).direction === 'rtl' ? 'ArrowRight' : 'ArrowLeft'); setWidth(value => event.key === 'Home' ? 240 : event.key === 'End' ? 480 : Math.max(240, Math.min(480, value + (grows ? 16 : -16)))); } }}
        onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); }}
        onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) { const parent = event.currentTarget.parentElement?.getBoundingClientRect(); if (parent) setWidth(Math.max(240, Math.min(480, (getComputedStyle(event.currentTarget).direction === 'rtl' ? event.clientX - parent.left : parent.right - event.clientX)))); } }} onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} />
      {list || selected ? <header className="flex shrink-0 items-center gap-1 border-b border-separator-border px-3 py-2">
        {!list ? <Button variant="ghost" size="small" iconOnly className={commentIconButton} leadingIcon={RiArrowLeftLine} aria-label="All comments" onClick={showList} /> : null}
        {list && selected && !current ? <Button variant="ghost" size="small" iconOnly className={commentIconButton} leadingIcon={RiArrowLeftLine} aria-label="Return to deleted thread" title="Return to deleted thread" disabled={busy} onClick={() => { void show(selected); }} /> : null}
        <span className="min-w-0 flex-1 truncate text-body-2-medium text-text-primary">{list ? 'Comments' : 'Selected text'}</span>
        <CommentReviewFilter />
        <Button variant="ghost" size="small" iconOnly className={commentIconButton} leadingIcon={RiCloseLine} aria-label="Close comments" onClick={() => { void close(); }} />
      </header> : null}
      <div className="relative flex min-h-0 flex-col">
      <div onScroll={cardScroll.onScroll} className="min-h-0 overflow-y-auto">
      {list ? <div className="flex min-h-0 flex-col gap-2 p-3">
        {feedback.previewCommentsState === 'error' ? <Button variant="ghost" size="small" onClick={feedback.onRetryPreviewComments}>Retry comments</Button> : null}
        {persisted.filter(comment => review?.showResolved || comment.status !== 'resolved').map(comment => <Button key={comment.id} variant="ghost" className="h-auto min-h-0 justify-start rounded-lg bg-transparent p-2 text-start text-text-primary hover:bg-background-secondary-hover active:bg-background-secondary-default" onClick={() => { void show(comment); }}><span className="flex min-w-0 flex-col gap-1"><CommentAuthor name={comment.authorDisplayName} createdAt={comment.createdAt} /><span className="line-clamp-2 text-body-2-regular text-text-primary">{comment.note}</span><span className="line-clamp-2 whitespace-pre-wrap break-words text-caption-1-regular text-text-tertiary">{documentCommentQuote(comment)}</span></span></Button>)}
        {!persisted.filter(comment => review?.showResolved || comment.status !== 'resolved').length ? <span className="text-body-2-regular text-text-tertiary">{persisted.length ? 'No open comments.' : 'No comments yet. Select text to add one.'}</span> : null}
      </div> : null}
      {!list && (notice || !located) ? <p role="status" className="m-0 px-3 py-2 text-caption-1-regular text-text-tertiary">{notice ?? 'The selected text changed. The original selection is retained.'}</p> : null}
      {!list && editing ? <div className="flex min-h-0 flex-col gap-2 p-3">
        <span id={quoteId} className="sr-only">{documentCommentQuote(target)}</span>
        <RootCommentRecovery failure={root.failure} stale={root.stale} deleted={root.deleted} busy={busy} onRebase={root.rebase} />
        <CommentMentions value={draft} onChange={setDraft}><TextareaBase autoFocus={!selected} aria-describedby={quoteId} aria-label="Comment on selected text" placeholder="Add a comment" value={draft} onChange={event => setDraft(event.target.value)} autoResize rows={1} maxRows={5} resize="none" fieldClassName="rounded-none bg-transparent p-0 ring-0" className="px-0" maxLength={20000} readOnly={!mayEdit} /></CommentMentions>
        <div className="flex items-center justify-between gap-2">{!selected ? <Button variant="ghost" size="small" iconOnly className={commentIconButton} leadingIcon={RiCloseLine} aria-label="Close comments" onClick={() => { void close(); }} /> : null}{mayEdit && mayStage ? <Checkbox size="sm" isSelected={addToChat} onChange={setAddToChat} isDisabled={busy}>Add to chat</Checkbox> : <span />}{mayEdit ? <Button variant="ghost" size="small" iconOnly className={commentIconButton} leadingIcon={RiArrowUpLine} aria-label="Save comment" disabled={busy || !substantive || root.deleted || root.stale} onClick={() => { void save(addToChat); }} /> : null}</div>
      </div> : null}
      {selected && !editing ? <div hidden={list} className={cx("min-h-0 flex-1 flex-col p-3", list ? "hidden" : "flex")}>
        <blockquote tabIndex={0} aria-label="Selected document text" className="focus-visible:ring-2 focus-visible:ring-border-focus-ring m-0 mb-2 max-h-32 overflow-y-auto whitespace-pre-wrap break-words border-s-2 border-separator-border ps-2 text-caption-1-regular text-text-tertiary">{documentCommentQuote(current ?? selected)}</blockquote>
        <SavedCommentThread key={selected.id} projectId={projectId} hideClose comment={current ?? selected} deleted={!current} hidden={list} onDirty={value => { setReplyDirty(value); setReplyRevision(revision => revision + 1); }} onClose={() => { void close(); }} onViewAll={showList}
          onEditRoot={() => { setEditing(true); setDraft((current ?? selected).note); }} onDeleteRoot={remove} canEditRoot={canEditComment(current ?? selected, authority)} canDeleteRoot={canDeleteComment(current ?? selected, authority)} existingImages={(current ?? selected).attachments?.map(image => ({ ...image, url: projectRawUrl(projectId, image.path) })) ?? []} />
        {canSendCommentToAgent(current ?? selected, authority) ? <Button variant="ghost" size="small" iconOnly className={commentIconButton} leadingIcon={RiChatNewLine} aria-label="Add comment to chat" disabled={replyDirty || busy} onClick={() => { void send(); }} /> : null}
      </div> : null}
      </div>
      <ScrollFade progress={cardScroll.progress} />
      </div>
    </aside> : null}
  </>;
}
