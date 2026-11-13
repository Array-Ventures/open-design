'use client';
import { useState, type ReactNode } from 'react';
import { ContextMenu, ContextMenuItem, ContextMenuTrigger } from '../boardui/context-menu';
import { workbookStructureActions, type WorkbookStructureAction, type WorkbookStructureMenuController, type WorkbookStructureSelection } from './grid-structure-actions';
const labels: Record<WorkbookStructureAction, string> = { 'row-before': 'Insert rows above', 'row-after': 'Insert rows below', 'row-delete': 'Delete rows', 'column-before': 'Insert columns left', 'column-after': 'Insert columns right', 'column-delete': 'Delete columns' };
/** Selection is captured at the opening gesture and revalidated by the live
 * owner at execution. A menu never supplies workbook or source authority. */
export function WorkbookStructureMenu({ controller, disabled, resetKey, children }: { controller: WorkbookStructureMenuController | null; disabled: boolean; resetKey?: string; children: ReactNode }) {
  const [selection, setSelection] = useState<WorkbookStructureSelection | null>(null), [error, setError] = useState<string | null>(null);
  const open = () => { const current = controller?.read() ?? null; setSelection(current); setError(null); return Boolean(current && Object.values(current.allowed).some(Boolean)); };
  const actions = workbookStructureActions.filter(action => selection?.axis === 'row' ? action.startsWith('row-') : selection?.axis === 'column' ? action.startsWith('column-') : true);
  return <>
    <ContextMenuTrigger capture resetKey={resetKey} isDisabled={disabled || !controller} onBeforeOpen={open} onOpenChange={opened => { if (!opened) setSelection(null); }}>
      {children}
      <ContextMenu aria-label="Worksheet rows and columns" onAction={key => {
        if (!selection || !controller || !workbookStructureActions.includes(key as WorkbookStructureAction)) return;
        try { controller.run(key as WorkbookStructureAction, selection.key); setError(null); }
        catch (cause) { setError(cause instanceof Error ? cause.message : 'The worksheet could not be changed.'); }
      }}>
        {actions.map((action) => <ContextMenuItem key={action} id={action} isDisabled={!selection?.allowed[action]} variant={action.endsWith('-delete') ? 'danger' : undefined}>{labels[action]}</ContextMenuItem>)}
      </ContextMenu>
    </ContextMenuTrigger>
    {error ? <div role="alert" className="absolute bottom-3 start-3 z-20 max-w-sm rounded-lg border border-border-error-default bg-background-primary-default px-3 py-2 text-caption-1-regular text-text-error-primary">{error}</div> : null}
  </>;
}
