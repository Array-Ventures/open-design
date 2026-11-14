// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { $getRoot, $getSelection, $isRangeSelection, type LexicalEditor } from 'lexical';
import { DocumentEditor } from '../../../src/components/embedded/document/DocumentEditor';
import { documentHtml } from '../../../src/components/embedded/document/document-html';
import { finalizeMarkdownDocument, readMarkdownDocument } from '../../../src/components/embedded/document/markdown-document';
import { documentIdentityGroups } from '../../../src/components/embedded/document/document-identity';
import { resolveDocumentComment } from '../../../src/components/embedded/document/document-comment-anchor';

const save = vi.hoisted(() => vi.fn());
vi.mock('../../../src/components/embedded/document/document-file', () => ({ saveDocumentFile: save }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

function editor(): LexicalEditor {
  return (screen.getByRole('textbox', { name: 'Report' }) as HTMLElement & { __lexicalEditor: LexicalEditor }).__lexicalEditor;
}

it('keeps pre-divider paragraph identities so existing source-only comments still resolve', () => {
  const observed = { html: documentHtml('Report', '<p>Before</p><hr><p>After</p>'), sha256: 'original' };
  render(<DocumentEditor projectId="fixture" fileName="report.html" title="Report" observed={observed} onSaved={() => {}} />);
  expect(editor().getEditorState().read(documentIdentityGroups)).toEqual({
    paragraph: ['doc-original-0', 'doc-original-1'],
    'document-divider': ['doc-original-divider-0'],
  });
  expect(editor().getEditorState().read(() => resolveDocumentComment({
    version: 1,
    start: { block: 'doc-original-1', offset: 0 },
    end: { block: 'doc-original-1', offset: 5 },
    quote: 'After',
  })?.getTextContent())).toBe('After');
});

it.each(['html', 'markdown'] as const)('preserves an imported divider while editing and reopening %s', async format => {
  const observed = format === 'html'
    ? { html: documentHtml('Report', '<h1 data-od-id="title">Report</h1><p data-od-id="before">Ready</p><hr data-od-id="divider"><p data-od-id="after">After</p>'), sha256: 'original' }
    : { ...await readMarkdownDocument('# Report\n\nReady\n\n---\n\nAfter\n', 'Report'), sha256: 'original', format };
  save.mockImplementation(async (_project, _file, content) => format === 'html'
    ? { html: content, sha256: 'saved' }
    : { ...await readMarkdownDocument(await finalizeMarkdownDocument(content), 'Report'), sha256: 'saved', format });
  const view = render(<DocumentEditor projectId="fixture" fileName={format === 'html' ? 'report.html' : 'report.md'} title="Report" observed={observed} onSaved={() => {}} />);
  expect(screen.getByRole('textbox').querySelectorAll('hr')).toHaveLength(1);
  const identities = editor().getEditorState().read(documentIdentityGroups);
  act(() => editor().update(() => {
    $getRoot().getChildren()[1]!.selectEnd();
    const selection = $getSelection();
    if ($isRangeSelection(selection)) selection.insertText(' reviewed');
  }, { discrete: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Save document' }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  const saved = await save.mock.results[0]!.value;
  const dom = new DOMParser().parseFromString(saved.html, 'text/html');
  expect(dom.body.querySelectorAll('hr')).toHaveLength(1);
  expect(dom.body.textContent).toContain('Ready reviewed');
  expect(dom.body.textContent).toContain('After');
  if (format === 'html') expect(dom.querySelector('hr')?.getAttribute('data-od-id')).toBe('divider');
  view.unmount();
  render(<DocumentEditor projectId="fixture" fileName={format === 'html' ? 'report.html' : 'report.md'} title="Report" observed={saved} onSaved={() => {}} />);
  expect(screen.getByRole('textbox').querySelectorAll('hr')).toHaveLength(1);
  expect(screen.getByRole('textbox')).toHaveTextContent('Ready reviewed');
  expect(editor().getEditorState().read(documentIdentityGroups)).toEqual(identities);
});

it('inserts a divider through the existing menu and preserves real Undo/Redo history', async () => {
  const observed = { html: documentHtml('Report', '<p data-od-id="before">Before</p><p data-od-id="after">After</p>'), sha256: 'original' };
  save.mockImplementation(async (_project, _file, html) => ({ html, sha256: 'saved' }));
  render(<DocumentEditor projectId="fixture" fileName="report.html" title="Report" observed={observed} onSaved={() => {}} />);
  act(() => editor().update(() => { $getRoot().getFirstChildOrThrow().selectEnd(); }, { discrete: true }));
  fireEvent.click(screen.getByRole('button', { name: 'More document actions' }));
  fireEvent.click(screen.getByRole('button', { name: 'Divider' }));
  await waitFor(() => expect(screen.getByRole('textbox').querySelectorAll('hr')).toHaveLength(1));
  fireEvent.click(screen.getByRole('button', { name: 'More document actions' }));
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
  await waitFor(() => expect(screen.getByRole('textbox').querySelectorAll('hr')).toHaveLength(0));
  fireEvent.click(screen.getByRole('button', { name: 'More document actions' }));
  fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
  await waitFor(() => expect(screen.getByRole('textbox').querySelectorAll('hr')).toHaveLength(1));
  expect(screen.getByRole('textbox')).toHaveTextContent('BeforeAfter');
  fireEvent.click(screen.getByRole('button', { name: 'Save document' }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  const saved = new DOMParser().parseFromString(save.mock.calls[0]![2], 'text/html');
  expect(saved.body.querySelectorAll('hr')).toHaveLength(1);
  const blocks = [...saved.querySelector('main')!.children];
  // The SDK inserts an empty paragraph after the rule so typing can continue.
  expect(blocks.map(element => [element.tagName, element.textContent])).toEqual([
    ['P', 'Before'], ['HR', ''], ['P', ''], ['P', 'After'],
  ]);
  expect(blocks[0]!.getAttribute('data-od-id')).toBe('before');
  expect(blocks[3]!.getAttribute('data-od-id')).toBe('after');
});

it.each(['html', 'markdown'] as const)('preserves authored divider presentation through unrelated edits and %s reopening', async format => {
  const ruleHtml = '<hr data-od-id="styled-divider" style="width:40%;color:rgb(120, 30, 40);background-color:rgb(240, 230, 220)">';
  const observed = format === 'html'
    ? { html: documentHtml('Report', `<p>Before</p>${ruleHtml}<p>After</p>`), sha256: 'original' }
    : { ...await readMarkdownDocument(`Before\n\n${ruleHtml}\n\nAfter\n`, 'Report'), sha256: 'original', format };
  save.mockImplementation(async (_project, _file, content) => format === 'html'
    ? { html: content, sha256: 'saved' }
    : { ...await readMarkdownDocument(await finalizeMarkdownDocument(content), 'Report'), sha256: 'saved', format });
  const fileName = format === 'html' ? 'report.html' : 'report.md';
  const view = render(<DocumentEditor projectId="fixture" fileName={fileName} title="Report" observed={observed} onSaved={() => {}} />);
  const rule = screen.getByRole('textbox').querySelector('hr')!;
  expect(rule.style.width).toBe('40%');
  expect(rule.style.color).toBe('rgb(120, 30, 40)');
  act(() => editor().update(() => {
    $getRoot().getFirstChildOrThrow().selectEnd();
    const selection = $getSelection();
    if ($isRangeSelection(selection)) selection.insertText(' reviewed');
  }, { discrete: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Save document' }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  const receipt = await save.mock.results[0]!.value;
  const saved = new DOMParser().parseFromString(receipt.html, 'text/html').querySelector('hr')!;
  expect(saved.getAttribute('data-od-id')).toBe('styled-divider');
  expect(saved.style.width).toBe('40%');
  expect(saved.style.color).toBe('rgb(120, 30, 40)');
  expect(saved.style.backgroundColor).toBe('rgb(240, 230, 220)');
  view.unmount();
  render(<DocumentEditor projectId="fixture" fileName={fileName} title="Report" observed={receipt} onSaved={() => {}} />);
  const reopened = screen.getByRole('textbox').querySelector('hr')!;
  expect(reopened.style.width).toBe('40%');
  expect(reopened.style.color).toBe('rgb(120, 30, 40)');
  expect(reopened.style.backgroundColor).toBe('rgb(240, 230, 220)');
  expect(screen.getByRole('textbox')).toHaveTextContent('Before reviewed');
});
