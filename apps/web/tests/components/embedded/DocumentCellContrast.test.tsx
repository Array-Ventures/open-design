// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { $getRoot, type LexicalEditor } from 'lexical';
import { $generateHtmlFromNodes } from '@lexical/html';
import { DocumentEditor } from '../../../src/components/embedded/document/DocumentEditor';
import { documentHtml } from '../../../src/components/embedded/document/document-html';
import { DOCUMENT_CELL_INK } from '../../../src/components/embedded/document/document-cell-contrast';
const save = vi.hoisted(() => vi.fn());
vi.mock('../../../src/components/embedded/document/document-file', () => ({ saveDocumentFile: save }));
// Model the observed computed-color/theme seam; the actual browser separately
// qualifies canvas parsing and token contrast. This is a public Lexical lifecycle test.
vi.mock('../../../src/components/embedded/document/document-cell-contrast', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../src/components/embedded/document/document-cell-contrast')>();
  return { ...actual, documentColorReader: () => (value: string) => {
    const channels = /^rgb\((\d+), (\d+), (\d+)\)$/.exec(value);
    if (channels) return [Number(channels[1]), Number(channels[2]), Number(channels[3]), 1];
    if (value === 'black') return [0,0,0,1]; if (value === 'white') return [255,255,255,1];
    if (value === 'rgba(0, 0, 0, 0)') return [0,0,0,0]; return null;
  } };
});
afterEach(() => { cleanup(); document.documentElement.removeAttribute('data-theme'); vi.restoreAllMocks(); save.mockClear(); });
it('repairs reopened explicit fills through theme changes without editing or exporting view-only ink', async () => {
  const original = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
    const style = original(element, pseudo);
    return new Proxy(style, { get(target, property) {
      const dark = document.documentElement.dataset.theme === 'dark';
      if (property === 'color' && element.matches('td,th')) return (element as HTMLElement).style.getPropertyValue(DOCUMENT_CELL_INK) || (dark ? 'white' : 'black');
      if (property === 'backgroundColor' && element.matches('td,th')) return (element as HTMLElement).style.backgroundColor || (dark ? 'rgb(30, 30, 30)' : 'rgb(242, 243, 245)');
      if (property === 'backgroundColor' && element.getAttribute('data-testid') === 'document-editor') return dark ? 'black' : 'white';
      const value = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value;
    } });
  });
  document.documentElement.dataset.theme = 'dark';
  const html = documentHtml('Report', '<table><tr><th style="background-color:rgb(242,243,245)">Legacy default</th><th style="background-color:rgb(30,30,30)"><span style="color:magenta">Authored ink</span></th><th>Implicit default</th></tr></table>');
  const view = render(<DocumentEditor projectId="fixture" fileName="report.html" title="Report" observed={{ html, sha256: 'owned' }} onSaved={() => {}} />);
  const root = screen.getByRole('textbox') as HTMLElement & { __lexicalEditor: LexicalEditor };
  const editor = root.__lexicalEditor, cells = () => screen.getAllByRole('columnheader');
  await waitFor(() => expect(cells()[0]!.style.getPropertyValue(DOCUMENT_CELL_INK)).toBe('black'));
  expect(cells()[1]!.style.getPropertyValue(DOCUMENT_CELL_INK)).toBe('');
  expect(cells()[2]!.style.getPropertyValue(DOCUMENT_CELL_INK)).toBe('');
  expect(cells()[1]!.querySelector('[style*="color: magenta"]')).not.toBeNull();
  const initialCells = cells();
  const before = JSON.stringify(editor.getEditorState().toJSON()), updates = vi.fn(), stop = editor.registerUpdateListener(updates);
  act(() => { document.documentElement.dataset.theme = 'light'; });
  await waitFor(() => expect(cells()[0]!.style.getPropertyValue(DOCUMENT_CELL_INK)).toBe(''));
  await waitFor(() => expect(cells()[1]!.style.getPropertyValue(DOCUMENT_CELL_INK)).toBe('white'));
  for (const oldCell of initialCells.filter(cell => !cell.isConnected)) expect(oldCell.style.getPropertyValue(DOCUMENT_CELL_INK)).toBe('');
  expect(JSON.stringify(editor.getEditorState().toJSON())).toBe(before); expect(updates).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled();
  let output = ''; editor.getEditorState().read(() => { expect($getRoot().getTextContent()).toContain('Legacy default'); output = $generateHtmlFromNodes(editor); });
  expect(output).not.toContain(DOCUMENT_CELL_INK);
  const parsed = new DOMParser().parseFromString(output, 'text/html'), saved = parsed.querySelectorAll('th');
  expect(saved[0]!.style.backgroundColor).toBe('rgb(242, 243, 245)');
  expect(saved[1]!.style.backgroundColor).toBe('rgb(30, 30, 30)');
  expect(saved[1]!.querySelector('[style*="color: magenta"]')).not.toBeNull();
  expect(saved[2]!.style.backgroundColor).toBe('');
  const retired = cells(); stop(); view.unmount(); expect(retired.every(cell => !cell.style.getPropertyValue(DOCUMENT_CELL_INK))).toBe(true);
  // Re-import the actual serialized HTML: explicit fills remain explicit while
  // the generated default remains null in the next real Lexical model.
  const reopened = render(<DocumentEditor projectId="fixture" fileName="report.html" title="Report" observed={{ html: documentHtml('Report', output), sha256: 'saved' }} onSaved={() => {}} />);
  await waitFor(() => expect(cells()[1]!.style.getPropertyValue(DOCUMENT_CELL_INK)).toBe('white'));
  expect(cells()[0]!.style.backgroundColor).toBe('rgb(242, 243, 245)');
  expect(cells()[2]!.style.backgroundColor).toBe(''); expect(save).not.toHaveBeenCalled();
  reopened.unmount();
});
