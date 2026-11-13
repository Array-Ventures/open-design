// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
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
  '<body><p><span style="font-size:20px"><span style="font-size:2em">Relative</span></span></p></body>',
  '<body><p><span style="font-size:120%">Relative</span></p></body>',
  '<body><p><span dir="rtl">Direction</span></p></body>',
  '<body><p><span style="color:red"><span style="color:inherit">Inherited</span></span></p></body>',
  '<body><p><span style="color:red"><span style="color:currentColor">Inherited</span></span></p></body>',
  '<body><p><span style="font-family:Georgia"><span style="font-family:inherit">Inherited</span></span></p></body>',
  '<body><p><span style="background-color:unset">Inherited</span></p></body>',
  '<body><p><span style="color:var(--authored-color)">Variable</span></p></body>',
  '<body><table><tr><th scope="col">Scoped header</th></tr></table></body>',
  '<body><p><a href="https://example.test" data-od-id="lost">Anchor</a></p></body>',
  '<body><ul><li role="checkbox" aria-checked="true">Not a supported checklist</li></ul></body>',
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
  '<ul __lexicallisttype="check"><li value="1" role="checkbox" tabindex="-1" aria-checked="true"><span style="white-space: pre-wrap;">Checked</span></li></ul>',
  '<ul><li value="1"><span style="white-space: pre-wrap;">Item</span></li></ul>',
  '<table><colgroup><col><col></colgroup><tbody><tr><th style="border: 1px solid black; vertical-align: top; background-color: rgb(242, 243, 245);"><p><span style="white-space: pre-wrap;">Header</span></p></th><td style="border: 1px solid black; vertical-align: top;"><p><span style="white-space: pre-wrap;">Value</span></p></td></tr></tbody></table>',
])('admits canonical export fragments: %s', body => {
  const parsed = new DOMParser().parseFromString(body, 'text/html');
  const declarations = Array.from(parsed.querySelectorAll<HTMLElement>('[style]')).map(element => ({ tag: element.tagName, raw: element.getAttribute('style'), length: element.style.length, properties: Array.from(element.style).map(name => [name, element.style.getPropertyValue(name)]) }));
  expect(supportedDocument(documentHtml('Saved', body), 'report.html'), JSON.stringify(declarations)).toBe(true);
});


it.each([['en', 'ltr'], ['zh-Hant-TW', 'ltr'], ['ar', 'rtl'], ['', 'ltr']])('admits supported document root language %s and direction %s', (lang, dir) => {
  expect(supportedDocument(documentHtml('Report', '<p>Body</p>').replace('<html ', `<html lang="${lang}" dir="${dir}" `), 'report.html')).toBe(true);
});
it.each(['lang="en invalid"', 'dir="auto"'])('retains fallback for unsupported root metadata %s', attribute => {
  expect(supportedDocument(documentHtml('Report', '<p>Body</p>').replace('<html ', `<html ${attribute} `), 'report.html')).toBe(false);
});

// The actual Chromium save/reopen failure is an owned table-action fixture.
// Its implicit CSSOM expansion differs from jsdom, so also author those exact
// declarations explicitly to exercise admission through both DOM parsers.
it('admits the owned saved table after Chromium expands canonical cell borders', async () => {
  const { readFileSync } = await import('node:fs');
  const raw = readFileSync(`${process.cwd()}/tests/fixtures/documents/chromium-table-actions.html`, 'utf8');
  expect(supportedDocument(raw, 'table-actions.html')).toBe(true);
  const parsed = new DOMParser().parseFromString(raw, 'text/html');
  for (const cell of parsed.querySelectorAll<HTMLElement>('td,th')) {
    const expanded = ['top', 'right', 'bottom', 'left'].flatMap(side => [`border-${side}-width:1px`, `border-${side}-style:solid`, `border-${side}-color:black`]);
    const defaults = ['source', 'slice', 'width', 'outset', 'repeat'].map(name => `border-image-${name}:initial`);
    cell.setAttribute('style', `${cell.getAttribute('style')};${expanded.join(';')};${defaults.join(';')}`);
  }
  expect(supportedDocument(parsed.documentElement.outerHTML, 'table-actions.html')).toBe(true);
});
it.each(['source', 'slice', 'width', 'outset', 'repeat'])('admits only initial Chromium border-image-%s on canonical table cells', name => {
  const cell = (border: string, image: string) => documentHtml('Table', `<table><tr><td style="${border};border-image-${name}:${image}">Cell</td></tr></table>`);
  expect(supportedDocument(cell('border:1px solid black', 'initial'), 'table.html')).toBe(true);
  expect(supportedDocument(cell('border:2px solid black', 'initial'), 'table.html')).toBe(false);
  expect(supportedDocument(cell('', 'initial'), 'table.html')).toBe(false);
});
it.each([
  'border-image-source:url(https://fixture.test/image.png)',
  'border-image-source:none', 'border-image-slice:100%', 'border-image-width:1',
  'border-image-outset:0', 'border-image-repeat:stretch',
  'border-image-source:initial;border-image-repeat:round',
  'border-image-source:initial!important', 'border-image-custom:initial',
  'border-image-source:initial;position:absolute',
  'border-image:url(https://fixture.test/image.png) 30',
  'border-image:url(https://fixture.test/image.png) 30;border:1px solid black',
  'border-image:url(https://fixture.test/image.png) 30;border-image:none',
  'border-image-source:url(https://fixture.test/image.png);border-image-source:initial',
  'border-image-width:2;border-image-width:initial',
  'border-image-source:initial!important;border-image-source:initial',
  'border-top-width:2px;border-image-source:initial',
])('refuses authored border-image or mixed unsupported presentation: %s', declaration => {
  expect(supportedDocument(documentHtml('Table', `<table><tr><td style="border:1px solid black;${declaration}">Cell</td></tr></table>`), 'table.html')).toBe(false);
});
it('does not admit border image defaults on non-cell elements', () => {
  expect(supportedDocument(documentHtml('Body', '<p style="border:1px solid black;border-image-source:initial">Text</p>'), 'report.html')).toBe(false);
});

it('does not trust normalized CSSOM defaults as ownership of an authored image shorthand', () => {
  // Model the browser seam explicitly: a parsed/reset shorthand may read as a
  // harmless default while the authored declaration still contains an image.
  // This is a policy regression, not a claim that jsdom reproduces Chromium.
  const original = CSSStyleDeclaration.prototype.getPropertyValue;
  const normalize = vi.spyOn(CSSStyleDeclaration.prototype, 'getPropertyValue').mockImplementation(function (this: CSSStyleDeclaration, name: string) {
    return name === 'border-image' ? 'none' : original.call(this, name);
  });
  try {
    expect(supportedDocument(documentHtml('Table', '<table><tr><td style="border-image:url(https://fixture.test/image.png) 30;border:1px solid black">Cell</td></tr></table>'), 'table.html')).toBe(false);
  } finally { normalize.mockRestore(); }
});

it('keeps actual inline Code TextNode exports editable with real editor styles and HTML ownership', async () => {
  const { $createTextNode, $createParagraphNode, $isTextNode } = await import('lexical');
  const { CodeNode, $createCodeNode } = await import('@lexical/code');
  const { default: styles } = await import('../../../src/components/embedded/document/DocumentEditor.module.css');
  const editor = createEditor({ namespace: 'actual-code-roundtrip', nodes: [CodeNode], html: documentHtmlConfig(), theme: { code: styles.code, text: { code: styles.inlineCode } }, onError: error => { throw error; } });
  editor.update(() => { $getRoot().append($createParagraphNode().append($createTextNode('x').toggleFormat('code')), $createCodeNode('javascript').append($createTextNode('  let n = 1;'))); }, { discrete: true });
  let saved = '';
  editor.getEditorState().read(() => { saved = documentHtml('Code', $generateHtmlFromNodes(editor)); });
  expect(new DOMParser().parseFromString(saved, 'text/html').querySelector('p code')?.getAttribute('spellcheck')).toBe('false');
  expect(supportedDocument(saved, 'code.html'), saved).toBe(true);
  const reopened = createEditor({ namespace: 'reopened-code-roundtrip', nodes: [CodeNode], html: documentHtmlConfig(), theme: { code: styles.code, text: { code: styles.inlineCode } }, onError: error => { throw error; } });
  reopened.update(() => { $getRoot().append(...$generateNodesFromDOM(reopened, documentImport(saved))); }, { discrete: true });
  reopened.getEditorState().read(() => {
    const first = $getRoot().getFirstDescendant(); expect($isTextNode(first) && first.hasFormat('code')).toBe(true);
    expect($getRoot().getTextContent()).toBe('x\n\n  let n = 1;');
    expect(supportedDocument(documentHtml('Code', $generateHtmlFromNodes(reopened)), 'code.html')).toBe(true);
  });
});
it.each(['true', 'custom', ''])('refuses unsupported inline CODE spellcheck=%s', value => {
  expect(supportedDocument(documentHtml('Code', `<p><code spellcheck="${value}">x</code></p>`), 'code.html')).toBe(false);
});

it('admits the owned saved document through Chromium canonical whitespace expansion', async () => {
  const { readFileSync } = await import('node:fs');
  // These are the byte-identical saved bytes from the 95 and 97 real browsers.
  // jsdom keeps the shorthand; explicitly model Chromium's observed iterator.
  const raw = readFileSync(`${process.cwd()}/tests/fixtures/documents/chromium-table-actions.html`, 'utf8');
  const originalGet = CSSStyleDeclaration.prototype.getPropertyValue;
  const originalIterator = CSSStyleDeclaration.prototype[Symbol.iterator];
  const values = vi.spyOn(CSSStyleDeclaration.prototype, 'getPropertyValue').mockImplementation(function (this: CSSStyleDeclaration, name: string) {
    if (originalGet.call(this, 'white-space') === 'pre-wrap') {
      if (name === 'white-space-collapse') return 'preserve';
      if (name === 'text-wrap-mode') return 'wrap';
    }
    return originalGet.call(this, name);
  });
  const iterator = vi.spyOn(CSSStyleDeclaration.prototype, Symbol.iterator).mockImplementation(function* (this: CSSStyleDeclaration): Generator<string, undefined, unknown> {
    for (const name of originalIterator.call(this)) {
      if (name === 'white-space' && originalGet.call(this, name) === 'pre-wrap') yield* ['white-space-collapse', 'text-wrap-mode'];
      else yield name;
    }
    return undefined;
  });
  try { expect(supportedDocument(raw, 'report.html')).toBe(true); }
  finally { iterator.mockRestore(); values.mockRestore(); }
});
it.each([
  '<p style="white-space:pre-wrap">Block</p>',
  '<span style="white-space:nowrap;white-space:pre-wrap">Override</span>',
  '<span style="white-space:pre-wrap!important">Priority</span>',
  '<span style="white-space:pre-wrap;white-space-collapse:collapse">Collapse</span>',
  '<span style="white-space:pre-wrap;text-wrap-mode:nowrap">No wrap</span>',
  '<span style="white-space:pre-wrap;text-wrap-style:balance">Balance</span>',
  '<span style="white-space-collapse:preserve;text-wrap-mode:wrap">Unowned pair</span>',
  '<span style="white-space:pre-wrap;position:absolute">Unknown</span>',
])('refuses noncanonical or authored whitespace presentation: %s', body => {
  expect(supportedDocument(documentHtml('Whitespace', body), 'report.html')).toBe(false);
});
