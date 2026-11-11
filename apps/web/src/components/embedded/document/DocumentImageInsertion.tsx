import { useContext, useLayoutEffect, useRef, useState } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $createParagraphNode, $createRangeSelection, $getNodeByKey, $getRoot, $getSelection, $insertNodes, $isElementNode, $isRangeSelection, $isTextNode, $setSelection, type RangeSelection } from 'lexical';
import { RiImageLine } from '@remixicon/react';
import { Button } from '../boardui/button';
import { DOCUMENT_ICON_BUTTON } from './document-controls';
import { DocumentImageScope, $createDocumentImageNode } from './DocumentImageNode';
import { markdownRelativeProjectPath } from '../../markdown-image-path';
import { uploadDocumentImage, type DocumentImageReceipt } from './document-image-upload';
type InsertionPoint = { selection: RangeSelection; revision: number };

/** Keep asynchronous uploads bound to this editor and its captured insertion point. */
export function DocumentImageInsertion({ onStatus }: { onStatus?(message: string | null): void }) {
  const [editor] = useLexicalComposerContext(); const scope = useContext(DocumentImageScope);
  const input = useRef<HTMLInputElement>(null); const point = useRef<InsertionPoint | null>(null);
  const receipt = useRef<DocumentImageReceipt | null>(null); const revision = useRef(0);
  const life = useRef({ active: true, generation: 0, controller: null as AbortController | null });
  const status = useRef(onStatus); status.current = onStatus;
  const [busy, setBusy] = useState(false); const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    const current = life.current; current.active = true;
    const unregister = editor.registerUpdateListener(({ dirtyElements, dirtyLeaves }) => { if (dirtyElements.size || dirtyLeaves.size) revision.current++; });
    return () => { current.active = false; current.generation++; current.controller?.abort(); unregister(); };
  }, [editor]);
  const capture = (): InsertionPoint => editor.getEditorState().read(() => {
    const selected = $getSelection();
    if ($isRangeSelection(selected)) return { selection: selected.clone(), revision: revision.current };
    const selection = $createRangeSelection(); const root = $getRoot();
    selection.anchor.set(root.getKey(), root.getChildrenSize(), 'element'); selection.focus.set(root.getKey(), root.getChildrenSize(), 'element');
    return { selection, revision: revision.current };
  });
  const insert = (asset: DocumentImageReceipt, at: InsertionPoint): boolean => {
    if (!scope || !life.current.active || at.revision !== revision.current) return false;
    let inserted = false;
    editor.update(() => {
      const valid = [at.selection.anchor, at.selection.focus].every(position => {
        const node = $getNodeByKey(position.key);
        return node?.isAttached() && (position.type === 'text' ? $isTextNode(node) && position.offset <= node.getTextContentSize() : $isElementNode(node) && position.offset <= node.getChildrenSize());
      });
      if (!valid) return;
      $setSelection(at.selection.clone());
      $insertNodes([$createParagraphNode().append($createDocumentImageNode({ src: markdownRelativeProjectPath(scope.fileName, asset.name), alt: asset.alt, width: asset.width, height: asset.height }))]);
      inserted = true;
    }, { discrete: true });
    if (inserted) { receipt.current = null; setReady(false); status.current?.(null); }
    return inserted;
  };
  const choose = () => {
    if (!scope || life.current.controller) return;
    const at = capture(); point.current = at;
    if (receipt.current) {
      if (!insert(receipt.current, at)) status.current?.('Choose a location in the document, then select Image again.');
      return;
    }
    input.current?.click();
  };
  const upload = async (file: File) => {
    if (!scope || life.current.controller) return;
    const current = life.current; const generation = ++current.generation;
    const controller = new AbortController(); current.controller = controller;
    const at = point.current ?? capture();
    setBusy(true); status.current?.('Uploading image…');
    try {
      const asset = await uploadDocumentImage(scope.projectId, file, controller.signal);
      if (!current.active || current.generation !== generation || controller.signal.aborted) return;
      receipt.current = asset;
      if (!insert(asset, at)) { setReady(true); status.current?.('Image uploaded. Choose a location, then select Image to insert.'); }
    } catch (error) {
      if (current.active && current.generation === generation && !controller.signal.aborted) status.current?.(error instanceof Error ? error.message : 'The image could not be uploaded.');
    } finally {
      if (current.controller === controller) current.controller = null;
      if (current.active && current.generation === generation) setBusy(false);
    }
  };
  if (!scope) return null;
  return <>
    <Button variant="ghost" size="small" iconOnly className={DOCUMENT_ICON_BUTTON} leadingIcon={RiImageLine} aria-label={ready ? 'Insert uploaded image' : 'Image'} title={busy ? 'Uploading image…' : ready ? 'Insert uploaded image' : 'Image'} disabled={busy} onMouseDown={event => event.preventDefault()} onClick={choose} />
    <input ref={input} hidden type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" aria-label="Choose document image" onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void upload(file); }} />
  </>;
}
