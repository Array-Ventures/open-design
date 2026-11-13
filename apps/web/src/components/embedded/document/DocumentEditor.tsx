'use client';

import { DocumentComments } from './DocumentComments';
import { DocumentTableActions } from './DocumentTableActions';
import type { ArtifactFeedbackProps } from '../LiveArtifactFeedbackPreview';

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { ListPlugin } from '@lexical/react/LexicalListPlugin';
import { TablePlugin } from '@lexical/react/LexicalTablePlugin';
import { CheckListPlugin } from '@lexical/react/LexicalCheckListPlugin';
import { CodeNode, CodeHighlightNode } from '@lexical/code';
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { $generateHtmlFromNodes, $generateNodesFromDOM } from '@lexical/html';
import { HeadingNode, QuoteNode } from '@lexical/rich-text';
import { ListNode, ListItemNode } from '@lexical/list';
import { TableNode, TableRowNode, TableCellNode } from '@lexical/table';
import { LinkNode } from '@lexical/link';
import { $getRoot, $getState, $setState, $insertNodes, $setSelection, RootNode } from 'lexical';
import { serializeMarkdownDocument } from './markdown-serialization';
import { documentHtml, documentImport, documentFontFamily, documentRootAttributes, preserveDocumentRootAttributes } from './document-html';
import { documentHtmlConfig, initializeDocumentBlockIds, ensureDocumentBlockIds, documentFont, documentHeadingFont, restoreDocumentIdentityGroups } from './document-identity';
import { saveDocumentFile, type DocumentFile } from './document-file';
import { DocumentWriter, type DocumentWriteState } from './document-writer';
import { DOCUMENT_ICON_BUTTON } from './document-controls';
import { DocumentImageNode, DocumentImageScope } from './DocumentImageNode';
import { DocumentCellContrast } from './DocumentCellContrast';
import { DocumentOutline } from './DocumentOutline';
import { DocumentToolbar } from './DocumentToolbar';
import styles from './DocumentEditor.module.css';
import { Button } from '../boardui/button';
import { RiSaveLine, RiPencilLine, RiArrowDownSLine } from '@remixicon/react';
import { ScrollFade, useScrollFade } from '../boardui/scroll-fade';
import { Dropdown, DropdownTrigger, DropdownPopover, DropdownItem } from '../boardui/dropdown';

export const documentNodes = [HeadingNode, QuoteNode, ListNode, ListItemNode, TableNode, TableRowNode, TableCellNode, LinkNode, CodeNode, CodeHighlightNode, DocumentImageNode];

export function DocumentEditor({ feedback, onCommentDirtyChange, projectId, fileName, title, observed, onSaved, onDirtyChange, onWriteError }: {
  onCommentDirtyChange?(dirty: boolean): void; feedback?: ArtifactFeedbackProps; projectId: string; fileName: string; title: string; observed: DocumentFile; onSaved(saved: DocumentFile): void; onDirtyChange?(dirty: boolean, saving: boolean): void; onWriteError?(error: string | null): void;
}) {
  const imageScope = useMemo(() => ({ projectId, fileName }), [projectId, fileName]);
  const owners = useMemo(() => new Map<string, string>(), []);
  const [failure, setFailure] = useState<string | null>(null);
  const initialConfig = useMemo(() => ({
    namespace: `document:${projectId}:${fileName}`, theme: { tableScrollableWrapper: styles.tableScroll, code: styles.code, text: { code: styles.inlineCode, underline: styles.underline, strikethrough: styles.strikethrough, underlineStrikethrough: styles.underlineStrikethrough }, list: { checklist: styles.checklist, listitemChecked: styles.checked, listitemUnchecked: styles.unchecked } }, nodes: documentNodes, html: documentHtmlConfig(),
    onError: (error: Error) => { setFailure(error.message); },
    editorState: (editor: import('lexical').LexicalEditor) => {
      const root = $getRoot(); root.select(); $insertNodes($generateNodesFromDOM(editor, documentImport(observed.html))); $setSelection(null);
      const attributes = new DOMParser().parseFromString(observed.html, 'text/html').documentElement;
      const rootDirection = attributes.getAttribute('dir');
      if (rootDirection === 'ltr' || rootDirection === 'rtl') root.setDirection(rootDirection);
      const font = attributes.getAttribute('data-eve-document-font');
      const headingFont = attributes.getAttribute('data-eve-document-heading-font') ?? font;
      $setState(root, documentFont, font === 'serif' ? 'serif' : 'sans');
      $setState(root, documentHeadingFont, headingFont === 'serif' ? 'serif' : 'sans'); restoreDocumentIdentityGroups(observed.identities); initializeDocumentBlockIds(owners, observed.sha256);
    },
  }), [projectId, fileName, observed.html, owners]);
  return <div className={styles.editor} data-testid="document-editor">
    {failure ? <div role="alert" className="p-3 text-body-2-regular text-text-error-primary">{failure}</div> : null}
    <DocumentImageScope.Provider value={imageScope}><LexicalComposer initialConfig={initialConfig}>
      <DocumentCellContrast />
      <DocumentBody onCommentDirtyChange={onCommentDirtyChange} feedback={feedback} projectId={projectId} fileName={fileName} title={title} observed={observed} owners={owners} onSaved={onSaved} onDirtyChange={onDirtyChange} onWriteError={onWriteError} />
      <HistoryPlugin /><ListPlugin /><CheckListPlugin /><TablePlugin hasHorizontalScroll /><LinkPlugin />
    </LexicalComposer></DocumentImageScope.Provider>
  </div>;
}

function DocumentBody({ feedback, onCommentDirtyChange, projectId, fileName, title, observed, owners, onSaved, onDirtyChange, onWriteError }: {
  onCommentDirtyChange?(dirty: boolean): void; feedback?: ArtifactFeedbackProps; projectId: string; fileName: string; title: string; observed: DocumentFile; owners: Map<string, string>; onSaved(saved: DocumentFile): void; onDirtyChange?(dirty: boolean, saving: boolean): void; onWriteError?(error: string | null): void;
}) {
  const [editor] = useLexicalComposerContext();
  const rootAttributes = useMemo(() => documentRootAttributes(observed.html), [observed.html]);
  const fade = useScrollFade();
  const [writeState, setWriteState] = useState<DocumentWriteState>({ dirty: false, saving: false, error: null });
  const [font, setFont] = useState<'sans' | 'serif'>('sans');
  const [headingFont, setHeadingFont] = useState<'sans' | 'serif'>('serif');
  const [imageStatus, setImageStatus] = useState<string | null>(null);
  const [editing, setEditing] = useState(true);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const writer = useRef<DocumentWriter | null>(null);
  const controllerId = useRef(crypto.randomUUID()).current;
  useLayoutEffect(() => {
    if (window.parent === window) return;
    const publish = () => window.parent.postMessage({ type: 'studio:document-state', projectId, controllerId, dirty: writeState.dirty }, window.location.origin);
    const receive = (event: MessageEvent) => {
      if (event.source === window.parent && event.origin === window.location.origin && event.data?.type === 'studio:artifact-request' && event.data.projectId === projectId) publish();
    };
    publish(); window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [projectId, controllerId, writeState.dirty]);
  useEffect(() => () => {
    if (window.parent !== window) window.parent.postMessage({ type: 'studio:document-unavailable', projectId, controllerId }, window.location.origin);
  }, [projectId, controllerId]);
  const saved = useRef(onSaved); saved.current = onSaved;
  const writeErrorChanged = useRef(onWriteError); writeErrorChanged.current = onWriteError;
  useLayoutEffect(() => () => { writer.current?.stop(); }, []);
  const dirtyChanged = useRef(onDirtyChange); dirtyChanged.current = onDirtyChange;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const serialize = () => observed.format === 'markdown' ? serializeMarkdownDocument(editor) : preserveDocumentRootAttributes(documentHtml(title, $generateHtmlFromNodes(editor), $getState($getRoot(), documentFont), $getState($getRoot(), documentHeadingFont)), rootAttributes);
    const initial = editor.getEditorState().read(serialize);
    const current = writer.current ??= new DocumentWriter(observed, initial, async (html, base) => {
      const result = await saveDocumentFile(projectId, fileName, html, base); saved.current(result); return result;
    }, state => { dirtyChanged.current?.(state.dirty, state.saving); writeErrorChanged.current?.(state.error); setWriteState(state); });
    current.start();
    const normalize = editor.registerNodeTransform(RootNode, () => ensureDocumentBlockIds(owners));
    editor.getEditorState().read(() => { setFont($getState($getRoot(), documentFont)); setHeadingFont($getState($getRoot(), documentHeadingFont)); });
    const stop = editor.registerUpdateListener(({ editorState, dirtyElements, dirtyLeaves }) => {
      if (!dirtyElements.size && !dirtyLeaves.size) return;
      editorState.read(() => { current.change(serialize()); setFont($getState($getRoot(), documentFont)); setHeadingFont($getState($getRoot(), documentHeadingFont)); });
      clearTimeout(timer);
      if (!current.state().error) timer = setTimeout(() => { void current.flush(); }, 750);
    });
    const unload = (event: BeforeUnloadEvent) => { if (current.state().dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', unload);
    return () => { clearTimeout(timer); normalize(); stop(); current.stop(); window.removeEventListener('beforeunload', unload); };
  }, [editor, fileName, observed, owners, projectId, title, rootAttributes]);
  const status = writeState.error ? 'Not saved' : writeState.saving ? 'Saving…' : writeState.dirty ? 'Unsaved changes' : 'Saved';
  return <>
    <div className="flex shrink-0 items-center justify-end gap-2 px-3 py-2 text-caption-1-regular text-text-tertiary" >
      <DocumentOutline />
      <span role="status">{status}</span>
      {writeState.dirty ? <Button variant="ghost" size="small" iconOnly className={DOCUMENT_ICON_BUTTON} leadingIcon={RiSaveLine} aria-label="Save document" title="Save" disabled={writeState.saving || !writeState.dirty} onClick={() => { void writer.current?.flush(); }} /> : null}
      <Dropdown>
        <DropdownTrigger aria-label={`${editing ? 'Editing' : 'Viewing'}, mode`} className="box-border flex h-8 items-center gap-1 rounded-xl border-0 bg-background-secondary-default px-2 py-0 text-body-2-medium text-text-secondary hover:bg-background-secondary-hover focus-visible:ring-2 focus-visible:ring-border-focus-ring"><RiPencilLine className="size-4 shrink-0" aria-hidden />{editing ? 'Editing' : 'Viewing'}<RiArrowDownSLine className="size-4 shrink-0" aria-hidden /></DropdownTrigger>
        <DropdownPopover aria-label="Document mode" placement="bottom end">
          <DropdownItem onSelect={() => { editor.setEditable(true); setEditing(true); }}>Editing</DropdownItem>
          <DropdownItem onSelect={() => { editor.setEditable(false); setEditing(false); setImageStatus(null); }}>Viewing</DropdownItem>
        </DropdownPopover>
      </Dropdown>
    </div>
    {writeState.error && !onWriteError ? <div role="alert" className="px-4 py-2 text-body-2-regular text-text-error-primary">{writeState.error}</div> : null}
    {imageStatus ? <div role="status" className="px-4 py-2 text-body-2-regular text-text-secondary">{imageStatus}</div> : null}
    <div className="relative min-h-0 flex-1">
    <div className={styles.scroll} onScroll={fade.onScroll}>
      <div className={styles.page}>
        <DocumentTableActions enabled={editing && !commentsOpen}><RichTextPlugin contentEditable={<ContentEditable aria-label={title} lang={rootAttributes.lang ?? undefined} dir={rootAttributes.dir ?? undefined} className={styles.content} style={{ fontFamily: documentFontFamily(font), '--document-heading-font': documentFontFamily(headingFont) } as CSSProperties} />}
          placeholder={<div className={styles.placeholder}>Start writing…</div>} ErrorBoundary={LexicalErrorBoundary} /></DocumentTableActions>
      </div>
    </div>
    {feedback ? <DocumentComments onOpenChange={setCommentsOpen} onDirtyChange={onCommentDirtyChange} projectId={projectId} fileName={fileName} feedback={feedback} /> : null}
    <ScrollFade progress={fade.progress} surfaceClassName="from-background-primary-default" />
    </div>
    {editing ? <DocumentToolbar hidden={commentsOpen} font={font} headingFont={headingFont} onImageStatus={setImageStatus} /> : null}
  </>;
}
