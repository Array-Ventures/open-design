// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { $getRoot, $getSelection, $isRangeSelection, type LexicalEditor } from 'lexical';
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
