import { useEffect, useState, type ReactNode } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { ContextMenu, ContextMenuItem, ContextMenuTrigger } from '../boardui/context-menu';
import { documentTableActions, readDocumentTableTarget, runDocumentTableAction, type DocumentTableAction, type DocumentTableTarget } from './document-table-actions';
const labels: Record<DocumentTableAction, string> = { 'row-before': 'Insert row above', 'row-after': 'Insert row below', 'column-before': 'Insert column left', 'column-after': 'Insert column right', 'row-delete': 'Delete row', 'column-delete': 'Delete column', 'table-delete': 'Delete table' };

function actionLabel(action: DocumentTableAction, target: DocumentTableTarget | null): string {
  if (action === 'row-delete' && target && target.rowSpan > 1) return `Delete ${target.rowSpan} rows`;
  if (action === 'column-delete' && target && target.columnSpan > 1) return `Delete ${target.columnSpan} columns`;
  return labels[action];
}

/** The table's Lexical owner retains authority while the menu is in a portal. */
export function DocumentTableActions({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const [editor] = useLexicalComposerContext();
  const [target, setTarget] = useState<DocumentTableTarget | null>(null);
  const [editable, setEditable] = useState(editor.isEditable()), [error, setError] = useState<string | null>(null);
  useEffect(() => editor.registerEditableListener(setEditable), [editor]);
  return <>
    <ContextMenuTrigger capture isDisabled={!enabled || !editable} onBeforeOpen={(node, keyboard) => {
      const captured = readDocumentTableTarget(editor, node, keyboard); setTarget(captured); setError(null); return Boolean(captured);
    }} onOpenChange={open => { if (!open) setTarget(null); }} getKeyboardAnchor={() => {
      const selected = readDocumentTableTarget(editor, null, true); return selected ? editor.getElementByKey(selected.cellKey) : null;
    }}>
      {children}
      <ContextMenu aria-label="Table rows and columns" onAction={key => {
        if (!enabled || !target || !documentTableActions.includes(key as DocumentTableAction)) return;
        try { runDocumentTableAction(editor, key as DocumentTableAction, target); setError(null); }
        catch (cause) { setError(cause instanceof Error ? cause.message : 'The table could not be changed.'); }
      }}>
        {documentTableActions.map(action => <ContextMenuItem key={action} id={action} variant={action.endsWith('delete') ? 'danger' : undefined}>{actionLabel(action, target)}</ContextMenuItem>)}
      </ContextMenu>
    </ContextMenuTrigger>
    {error ? <p role="alert" className="px-4 py-2 text-body-2-regular text-text-error-primary">{error}</p> : null}
  </>;
}
