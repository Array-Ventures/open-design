'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { ListPlugin } from '@lexical/react/LexicalListPlugin';
import { TablePlugin } from '@lexical/react/LexicalTablePlugin';
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { $generateHtmlFromNodes, $generateNodesFromDOM } from '@lexical/html';
import { HeadingNode, QuoteNode } from '@lexical/rich-text';
import { ListNode, ListItemNode } from '@lexical/list';
import { TableNode, TableRowNode, TableCellNode } from '@lexical/table';
import { LinkNode } from '@lexical/link';
import { $getRoot, $getState, $setState, RootNode } from 'lexical';
import { documentHtml, documentImport } from './document-html';
import { documentHtmlConfig, ensureDocumentBlockIds, documentFont } from './document-identity';
import { saveDocumentFile, type DocumentFile } from './document-file';
import { DocumentWriter, type DocumentWriteState } from './document-writer';
import { DOCUMENT_ICON_BUTTON } from './document-controls';
import { DocumentToolbar } from './DocumentToolbar';
import styles from './DocumentEditor.module.css';
import { Button } from '../boardui/button';
import { RiSaveLine, RiPencilLine, RiArrowDownSLine } from '@remixicon/react';
import { ScrollFade, useScrollFade } from '../boardui/scroll-fade';
import { Dropdown, DropdownTrigger, DropdownPopover, DropdownItem } from '../boardui/dropdown';

export const documentNodes = [HeadingNode, QuoteNode, ListNode, ListItemNode, TableNode, TableRowNode, TableCellNode, LinkNode];

export function DocumentEditor({ projectId, fileName, title, observed, onSaved, onDirtyChange }: {
  projectId: string; fileName: string; title: string; observed: DocumentFile; onSaved(saved: DocumentFile): void; onDirtyChange?(dirty: boolean, saving: boolean): void;
}) {
  const owners = useMemo(() => new Map<string, string>(), []);
  const [failure, setFailure] = useState<string | null>(null);
  const initialConfig = useMemo(() => ({
    namespace: `document:${projectId}:${fileName}`, theme: { tableScrollableWrapper: styles.tableScroll }, nodes: documentNodes, html: documentHtmlConfig(),
    onError: (error: Error) => { setFailure(error.message); },
    editorState: (editor: import('lexical').LexicalEditor) => {
      const root = $getRoot(); root.append(...$generateNodesFromDOM(editor, documentImport(observed.html)));
      const font = new DOMParser().parseFromString(observed.html, 'text/html').documentElement.getAttribute('data-eve-document-font');
      $setState(root, documentFont, font === 'serif' ? 'serif' : 'sans'); ensureDocumentBlockIds(owners);
    },
  }), [projectId, fileName, observed.html, owners]);
  return <div className={styles.editor} data-testid="document-editor">
    {failure ? <div role="alert" className="p-3 text-body-2-regular text-text-error-primary">{failure}</div> : null}
    <LexicalComposer initialConfig={initialConfig}>
      <DocumentBody projectId={projectId} fileName={fileName} title={title} observed={observed} owners={owners} onSaved={onSaved} onDirtyChange={onDirtyChange} />
      <HistoryPlugin /><ListPlugin /><TablePlugin hasHorizontalScroll /><LinkPlugin />
    </LexicalComposer>
  </div>;
}

function DocumentBody({ projectId, fileName, title, observed, owners, onSaved, onDirtyChange }: {
  projectId: string; fileName: string; title: string; observed: DocumentFile; owners: Map<string, string>; onSaved(saved: DocumentFile): void; onDirtyChange?(dirty: boolean, saving: boolean): void;
}) {
  const [editor] = useLexicalComposerContext();
  const fade = useScrollFade();
  const [writeState, setWriteState] = useState<DocumentWriteState>({ dirty: false, saving: false, error: null });
  const [font, setFont] = useState<'sans' | 'serif'>('sans');
  const [editing, setEditing] = useState(true);
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
  const dirtyChanged = useRef(onDirtyChange); dirtyChanged.current = onDirtyChange;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const serialize = () => documentHtml(title, $generateHtmlFromNodes(editor), $getState($getRoot(), documentFont));
    const initial = editor.getEditorState().read(serialize);
    const current = writer.current ??= new DocumentWriter(observed, initial, async (html, base) => {
      const result = await saveDocumentFile(projectId, fileName, html, base); saved.current(result); return result;
    }, state => { dirtyChanged.current?.(state.dirty, state.saving); setWriteState(state); });
    current.start();
    const normalize = editor.registerNodeTransform(RootNode, () => ensureDocumentBlockIds(owners));
    setFont(editor.getEditorState().read(() => $getState($getRoot(), documentFont)));
    const stop = editor.registerUpdateListener(({ editorState, dirtyElements, dirtyLeaves }) => {
      if (!dirtyElements.size && !dirtyLeaves.size) return;
      editorState.read(() => { current.change(serialize()); setFont($getState($getRoot(), documentFont)); });
      clearTimeout(timer);
      if (!current.state().error) timer = setTimeout(() => { void current.flush(); }, 750);
    });
    const unload = (event: BeforeUnloadEvent) => { if (current.state().dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', unload);
    return () => { clearTimeout(timer); normalize(); stop(); current.stop(); window.removeEventListener('beforeunload', unload); };
  }, [editor, fileName, observed, owners, projectId, title]);
  const status = writeState.error ? 'Not saved' : writeState.saving ? 'Saving…' : writeState.dirty ? 'Unsaved changes' : 'Saved';
  return <>
    <div className="flex shrink-0 items-center justify-end gap-2 px-3 py-2 text-caption-1-regular text-text-tertiary" >
      <span role="status">{status}</span>
      {writeState.dirty ? <Button variant="ghost" size="small" iconOnly className={DOCUMENT_ICON_BUTTON} leadingIcon={RiSaveLine} aria-label="Save document" title="Save" disabled={writeState.saving || !writeState.dirty} onClick={() => { void writer.current?.flush(); }} /> : null}
      <Dropdown>
        <DropdownTrigger aria-label={`${editing ? 'Editing' : 'Viewing'}, mode`} className="box-border flex h-8 items-center gap-1 rounded-xl border-0 bg-background-secondary-default px-2 py-0 text-body-2-medium text-text-secondary hover:bg-background-secondary-hover focus-visible:ring-2 focus-visible:ring-border-focus-ring"><RiPencilLine className="size-4 shrink-0" aria-hidden />{editing ? 'Editing' : 'Viewing'}<RiArrowDownSLine className="size-4 shrink-0" aria-hidden /></DropdownTrigger>
        <DropdownPopover aria-label="Document mode" placement="bottom end">
          <DropdownItem onSelect={() => { editor.setEditable(true); setEditing(true); }}>Editing</DropdownItem>
          <DropdownItem onSelect={() => { editor.setEditable(false); setEditing(false); }}>Viewing</DropdownItem>
        </DropdownPopover>
      </Dropdown>
    </div>
    {writeState.error ? <div role="alert" className="px-4 py-2 text-body-2-regular text-text-error-primary">{writeState.error}</div> : null}
    <div className="relative min-h-0 flex-1">
    <div className={styles.scroll} onScroll={fade.onScroll}>
      <div className={styles.page}>
        <RichTextPlugin contentEditable={<ContentEditable aria-label={title} className={styles.content} style={{ fontFamily: font === 'serif' ? 'Georgia, serif' : 'inherit' }} />}
          placeholder={<div className={styles.placeholder}>Start writing…</div>} ErrorBoundary={LexicalErrorBoundary} />
      </div>
    </div>
    <ScrollFade progress={fade.progress} surfaceClassName="from-background-primary-default" />
    </div>
    {editing ? <DocumentToolbar /> : null}
  </>;
}
