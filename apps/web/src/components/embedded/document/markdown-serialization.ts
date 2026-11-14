import { $convertToMarkdownString, TRANSFORMERS, CODE, LINK, type ElementTransformer, type TextMatchTransformer } from '@lexical/markdown';
import { $generateHtmlFromNodes } from '@lexical/html';
import { $getRoot, $getState, $isElementNode, $isLineBreakNode, $isTextNode, type LexicalEditor, type LexicalNode } from 'lexical';
import { $isLinkNode } from '@lexical/link';
import { $isCodeNode } from '@lexical/code';
import { $isTableCellNode, $isTableNode, TableNode } from '@lexical/table';
import { documentBlockId, documentFont, documentHeadingFont, documentIdentityGroups } from './document-identity';
import { $isDocumentImageNode, DocumentImageNode } from './DocumentImageNode';
import { $isHorizontalRuleNode } from '@lexical/react/LexicalHorizontalRuleNode';
import { DocumentDividerNode, documentDividerStyle } from './DocumentDividerNode';
import { encodeMarkdownDocument } from './markdown-document';

/** Preserve formatting that standard Markdown cannot express as valid inline/block HTML. */
export function serializeMarkdownDocument(editor: LexicalEditor): string {
  let exported: Document | undefined;
  const htmlFor = (node: LexicalNode) => {
    // Selection export clones nodes, which Lexical forbids in a read-only serialization.
    // Export the complete snapshot once and select its already-stable block identity.
    exported ??= new DOMParser().parseFromString($generateHtmlFromNodes(editor), 'text/html');
    const id = $getState(node, documentBlockId);
    const element = [...exported.querySelectorAll('[data-od-id]')].find(item => item.getAttribute('data-od-id') === id);
    if (!id || !element) throw new Error('This document block could not be preserved.');
    return element.outerHTML;
  };
  const code = { ...CODE, export: (node: LexicalNode) => {
    if (!$isCodeNode(node)) return null;
    const text = node.getTextContent();
    const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map(match => match[0].length));
    const fence = '`'.repeat(Math.max(3, longest + 1));
    const language = node.getLanguage() ?? '';
    return `${fence}${language}${text ? `\n${text}` : ''}\n${fence}`;
  } };
  const imageHtml = (node: LexicalNode) => {
    if (!$isDocumentImageNode(node)) return null;
    const element = node.exportDOM(editor).element;
    return element instanceof HTMLElement ? element.outerHTML : null;
  };
  const image: ElementTransformer = { type: 'element', dependencies: [DocumentImageNode], regExp: /a^/, replace: () => false, export: imageHtml };
  const nestedImage: TextMatchTransformer = { type: 'text-match', dependencies: [DocumentImageNode], regExp: /a^/, export: imageHtml };
  const table: ElementTransformer = {
    type: 'element', dependencies: [TableNode], regExp: /a^/, replace: () => false,
    export: (node, children) => {
      if (!$isTableNode(node)) return null;
      const rows = node.getChildren().filter($isElementNode).map(row => row.getChildren().filter($isTableCellNode));
      const width = rows[0]?.length ?? 0;
      const simple = width > 0 && !node.getColWidths()?.length && rows.every(row => row.length === width && row.every(cell => cell.getColSpan() === 1 && cell.getRowSpan() === 1 && !cell.getBackgroundColor() && !cell.getWidth())) && rows[0]!.every(cell => cell.getHeaderStyles() !== 0);
      const alignment = rows.map(row => row.map(cell => { const child = cell.getFirstChild(); return $isElementNode(child) ? child.getFormatType() : ''; }));
      const consistentAlignment = alignment.every(row => row.every((align, column) => align === alignment[0]![column]));
      const values = rows.map(row => row.map(cell => children(cell)));
      if (!simple || !consistentAlignment || values.some(row => row.some(value => value.includes('\n')))) return htmlFor(node);
      const line = (row: string[]) => `| ${row.map(value => value.replace(/\|/g, '\\|')).join(' | ')} |`;
      return [line(values[0]!), line(alignment[0]!.map(align => align === 'center' ? ':---:' : align === 'right' ? '---:' : align === 'left' ? ':---' : '---')), ...values.slice(1).map(line)].join('\n');
    },
  };
  const styledText: TextMatchTransformer = {
    type: 'text-match', dependencies: [], regExp: /a^/,
    export: node => {
      if (!$isTextNode(node)) return null;
      if (!(node.hasFormat('code') || node.hasFormat('underline') || node.hasFormat('subscript') || node.hasFormat('superscript') || node.getStyle())) return null;
      const element = node.exportDOM(editor).element;
      return element instanceof HTMLElement ? element.outerHTML : null;
    },
  };
  const literalText: TextMatchTransformer = {
    type: 'text-match', dependencies: [], regExp: /a^/,
    export: (node, _children, format) => {
      if ($isLineBreakNode(node)) return '<br>';
      if (!$isTextNode(node)) return null;
      // Character references survive CommonMark parsing without becoming block/link/HTML syntax.
      const text = node.getTextContent().replace(/[&<>\[\]#!+=.():|\-]/g, char => `&#${char.charCodeAt(0)};`);
      return format(node, text);
    },
  };
  const link = { ...LINK, export: (node: LexicalNode, children: (node: import('lexical').ElementNode) => string) => {
    if (!$isLinkNode(node)) return null;
    const url = node.getURL().replace(/&/g, '&amp;').replace(/[<>\\\s]/g, char => encodeURIComponent(char));
    const title = node.getTitle();
    return `[${children(node)}](<${url}>${title ? ` "${title.replace(/&/g, '&amp;').replace(/[\\"]/g, '\\$&')}"` : ''})`;
  } };
  const alignedBlock: ElementTransformer = {
    type: 'element', dependencies: [], regExp: /a^/, replace: () => false,
    export: node => $isElementNode(node) && !['', 'left', 'start'].includes(node.getFormatType()) ? htmlFor(node) : null,
  };
  const divider: ElementTransformer = {
    type: 'element', dependencies: [DocumentDividerNode], regExp: /a^/, replace: () => false,
    export: node => {
      if (!$isHorizontalRuleNode(node)) return null;
      return $getState(node, documentDividerStyle) ? htmlFor(node) : '---';
    },
  };
  const body = $convertToMarkdownString([divider, image, code, table, alignedBlock, nestedImage, styledText, literalText, link, ...TRANSFORMERS]);
  return encodeMarkdownDocument(body, { version: 1, fonts: { text: $getState($getRoot(), documentFont), headings: $getState($getRoot(), documentHeadingFont) }, ids: documentIdentityGroups() });
}
