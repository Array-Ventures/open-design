import { $createParagraphNode, $getNodeByKey, $getRoot, $getSelection, $isRangeSelection, $getNearestNodeFromDOMNode, HISTORY_PUSH_TAG, type LexicalEditor, type LexicalNode } from 'lexical';
import { $deleteTableColumnAtSelection, $deleteTableRowAtSelection, $getTableCellNodeFromLexicalNode, $insertTableColumnAtSelection, $insertTableRowAtSelection, $isTableCellNode, $isTableNode, $isTableSelection } from '@lexical/table';

export const documentTableActions = ['row-before', 'row-after', 'column-before', 'column-after', 'row-delete', 'column-delete', 'table-delete'] as const;
export type DocumentTableAction = typeof documentTableActions[number];
export interface DocumentTableTarget { cellKey: string; tableKey: string; rowSpan: number; columnSpan: number }
/** Resolve the actual opening target, never the previously selected adjacent
 * cell. Keyboard openings use the live Lexical selection instead of a pointer. */
export function readDocumentTableTarget(editor: LexicalEditor, target: EventTarget | null, keyboard: boolean): DocumentTableTarget | null {
  if (!editor.isEditable()) return null;
  return editor.getEditorState().read(() => {
    const root = editor.getRootElement(), selection = $getSelection();
    let node: LexicalNode | null = null;
    if (keyboard) {
      if ($isRangeSelection(selection) || $isTableSelection(selection)) node = selection.anchor.getNode();
    } else if (target instanceof Node && root?.contains(target)) node = $getNearestNodeFromDOMNode(target);
    const cell = node && $getTableCellNodeFromLexicalNode(node), table = cell?.getParents().find($isTableNode);
    return cell?.isAttached() && table ? { cellKey: cell.getKey(), tableKey: table.getKey(), rowSpan: cell.getRowSpan(), columnSpan: cell.getColSpan() } : null;
  }, { editor });
}
/** All mutations use the pinned merge-aware Lexical helpers and normal history.
 * A portal opening cannot retarget the action to a different selection. */
export function runDocumentTableAction(editor: LexicalEditor, action: DocumentTableAction, target: DocumentTableTarget): void {
  if (!documentTableActions.includes(action)) throw Error('That table action is unavailable.');
  if (!editor.isEditable()) throw Error('This document is in viewing mode.');
  let stale = false;
  editor.update(() => {
    const cell = $getNodeByKey(target.cellKey), table = $getNodeByKey(target.tableKey);
    if (!$isTableCellNode(cell) || !$isTableNode(table) || !cell.isAttached() || cell.getParents().find($isTableNode)?.getKey() !== table.getKey() || cell.getRowSpan() !== target.rowSpan || cell.getColSpan() !== target.columnSpan) { stale = true; return; }
    cell.selectStart();
    if (action === 'row-before' || action === 'row-after') $insertTableRowAtSelection(action === 'row-after');
    else if (action === 'column-before' || action === 'column-after') $insertTableColumnAtSelection(action === 'column-after');
    else if (action === 'row-delete') $deleteTableRowAtSelection();
    else if (action === 'column-delete') $deleteTableColumnAtSelection();
    else { table.selectPrevious(); table.remove(); }
    if (!$getRoot().getChildrenSize()) $getRoot().append($createParagraphNode()).selectStart();
  }, { discrete: true, tag: HISTORY_PUSH_TAG });
  if (stale) throw Error('That table cell changed. Open its menu again.');
  editor.focus();
}
