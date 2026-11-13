// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { createEditor, $getRoot } from 'lexical';
import { $generateHtmlFromNodes, $generateNodesFromDOM } from '@lexical/html';
import { HeadingNode, QuoteNode } from '@lexical/rich-text';
import { ListNode, ListItemNode } from '@lexical/list';
import { TableNode, TableRowNode, TableCellNode } from '@lexical/table';
import { supportedDocument } from '../../../src/components/embedded/document/document-admission';
import { documentHtml, documentImport } from '../../../src/components/embedded/document/document-html';
import { documentHtmlConfig } from '../../../src/components/embedded/document/document-identity';

it.each([
  '<head><style>p{color:red}</style></head><body><p>Styled</p></body>',
  '<body style="background:red"><p>Styled</p></body>',
  '<body><p class="custom">Styled</p></body>',
  '<body><p id="anchor">Styled</p></body>',
  '<body><p style="color:red">Inherited color</p></body>',
  '<body><p><span style="position:absolute">Styled</span></p></body>',
  '<body><p><span style="color:red!important">Styled</span></p></body>',
  '<body><p><span style="not-a-property:1">Styled</span></p></body>',
])('refuses presentation the editor would silently discard: %s', source => {
  expect(supportedDocument(`<html data-eve-document="1">${source}</html>`, 'report.html')).toBe(false);
});
it('admits supported inline styles and the canonical standalone document head', () => {
  expect(supportedDocument(documentHtml('Report', '<p><span style="color:red;font-size:20px">Styled</span></p>'), 'report.html')).toBe(true);
});
it('keeps its own canonical Lexical export editable after saving lists, tables and formatted text', () => {
  const editor = createEditor({ nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, TableNode, TableRowNode, TableCellNode], html: documentHtmlConfig(), onError: error => { throw error; } });
  editor.update(() => {
    $getRoot().append(...$generateNodesFromDOM(editor, documentImport('<h1>Heading</h1><p><strong>Bold</strong> and <span style="color:red;font-size:22px">color</span></p><ul><li>Item</li></ul><table><tr><th>Header</th><td>Value</td></tr></table>')));
  }, { discrete: true });
  editor.getEditorState().read(() => {
    expect(supportedDocument(documentHtml('Saved', $generateHtmlFromNodes(editor)), 'report.html')).toBe(true);
  });
});
