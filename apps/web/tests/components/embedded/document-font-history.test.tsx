// @vitest-environment jsdom
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { $getRoot, $getSelection, $isRangeSelection, CONTROLLED_TEXT_INSERTION_COMMAND, UNDO_COMMAND, REDO_COMMAND, type LexicalEditor } from 'lexical';
import { DocumentEditor } from '../../../src/components/embedded/document/DocumentEditor';
import { documentHtml } from '../../../src/components/embedded/document/document-html';
const save = vi.hoisted(() => vi.fn());
vi.mock('../../../src/components/embedded/document/document-file', () => ({ saveDocumentFile: save }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const observed = { html: documentHtml('Fonts', '<h1 data-od-id="title">Title</h1><p data-od-id="body">Original</p>'), sha256: 'original' };
function mount(strict = true, projectId = 'fixture', source = observed) {
  save.mockImplementation(async (_project, _file, html) => ({ html, sha256: 'saved' }));
  const element = <DocumentEditor projectId={projectId} fileName="fonts.html" title="Fonts" observed={source} onSaved={() => {}} />;
  return render(strict ? <StrictMode>{element}</StrictMode> : element);
}
function editor() { return (screen.getByRole('textbox') as HTMLElement & { __lexicalEditor: LexicalEditor }).__lexicalEditor; }
async function font(group: 'Text' | 'Headings', choice: 'Serif' | 'Sans') {
  fireEvent.click(screen.getByRole('button', { name: /^Font$/ }));
  fireEvent.click(within(screen.getByRole('group', { name: group })).getByRole('button', { name: new RegExp(`^${choice}$`) }));
  await act(async () => {});
}
const family = () => screen.getByRole('textbox').style.fontFamily;
const headingFamily = () => screen.getByRole('textbox').style.getPropertyValue('--document-heading-font');
async function history(active: LexicalEditor, redo = false) { await act(async () => { active.dispatchCommand(redo ? REDO_COMMAND : UNDO_COMMAND, undefined); }); }
function selection(active: LexicalEditor) {
  return active.getEditorState().read(() => {
    const value = $getSelection();
    return $isRangeSelection(value) ? { anchor: { ...value.anchor }, focus: { ...value.focus } } : value;
  });
}
it.each([false, true])('keeps first no-focus heading-font change in native history, StrictMode=%s', async strict => {
  mount(strict); const active = editor();
  expect(selection(active)).toBeNull();
  const original = active.getEditorState().toJSON();
  await font('Headings', 'Sans');
  expect(headingFamily()).toContain('system-ui');
  await history(active);
  expect(headingFamily()).toContain('Georgia');
  expect(active.getEditorState().toJSON()).toEqual(original);
  expect(selection(active)).toBeNull();
  await history(active, true);
  expect(headingFamily()).toContain('system-ui');
  expect(family()).toContain('system-ui');
});
it('keeps Redo and clean source when choosing the already current font after Undo', async () => {
  mount(); const active = editor();
  await font('Text', 'Serif'); expect(family()).toContain('Georgia');
  await history(active); expect(family()).toContain('system-ui');
  const original = active.getEditorState().toJSON();
  await font('Text', 'Sans');
  expect(active.getEditorState().toJSON()).toEqual(original);
  expect(screen.queryByRole('button', { name: 'Save document' })).toBeNull();
  await history(active, true); expect(family()).toContain('Georgia');
});
it('separates ordinary typing and font history without moving the native selection', async () => {
  mount(); const active = editor();
  act(() => active.update(() => { $getRoot().getLastChildOrThrow().selectEnd(); }, { discrete: true }));
  await act(async () => { active.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, ' typed'); });
  const caret = selection(active);
  await font('Text', 'Serif');
  expect(selection(active)).toEqual(caret);
  await history(active);
  expect(family()).toContain('system-ui');
  expect(screen.getByRole('textbox').textContent).toBe('TitleOriginal typed');
  await history(active);
  expect(screen.getByRole('textbox').textContent).toBe('TitleOriginal');
  await history(active, true); await history(active, true);
  expect(screen.getByRole('textbox').textContent).toBe('TitleOriginal typed');
  expect(family()).toContain('Georgia');
});
it('saves the actual font setting and retained content after native Undo and Redo', async () => {
  mount(); const active = editor();
  await font('Text', 'Serif'); await history(active); await history(active, true);
  fireEvent.click(screen.getByRole('button', { name: 'Save document' }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  const html = new DOMParser().parseFromString(save.mock.calls[0]![2], 'text/html');
  expect(html.documentElement.getAttribute('data-eve-document-font')).toBe('serif');
  expect(html.querySelector('h1')?.textContent).toBe('Title');
  expect(html.querySelector('p')?.textContent).toBe('Original');
  expect(save.mock.calls[0]![3].sha256).toBe('original');
});
it('retires font history with the mounted document, including stale old-editor Undo', async () => {
  const first = mount(); const retired = editor();
  await font('Text', 'Serif'); first.unmount();
  mount(true, 'next'); const current = editor();
  await history(retired); await history(current);
  expect(family()).toContain('system-ui');
  expect(selection(current)).toBeNull();
  expect(screen.queryByRole('button', { name: 'Save document' })).toBeNull();
  await font('Text', 'Serif'); await history(current);
  expect(family()).toContain('system-ui');
});
