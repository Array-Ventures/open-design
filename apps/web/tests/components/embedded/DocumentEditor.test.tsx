// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { $getRoot, $getSelection, $isRangeSelection, type LexicalEditor } from 'lexical';
import { DocumentEditor } from '../../../src/components/embedded/document/DocumentEditor';
import { documentHtml } from '../../../src/components/embedded/document/document-html';
const save = vi.hoisted(() => vi.fn());
vi.mock('../../../src/components/embedded/document/document-file', () => ({ saveDocumentFile: save }));
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
