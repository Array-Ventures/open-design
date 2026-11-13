// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { $getNearestNodeFromDOMNode, $isTextNode, type LexicalEditor } from 'lexical';
import { $createCodeNode, $createCodeHighlightNode } from '@lexical/code';
import { $isTableCellNode } from '@lexical/table';
import { $generateHtmlFromNodes } from '@lexical/html';
import { DocumentEditor } from '../../../src/components/embedded/document/DocumentEditor';
import { documentHtml } from '../../../src/components/embedded/document/document-html';
import { DOCUMENT_TEXT_INK } from '../../../src/components/embedded/document/document-text-contrast';
const save = vi.hoisted(() => vi.fn());
vi.mock('../../../src/components/embedded/document/document-file', () => ({ saveDocumentFile: save }));
// Explicitly model the computed-theme seam. Actual Chromium independently
// qualifies canvas parsing, token colors and the conditional CSS rule.
vi.mock('../../../src/components/embedded/document/document-text-contrast', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../src/components/embedded/document/document-text-contrast')>();
  return { ...actual, documentColorReader: () => (value: string) => {
    const channels = /^rgb\((\d+), (\d+), (\d+)\)$/.exec(value);
    if (channels) return [Number(channels[1]), Number(channels[2]), Number(channels[3]), 1];
    if (value === 'black') return [0,0,0,1]; if (value === 'white') return [255,255,255,1];
    if (value === 'rgba(0, 0, 0, 0)') return [0,0,0,0]; return null;
  } };
});
afterEach(() => { cleanup(); document.documentElement.removeAttribute('data-theme'); vi.restoreAllMocks(); save.mockClear(); });
function fixture(body: string) {
  const original = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
    const style = original(element, pseudo);
    return new Proxy(style, { get(target, property) {
      const dark = document.documentElement.dataset.theme === 'dark', dom = element as HTMLElement;
      if (property === 'color' && element.matches('[data-lexical-text]')) {
        if (dom.style.color) return style.color;
        if (dom.style.getPropertyValue(DOCUMENT_TEXT_INK)) return dom.style.getPropertyValue(DOCUMENT_TEXT_INK);
        if (element.tagName === 'CODE') return 'rgb(190, 190, 190)';
        if (element.closest('a')) return 'rgb(120, 180, 250)';
        return dark ? 'white' : 'black';
      }
      if (property === 'backgroundColor' && element.tagName === 'CODE') return 'rgb(30, 30, 30)';
      if (property === 'backgroundColor' && element.matches('td,th')) return dom.style.backgroundColor || (dark ? 'rgb(30, 30, 30)' : 'rgb(242, 243, 245)');
      if (property === 'backgroundColor' && element.getAttribute('data-testid') === 'document-editor') return dark ? 'black' : 'white';
      const value = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value;
    } });
  });
  document.documentElement.dataset.theme = 'dark';
  const view = render(<DocumentEditor projectId="fixture" fileName="report.html" title="Report" observed={{ html: documentHtml('Report', body), sha256: 'owned' }} onSaved={() => {}} />);
  const root = screen.getByRole('textbox') as HTMLElement & { __lexicalEditor: LexicalEditor };
  return { ...view, editor: root.__lexicalEditor };
}
const owner = (text: string) => screen.getByText(text).closest<HTMLElement>('[data-lexical-text]')!;
const ink = (text: string) => owner(text).style.getPropertyValue(DOCUMENT_TEXT_INK);
it('repairs actual text backgrounds while preserving model, authored ink, theme changes and export/reimport', async () => {
  const view = fixture('<table><tr><th style="background-color:rgb(242,243,245)">Legacy default</th><th style="background-color:rgb(30,30,30)"><span style="color:magenta">Authored ink</span></th><th>Implicit default</th><th style="background-color:rgb(242,243,245)"><span style="background-color:rgb(30,30,30)">Dark nested</span></th><th style="background-color:rgb(30,30,30)"><span style="background-color:rgb(242,243,245)">Light nested</span></th></tr></table>');
  await waitFor(() => expect(ink('Legacy default')).toBe('black'));
  expect(ink('Dark nested')).toBe(''); expect(ink('Light nested')).toBe('black');
  expect(ink('Authored ink')).toBe(''); expect(ink('Implicit default')).toBe('');
  expect(screen.getAllByRole('columnheader').every(cell => !cell.style.getPropertyValue(DOCUMENT_TEXT_INK))).toBe(true);
  const initial = ['Legacy default','Dark nested','Light nested'].map(owner), before = JSON.stringify(view.editor.getEditorState().toJSON());
  const updates = vi.fn(), stop = view.editor.registerUpdateListener(updates);
  act(() => { document.documentElement.dataset.theme = 'light'; });
  await waitFor(() => expect(ink('Dark nested')).toBe('white'));
  expect(ink('Legacy default')).toBe(''); expect(ink('Light nested')).toBe(''); expect(ink('Authored ink')).toBe('');
  for (const old of initial.filter(element => !element.isConnected)) expect(old.style.getPropertyValue(DOCUMENT_TEXT_INK)).toBe('');
  expect(JSON.stringify(view.editor.getEditorState().toJSON())).toBe(before); expect(updates).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled();
  let output = ''; view.editor.getEditorState().read(() => { output = $generateHtmlFromNodes(view.editor); });
  expect(output).not.toMatch(/--eve-document-(?:cell|text)-ink/);
  const saved = new DOMParser().parseFromString(output, 'text/html').querySelectorAll('th');
  expect(saved[0]!.style.backgroundColor).toBe('rgb(242, 243, 245)'); expect(saved[1]!.style.backgroundColor).toBe('rgb(30, 30, 30)');
  expect(saved[1]!.querySelector('[style*="color: magenta"]')).not.toBeNull(); expect(saved[2]!.style.backgroundColor).toBe('');
  const retired = ['Legacy default','Dark nested','Light nested'].map(owner); stop(); view.unmount();
  expect(retired.every(element => !element.style.getPropertyValue(DOCUMENT_TEXT_INK))).toBe(true);
  const reopened = render(<DocumentEditor projectId="fixture" fileName="report.html" title="Report" observed={{ html: documentHtml('Report', output), sha256: 'saved' }} onSaved={() => {}} />);
  await waitFor(() => expect(ink('Dark nested')).toBe('white')); expect(save).not.toHaveBeenCalled(); reopened.unmount();
});
it('reacts to public text/cell style mutations without erasing newly authored foregrounds or semantic code/link ink', async () => {
  const view = fixture('<table><tr><th style="background-color:rgb(242,243,245)">Changed text</th><th>Changed cell</th><th style="background-color:rgb(30,30,30)"><a href="https://fixture.test">Linked text</a><code>Code text</code><span style="color:black">Authored poor contrast</span></th></tr></table>');
  await waitFor(() => expect(ink('Changed text')).toBe('black'));
  expect(ink('Linked text')).toBe(''); expect(ink('Code text')).toBe(''); expect(ink('Authored poor contrast')).toBe('');
  expect(getComputedStyle(owner('Linked text')).color).toBe('rgb(120, 180, 250)'); expect(getComputedStyle(owner('Code text')).color).toBe('rgb(190, 190, 190)');
  act(() => view.editor.update(() => { const node = $getNearestNodeFromDOMNode(owner('Changed text')); if (!$isTextNode(node)) throw Error('Expected text owner'); node.setStyle('background-color:rgb(30,30,30)'); }, { discrete: true }));
  await waitFor(() => expect(ink('Changed text')).toBe(''));
  act(() => view.editor.update(() => { const node = $getNearestNodeFromDOMNode(owner('Changed text')); if (!$isTextNode(node)) throw Error('Expected text owner'); node.setStyle('background-color:rgb(242,243,245);color:magenta'); }, { discrete: true }));
  await waitFor(() => expect(owner('Changed text').style.color).toBe('magenta')); expect(ink('Changed text')).toBe('');
  act(() => view.editor.update(() => { const node = $getNearestNodeFromDOMNode(owner('Changed cell').closest('th')!); if (!$isTableCellNode(node)) throw Error('Expected cell owner'); node.setBackgroundColor('rgb(242,243,245)'); }, { discrete: true }));
  await waitFor(() => expect(ink('Changed cell')).toBe('black')); expect(ink('Authored poor contrast')).toBe('');
  view.unmount();
});

it('tracks the registered code-highlight text subclass and withdraws fallback for an authored foreground', async () => {
  const view = fixture('<table><tr><th>Code owner</th></tr></table>');
  act(() => view.editor.update(() => {
    const cell = $getNearestNodeFromDOMNode(owner('Code owner').closest('th')!);
    if (!$isTableCellNode(cell)) throw Error('Expected cell owner');
    cell.clear();
    const code = $createCodeNode('javascript'), text = $createCodeHighlightNode('Highlighted text', 'keyword');
    text.setStyle('background-color:rgb(242,243,245)'); code.append(text); cell.append(code);
  }, { discrete: true }));
  await waitFor(() => expect(ink('Highlighted text')).toBe('black'));
  act(() => view.editor.update(() => {
    const text = $getNearestNodeFromDOMNode(owner('Highlighted text'));
    if (!$isTextNode(text)) throw Error('Expected highlighted text owner');
    text.setStyle('background-color:rgb(242,243,245);color:magenta');
  }, { discrete: true }));
  await waitFor(() => expect(owner('Highlighted text').style.color).toBe('magenta'));
  expect(ink('Highlighted text')).toBe(''); expect(save).not.toHaveBeenCalled(); view.unmount();
});
