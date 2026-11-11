// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { $getRoot, $getSelection, $isRangeSelection, $isTextNode, $isElementNode, type LexicalEditor } from 'lexical';
import { DocumentEditor } from '../../../src/components/embedded/document/DocumentEditor';
import { DocumentSurface } from '../../../src/components/embedded/document/DocumentSurface';
import { documentHtml } from '../../../src/components/embedded/document/document-html';
const save = vi.hoisted(() => vi.fn());
const read = vi.hoisted(() => vi.fn());
vi.mock('../../../src/components/embedded/document/document-file', () => ({ saveDocumentFile: save, readDocumentFile: read }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const observed = { html: documentHtml('Report', '<h1 data-od-id="title">Report</h1><p data-od-id="body">Ready</p>'), sha256: 'original' };
function editor(): LexicalEditor { return (screen.getByRole('textbox', { name: 'Report' }) as HTMLElement & { __lexicalEditor: LexicalEditor }).__lexicalEditor; }
it('edits semantic text and saves canonical HTML without replacing its stable identities', async () => {
  save.mockImplementation(async (_project, _file, html) => ({ html, sha256: 'saved' }));
  render(<DocumentEditor projectId="fixture" fileName="report.html" title="Report" observed={observed} onSaved={() => {}} />);
  const active = editor();
  act(() => active.update(() => {
    $getRoot().getLastChildOrThrow().selectEnd();
    const selection = $getSelection(); if ($isRangeSelection(selection)) selection.insertText(' for review');
  }, { discrete: true }));
  expect(screen.getByRole('textbox').textContent).toContain('Ready for review');
  fireEvent.click(screen.getByRole('button', { name: 'Save document' }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  const html = save.mock.calls[0]![2] as string;
  expect(html).toContain('data-od-id="title"'); expect(html).toContain('data-od-id="body"');
  expect(html).toContain('Ready for review'); expect(save.mock.calls[0]![3]).toBe(observed);
});
it('keeps unsaved edits visible after a save conflict', async () => {
  save.mockRejectedValue(new Error('This file changed after you opened it.'));
  render(<DocumentEditor projectId="fixture" fileName="report.html" title="Report" observed={observed} onSaved={() => {}} />);
  act(() => editor().update(() => {
    $getRoot().getLastChildOrThrow().selectEnd(); const selection = $getSelection(); if ($isRangeSelection(selection)) selection.insertText(' pending');
  }, { discrete: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Save document' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('This file changed');
  expect(screen.getByRole('textbox')).toHaveTextContent('Ready pending');
});

it('reopens a saved table document as an editable document with its columns and text intact', async () => {
  const table = { html: documentHtml('Report', '<h1 data-od-id="title">Report</h1><p data-od-id="body">Ready</p><table><colgroup><col style="width:120px"><col style="width:240px"></colgroup><tbody><tr><th>Metric</th><th>Value</th></tr><tr><td>Customers</td><td>24</td></tr></tbody></table>'), sha256: 'original' };
  save.mockImplementation(async (_project, _file, html) => ({ html, sha256: 'saved' }));
  const view = render(<DocumentEditor projectId="fixture" fileName="report.html" title="Report" observed={table} onSaved={() => {}} />);
  act(() => editor().update(() => {
    $getRoot().getChildren()[1]!.selectEnd(); const selection = $getSelection(); if ($isRangeSelection(selection)) selection.insertText(' reviewed');
  }, { discrete: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Save document' })); await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  const html = save.mock.calls[0]![2] as string;
  const saved = new DOMParser().parseFromString(html, 'text/html');
  expect([...saved.querySelectorAll('col')].map(col => col.style.width)).toEqual(['120px', '240px']);
  view.unmount(); read.mockResolvedValue({ html, sha256: 'saved' });
  render(<DocumentSurface projectId="fixture" fileName="report.html" title="Report" fallback={<div>Read-only fallback</div>} onSaved={() => {}} />);
  expect(await screen.findByRole('textbox', { name: 'Report' })).toHaveTextContent('Ready reviewed');
  expect(screen.queryByText('Read-only fallback')).toBeNull();
  expect(screen.getByRole('table').querySelectorAll('tr')).toHaveLength(2);
  expect([...screen.getByRole('table').querySelectorAll('col')].map(col => col.style.width)).toEqual(['120px', '240px']);
});

it('saves independent heading and body font choices through the actual formatting menu', async () => {
  save.mockImplementation(async (_project, _file, html) => ({ html, sha256: 'saved' }));
  render(<DocumentEditor projectId="fixture" fileName="report.html" title="Report" observed={observed} onSaved={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Font' }));
  fireEvent.click(within(screen.getByRole('group', { name: 'Headings' })).getByRole('button', { name: 'Sans' }));
  fireEvent.click(screen.getByRole('button', { name: 'Font' }));
  fireEvent.click(within(screen.getByRole('group', { name: 'Text' })).getByRole('button', { name: 'Serif' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save document' })).not.toBeDisabled());
  fireEvent.click(screen.getByRole('button', { name: 'Save document' })); await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  const doc = new DOMParser().parseFromString(save.mock.calls[0]![2] as string, 'text/html');
  expect(doc.documentElement.getAttribute('data-eve-document-font')).toBe('serif');
  expect(doc.documentElement.getAttribute('data-eve-document-heading-font')).toBe('sans');
  expect(screen.getByRole('textbox').style.fontFamily).toContain('Georgia');
  expect(screen.getByRole('textbox').style.getPropertyValue('--document-heading-font')).toBe('system-ui, sans-serif');
});
it('preserves the existing whole-document font for files written before independent heading fonts', () => {
  const old = { ...observed, html: documentHtml('Report', '<h1>Report</h1><p>Ready</p>', 'serif').replace(' data-eve-document-heading-font="serif"', '') };
  render(<DocumentEditor projectId="fixture" fileName="report.html" title="Report" observed={old} onSaved={() => {}} />);
  expect(screen.getByRole('textbox').style.fontFamily).toContain('Georgia');
  expect(screen.getByRole('textbox').style.getPropertyValue('--document-heading-font')).toContain('Georgia');
});

it('edits and reopens real Markdown with tables, checklist state, code and stable block identities', async () => {
  const { readMarkdownDocument, finalizeMarkdownDocument } = await import('../../../src/components/embedded/document/markdown-document');
  const { documentIdentityGroups } = await import('../../../src/components/embedded/document/document-identity');
  const source = '# Report\n\nReady\n\n| Metric | Value |\n| --- | --- |\n| Customers | 24 |\n\n- [x] Complete\n- [ ] Pending\n\n```js\nconst count = 24;\n```\n';
  const markdown = { ...await readMarkdownDocument(source, 'Report'), sha256: 'original', format: 'markdown' as const };
  save.mockImplementation(async (_project, _file, content) => ({ ...await readMarkdownDocument(await finalizeMarkdownDocument(content), 'Report'), sha256: 'saved', format: 'markdown' }));
  const view = render(<DocumentEditor projectId="fixture" fileName="report.md" title="Report" observed={markdown} onSaved={() => {}} />);
  const before = editor().getEditorState().read(documentIdentityGroups);
  expect(screen.getByRole('table').querySelectorAll('tr')).toHaveLength(2);
  expect(screen.getByRole('textbox').querySelectorAll('li[aria-checked="true"]')).toHaveLength(1);
  act(() => editor().update(() => {
    $getRoot().getChildren()[1]!.selectEnd(); const selection = $getSelection(); if ($isRangeSelection(selection)) selection.insertText(' reviewed');
  }, { discrete: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Save document' }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  const content = await finalizeMarkdownDocument(save.mock.calls[0]![2] as string);
  expect(content).toContain('# Report'); expect(content).toContain('Ready reviewed');
  expect(content).toContain('| Customers | 24 |');
  expect(content).toContain('- [x] Complete'); expect(content).toContain('- [ ] Pending');
  expect(content).toContain('```js\nconst count = 24;\n```');
  const saved = { ...await readMarkdownDocument(content, 'Report'), sha256: 'saved', format: 'markdown' as const };
  expect(saved.identities).toEqual(before);
  view.unmount();
  render(<DocumentEditor projectId="fixture" fileName="report.md" title="Report" observed={saved} onSaved={() => {}} />);
  expect(editor().getEditorState().read(documentIdentityGroups)).toEqual(before);
  expect(screen.getByRole('textbox')).toHaveTextContent('Ready reviewed');
  expect(screen.getByRole('table').querySelectorAll('tr')).toHaveLength(2);
  expect(screen.getByRole('textbox').querySelectorAll('li[aria-checked="true"]')).toHaveLength(1);
  expect(screen.getByRole('textbox').querySelector('code, pre')).toHaveTextContent('const count = 24;');
});

it('inserts a checklist and code block through the compact document controls', async () => {
  save.mockImplementation(async (_project, _file, html) => ({ html, sha256: 'saved' }));
  render(<DocumentEditor projectId="fixture" fileName="report.html" title="Report" observed={observed} onSaved={() => {}} />);
  act(() => editor().update(() => { $getRoot().getLastChildOrThrow().selectEnd(); }, { discrete: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Checklist' }));
  await waitFor(() => expect(screen.getByRole('textbox').querySelector('li[aria-checked="false"]')).not.toBeNull());
  act(() => editor().update(() => { $getRoot().getFirstChildOrThrow().selectEnd(); }, { discrete: true }));
  fireEvent.click(screen.getByRole('button', { name: 'More document actions' }));
  fireEvent.click(screen.getByRole('button', { name: 'Code block' }));
  await waitFor(() => expect(screen.getByRole('textbox').querySelector('code, pre')).not.toBeNull());
  expect(screen.getByRole('heading', { name: 'Report' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Save document' }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  const html = save.mock.calls[0]![2] as string;
  expect(html).toContain('aria-checked="false"');
  expect(new DOMParser().parseFromString(html, 'text/html').querySelector('pre')?.textContent).toBe('');
});


it('preserves aligned and underlined text as valid HTML within Markdown', async () => {
  const { readMarkdownDocument, finalizeMarkdownDocument } = await import('../../../src/components/embedded/document/markdown-document');
  const observedMarkdown = { ...await readMarkdownDocument('# Report\n\nReady', 'Report'), sha256: 'original', format: 'markdown' as const };
  save.mockImplementation(async (_project, _file, content) => ({ ...await readMarkdownDocument(await finalizeMarkdownDocument(content), 'Report'), sha256: 'saved', format: 'markdown' }));
  const view = render(<DocumentEditor projectId="fixture" fileName="report.md" title="Report" observed={observedMarkdown} onSaved={() => {}} />);
  act(() => editor().update(() => {
    const paragraph = $getRoot().getLastChildOrThrow();
    if ($isElementNode(paragraph)) paragraph.setFormat('center');
    const text = $isElementNode(paragraph) ? paragraph.getFirstChild() : null;
    if ($isTextNode(text)) { text.toggleFormat('underline'); text.toggleFormat('bold'); }
  }, { discrete: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Save document' }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  const content = await finalizeMarkdownDocument(save.mock.calls[0]![2] as string);
  const saved = { ...await readMarkdownDocument(content, 'Report'), sha256: 'saved', format: 'markdown' as const };
  view.unmount();
  render(<DocumentEditor projectId="fixture" fileName="report.md" title="Report" observed={saved} onSaved={() => {}} />);
  expect(screen.getByRole('textbox').querySelector('p')?.style.textAlign).toBe('center');
  expect(screen.getByRole('textbox').querySelector('strong, b')).toHaveTextContent('Ready');
  expect(editor().getEditorState().read(() => { const p = $getRoot().getLastChildOrThrow(); const text = $isElementNode(p) ? p.getFirstChild() : null; return $isTextNode(text) && text.hasFormat('underline'); })).toBe(true);
});

it.each([
  ['literal Markdown and HTML', '# Report\n\n\\# Heading\n\n\\> quote\n\n1\\. item\n\n&lt;strong&gt;text&lt;/strong&gt;\n\n[guide](./guide.md)\n\n[download](/files/report.pdf)'],
  ['embedded code fences and spans', '# Report\n\n````md\nbefore\n```\nafter\n````\n\n``a`b``'],
  ['literal entity references in links', '# Report\n\n[x](<https://example.test/?q=&amp;copy;> "&amp;copy;")'],
  ['hard breaks', '# Report\n\nfirst  \nsecond\n\n- list first  \n  list second'],
  ['GFM column alignment', '# Report\n\n| Left | Middle | Right |\n| :--- | :---: | ---: |\n| One | Two | Three |'],
])('preserves %s through an unrelated edit and reopen', async (_name, source) => {
  const { readMarkdownDocument, finalizeMarkdownDocument } = await import('../../../src/components/embedded/document/markdown-document');
  const markdown = { ...await readMarkdownDocument(source, 'Report'), sha256: 'original', format: 'markdown' as const };
  save.mockImplementation(async (_project, _file, content) => ({ ...await readMarkdownDocument(await finalizeMarkdownDocument(content), 'Report'), sha256: 'saved', format: 'markdown' }));
  const view = render(<DocumentEditor projectId="fixture" fileName="report.md" title="Report" observed={markdown} onSaved={() => {}} />);
  const snapshot = () => editor().getEditorState().read(() => {
    const collect = (node: import('lexical').LexicalNode): unknown => ({ type: node.getType(), text: $isTextNode(node) ? node.getTextContent() : undefined, format: $isElementNode(node) || $isTextNode(node) ? node.getFormat() : undefined, url: 'getURL' in node ? (node as import('@lexical/link').LinkNode).getURL() : undefined, title: 'getTitle' in node ? (node as import('@lexical/link').LinkNode).getTitle() : undefined, children: $isElementNode(node) ? node.getChildren().map(collect) : undefined });
    return $getRoot().getChildren().slice(1).map(collect);
  });
  const before = snapshot();
  act(() => editor().update(() => { $getRoot().getFirstChildOrThrow().selectEnd(); const selection = $getSelection(); if ($isRangeSelection(selection)) selection.insertText(' reviewed'); }, { discrete: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Save document' }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  const content = await finalizeMarkdownDocument(save.mock.calls[0]![2] as string);
  const saved = { ...await readMarkdownDocument(content, 'Report'), sha256: 'saved', format: 'markdown' as const };
  view.unmount();
  render(<DocumentEditor projectId="fixture" fileName="report.md" title="Report" observed={saved} onSaved={() => {}} />);
  expect(snapshot()).toEqual(before);
  if (_name === 'literal Markdown and HTML') expect([...screen.getByRole('textbox').querySelectorAll('a')].map(link => link.getAttribute('href'))).toEqual(['./guide.md', '/files/report.pdf']);
  if (_name === 'GFM column alignment') expect([...screen.getByRole('table').querySelectorAll('th p')].map(p => (p as HTMLElement).style.textAlign)).toEqual(['left', 'center', 'right']);
});
