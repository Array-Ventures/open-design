import { readDocumentDateElement } from './document-date-source';
/** Source metadata describes a proposed change; it never grants editing authority. */
export type DocumentSuggestion = { id: string; operation: 'insert' | 'delete' | 'replace'; kind: 'insert' | 'delete' };
export const suggestionAttributes = ['data-eve-suggestion', 'data-eve-suggestion-id', 'data-eve-suggestion-operation'] as const;
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const inline = new Set(['STRONG', 'B', 'EM', 'I', 'U', 'S', 'SPAN', 'A', 'CODE']);
export function readDocumentSuggestion(element: Element): DocumentSuggestion | null {
  const id = element.getAttribute('data-eve-suggestion-id') ?? '';
  const operation = element.getAttribute('data-eve-suggestion-operation');
  const kind = element.tagName === 'INS' ? 'insert' : element.tagName === 'DEL' ? 'delete' : null;
  if (!kind || element.getAttribute('data-eve-suggestion') !== '1' || !idPattern.test(id)
    || !['insert', 'delete', 'replace'].includes(operation ?? '') || operation !== 'replace' && operation !== kind
    || Array.from(element.attributes).some(attribute => !suggestionAttributes.includes(attribute.name as typeof suggestionAttributes[number]))) return null;
  return { id, operation: operation as DocumentSuggestion['operation'], kind };
}
/** Validate the complete source before any sanitizer or editor can discard a segment. */
export function validDocumentSuggestions(root: ParentNode): boolean {
  const groups = new Map<string, Element[]>();
  for (const element of root.querySelectorAll('ins,del,[data-eve-suggestion],[data-eve-suggestion-id],[data-eve-suggestion-operation]')) {
    const value = readDocumentSuggestion(element);
    if (!value || !element.textContent || /[\r\n]/.test(element.textContent)
      || !element.closest('p,h1,h2,h3,h4,h5,h6,li')
      || Array.from(element.querySelectorAll('*')).some(child => !inline.has(child.tagName) && !readDocumentDateElement(child))) return false;
    const group = groups.get(value.id) ?? [];
    group.push(element); groups.set(value.id, group);
  }
  for (const group of groups.values()) {
    const first = readDocumentSuggestion(group[0]!)!;
    if (first.operation !== 'replace') { if (group.length !== 1) return false; continue; }
    if (group.length !== 2 || first.kind !== 'delete' || readDocumentSuggestion(group[1]!)?.kind !== 'insert'
      || readDocumentSuggestion(group[1]!)?.operation !== 'replace' || group[0]!.nextSibling !== group[1]) return false;
  }
  return true;
}
