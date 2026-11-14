import { $getRoot, $hasUpdateTag, $isElementNode, type LexicalEditor, type LexicalNode } from 'lexical';
import { $isDocumentSuggestionNode } from './DocumentSuggestionNode';
export const DOCUMENT_SUGGESTION_UPDATE_TAG = 'document-suggestion';
export class DocumentSuggestionInputError extends Error {}
function source(node: LexicalNode): object {
  return $isElementNode(node) ? { ...node.exportJSON(), children: node.getChildren().map(source) } : node.exportJSON();
}
function proposals(): string {
  const values: object[] = [];
  const visit = (node: LexicalNode) => {
    if ($isDocumentSuggestionNode(node)) values.push({ parents: node.getParents().map(parent => ({ key: parent.getKey(), data: parent.exportJSON() })), node: source(node) });
    else if ($isElementNode(node)) node.getChildren().forEach(visit);
  };
  $getRoot().getChildren().forEach(visit);
  return JSON.stringify(values);
}
/** Root transforms run before commit, history listeners and the conditional writer.
 * Throwing uses Lexical's existing error recovery to restore its committed state;
 * an invalid update must never become an Undo/Redo entry or a queued source write.
 */
export function assertDocumentSuggestionUpdate(editor: LexicalEditor, mode: 'editing' | 'suggesting' | 'viewing'): void {
  if ($hasUpdateTag(DOCUMENT_SUGGESTION_UPDATE_TAG)) return;
  const currentProposals = proposals();
  const previous = editor.getEditorState().read(() => ({ proposals: proposals(), source: mode === 'editing' ? null : JSON.stringify(source($getRoot())) }));
  if (currentProposals !== previous.proposals || mode !== 'editing' && JSON.stringify(source($getRoot())) !== previous.source) {
    throw new DocumentSuggestionInputError('This unsupported change was blocked. Use the suggestion controls or switch to Editing.');
  }
}
