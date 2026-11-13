import { documentTextStyles } from './document-styles';
import { $getState, $getRoot, $isElementNode, $setState, createState, ParagraphNode, $isTextNode, TextNode, type DOMConversionMap, type HTMLConfig, type Klass, type LexicalNode } from 'lexical';
import { DocumentImageNode } from './DocumentImageNode';
import { HeadingNode, QuoteNode } from '@lexical/rich-text';
import { CodeNode } from '@lexical/code';
import { ListItemNode, ListNode } from '@lexical/list';
import { TableCellNode, TableNode, TableRowNode } from '@lexical/table';

export const documentBlockId = createState('eveDocumentBlockId', { parse: value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value) ? value : '' });
const blocks: readonly Klass<LexicalNode>[] = [ParagraphNode, HeadingNode, QuoteNode, ListItemNode, TableCellNode, CodeNode, ListNode, TableNode, DocumentImageNode];

/** Keep saved annotation identities when importing and exporting structured text. */
export function documentHtmlConfig(): HTMLConfig {
  const imports: DOMConversionMap = {};
  const exports: NonNullable<HTMLConfig['export']> = new Map();
  const candidates = new Map<string, NonNullable<DOMConversionMap[string]>[]>();
  for (const Block of [...blocks, TextNode, TableRowNode]) {
    for (const [tag, convert] of Object.entries(Block.importDOM?.() ?? {})) {
      const list = candidates.get(tag) ?? []; list.push(convert); candidates.set(tag, list);
    }
    exports.set(Block, (editor, node) => {
      const output = node.exportDOM(editor);
      // Do not freeze the SDK's placeholder column width or implicit start alignment.
      if (node instanceof TableCellNode && output.element instanceof HTMLElement) {
        if (!node.getWidth()) output.element.style.removeProperty('width');
        if (!node.getFormatType() && output.element.style.textAlign === 'start') output.element.style.removeProperty('text-align');
      }
      const id = $getState(node, documentBlockId);
      if (id && output.element instanceof HTMLElement) output.element.setAttribute('data-od-id', id);
      return output;
    });
  }
  for (const [tag, providers] of candidates) imports[tag] = element => {
    const conversion = providers.map(provider => provider(element)).filter(item => item !== null).sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))[0];
    if (!conversion) return null;
    return { ...conversion, conversion: dom => {
      const output = conversion.conversion(dom);
      // Preserve supported authored inline styles while retaining Lexical's format conversion.
      if (output && element instanceof HTMLElement && ['span', 'strong', 'b', 'em', 'i', 'u', 's', 'code'].includes(tag)) {
        const original = output.forChild;
        output.forChild = (child, parent) => {
          const converted = original ? original(child, parent) : child;
          if ($isTextNode(converted)) {
            const style = document.createElement('span').style;
            style.cssText = converted.getStyle();
            // Lexical applies ancestor forChild callbacks before descendants. Resolve
            // this element's DOM ancestry too: a nested span replaces its ancestor's
            // callback under Lexical's tag-keyed map, but must retain inherited styles.
            const ancestry: HTMLElement[] = [];
            for (let current: HTMLElement | null = element; current; current = current.parentElement) ancestry.unshift(current);
            for (const ancestor of ancestry) for (const [name, pattern] of documentTextStyles) {
              const value = ancestor.style.getPropertyValue(name);
              if (pattern.test(value)) style.setProperty(name, value);
            }
            converted.setStyle(style.cssText);
          }
          return converted;
        };
      }
      const nodes = output?.node ? Array.isArray(output.node) ? output.node : [output.node] : [];
      for (const node of nodes.filter(node => !$isTextNode(node))) {
        if ($isElementNode(node) && (element.dir === 'ltr' || element.dir === 'rtl')) node.setDirection(element.dir);
        $setState(node, documentBlockId, documentBlockId.parse(element.getAttribute('data-od-id')));
      }
      return output;
    } };
  };
  return { import: imports, export: exports };
}

/** Existing identities win over pasted copies, including copies inserted before them. */
export function documentBlockNodes(): LexicalNode[] {
  const nodes: LexicalNode[] = [];
  const visit = (node: LexicalNode) => {
    if (blocks.some(Block => node instanceof Block)) nodes.push(node);
    if ($isElementNode(node)) node.getChildren().forEach(visit);
  };
  $getRoot().getChildren().forEach(visit);
  return nodes;
}
export function documentIdentityGroups(): Record<string, string[]> {
  const groups: Record<string, string[]> = {};
  for (const node of documentBlockNodes()) (groups[node.getType()] ??= []).push($getState(node, documentBlockId));
  return groups;
}
export function restoreDocumentIdentityGroups(groups: Record<string, string[] | undefined> | undefined) {
  if (!groups) return;
  const nodes = new Map<string, LexicalNode[]>();
  for (const node of documentBlockNodes()) { const group = nodes.get(node.getType()) ?? []; group.push(node); nodes.set(node.getType(), group); }
  for (const [type, group] of nodes) {
    const ids = groups[type];
    if (ids?.length === group.length) group.forEach((node, index) => $setState(node, documentBlockId, documentBlockId.parse(ids[index])));
  }
}
export function ensureDocumentBlockIds(owners = new Map<string, string>()) {
  const nodes = documentBlockNodes();
  const live = new Set(nodes.map(node => node.getKey()));
  for (const [id, key] of owners) if (!live.has(key)) owners.delete(id);
  for (const node of nodes) {
    let id = $getState(node, documentBlockId);
    const owner = owners.get(id);
    if (!id || (owner && owner !== node.getKey())) {
      id = crypto.randomUUID(); $setState(node, documentBlockId, id);
    }
    owners.set(id, node.getKey());
  }
}

/** Missing identities on an unchanged imported source must survive comment-only
 * reopen without rewriting that source. Existing stored IDs always win; later
 * inserted/pasted blocks still use the normal ownership transform above. */
export function initializeDocumentBlockIds(owners: Map<string, string>, sourceIdentity: string) {
  const nodes = documentBlockNodes();
  for (const node of nodes) {
    const id = $getState(node, documentBlockId);
    if (id && !owners.has(id)) owners.set(id, node.getKey());
  }
  const source = sourceIdentity.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || 'source';
  for (const [index, node] of nodes.entries()) {
    const id = $getState(node, documentBlockId);
    if (id && owners.get(id) === node.getKey()) continue;
    let generated = `doc-${source}-${index}`, suffix = 0;
    while (owners.has(generated)) generated = `doc-${source}-${index}-${++suffix}`;
    $setState(node, documentBlockId, generated); owners.set(generated, node.getKey());
  }
}

export const documentFont = createState('eveDocumentFont', { parse: value => value === 'serif' ? 'serif' as const : 'sans' as const });

export const documentHeadingFont = createState('eveDocumentHeadingFont', { parse: value => value === 'serif' ? 'serif' as const : 'sans' as const });
