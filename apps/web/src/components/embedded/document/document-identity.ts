import { $getState, $getRoot, $isElementNode, $setState, createState, ParagraphNode, type DOMConversionMap, type HTMLConfig, type Klass, type LexicalNode } from 'lexical';
import { HeadingNode, QuoteNode } from '@lexical/rich-text';
import { ListItemNode } from '@lexical/list';
import { TableCellNode } from '@lexical/table';

export const documentBlockId = createState('eveDocumentBlockId', { parse: value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value) ? value : '' });
const blocks: readonly Klass<LexicalNode>[] = [ParagraphNode, HeadingNode, QuoteNode, ListItemNode, TableCellNode];

/** Keep saved annotation identities when importing and exporting structured text. */
export function documentHtmlConfig(): HTMLConfig {
  const imports: DOMConversionMap = {};
  const exports: NonNullable<HTMLConfig['export']> = new Map();
  const candidates = new Map<string, NonNullable<DOMConversionMap[string]>[]>();
  for (const Block of blocks) {
    for (const [tag, convert] of Object.entries(Block.importDOM?.() ?? {})) {
      const list = candidates.get(tag) ?? []; list.push(convert); candidates.set(tag, list);
    }
    exports.set(Block, (editor, node) => {
      const output = node.exportDOM(editor);
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
      const nodes = output?.node ? Array.isArray(output.node) ? output.node : [output.node] : [];
      for (const node of nodes) $setState(node, documentBlockId, documentBlockId.parse(element.getAttribute('data-od-id')));
      return output;
    } };
  };
  return { import: imports, export: exports };
}

/** Existing identities win over pasted copies, including copies inserted before them. */
export function ensureDocumentBlockIds(owners = new Map<string, string>()) {
  const nodes: LexicalNode[] = [];
  const visit = (node: LexicalNode) => {
    if (blocks.some(Block => node instanceof Block)) nodes.push(node);
    if ($isElementNode(node)) node.getChildren().forEach(visit);
  };
  $getRoot().getChildren().forEach(visit);
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

export const documentFont = createState('eveDocumentFont', { parse: value => value === 'serif' ? 'serif' as const : 'sans' as const });

export const documentHeadingFont = createState('eveDocumentHeadingFont', { parse: value => value === 'serif' ? 'serif' as const : 'sans' as const });
