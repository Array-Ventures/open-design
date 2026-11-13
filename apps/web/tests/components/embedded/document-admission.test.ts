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
  '<body><table><colgroup><col style="width:50%"></colgroup><tr><td>Cell</td></tr></table></body>',
  '<body><table><tr><td style="width:50%">Cell</td><th style="width:50%">Header</th></tr></table></body>',
  '<body><p style="padding-inline-start:10px">Indent</p></body>',
  '<body><p style="padding-inline-start:30px">Indent</p></body>',
  '<body><ul style="padding-inline-start:40px"><li>Indent</li></ul></body>',
  '<body><p><strong><span style="font-weight:400">Not bold</span></strong></p></body>',
  '<body><p><strong><span style="font-weight:normal">Not bold</span></strong></p></body>',
  '<body><p><em><span style="font-style:normal">Not italic</span></em></p></body>',
  '<body><p><u><span style="text-decoration:none">Not underlined</span></u></p></body>',
  '<body><ol><li value="7">Restart</li></ol></body>',
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
    $getRoot().append(...$generateNodesFromDOM(editor, documentImport('<h1>Heading</h1><p><strong>Bold</strong> and <span style="color:red;font-size:22px">color</span></p><ol start="3"><li>Item</li><li>Second</li></ol><p style="padding-inline-start:40px">Indent</p><table><tr><th>Header</th><td>Value</td></tr></table>')));
  }, { discrete: true });
  editor.getEditorState().read(() => {
    const saved = documentHtml('Saved', $generateHtmlFromNodes(editor));
    expect(supportedDocument(saved, 'report.html'), saved).toBe(true);
  });
});

it.each([
  '<h1><span style="white-space: pre-wrap;">Heading</span></h1>',
  '<p><b><strong style="white-space: pre-wrap;">Bold</strong></b></p>',
  '<ul><li value="1"><span style="white-space: pre-wrap;">Item</span></li></ul>',
  '<table><colgroup><col><col></colgroup><tbody><tr><th style="border: 1px solid black; vertical-align: top; background-color: rgb(242, 243, 245);"><p><span style="white-space: pre-wrap;">Header</span></p></th><td style="border: 1px solid black; vertical-align: top;"><p><span style="white-space: pre-wrap;">Value</span></p></td></tr></tbody></table>',
])('admits canonical export fragments: %s', body => {
  const parsed = new DOMParser().parseFromString(body, 'text/html');
  const declarations = Array.from(parsed.querySelectorAll<HTMLElement>('[style]')).map(element => ({ tag: element.tagName, raw: element.getAttribute('style'), length: element.style.length, properties: Array.from(element.style).map(name => [name, element.style.getPropertyValue(name)]) }));
  expect(supportedDocument(documentHtml('Saved', body), 'report.html'), JSON.stringify(declarations)).toBe(true);
});
