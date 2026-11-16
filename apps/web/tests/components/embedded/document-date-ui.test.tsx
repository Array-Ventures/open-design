// @vitest-environment jsdom
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { $getRoot, $isElementNode, CONTROLLED_TEXT_INSERTION_COMMAND, UNDO_COMMAND, REDO_COMMAND, type LexicalEditor } from 'lexical';
import { I18nProvider, useI18n } from '../../../src/i18n';
import { DocumentEditor } from '../../../src/components/embedded/document/DocumentEditor';
import { documentHtml } from '../../../src/components/embedded/document/document-html';
const save = vi.hoisted(() => vi.fn(async (_project: string, _file: string, html: string) => ({ html, sha256: 'saved' })));
vi.mock('../../../src/components/embedded/document/document-file', () => ({ saveDocumentFile: save }));
afterEach(() => { cleanup(); vi.clearAllMocks(); document.querySelector('[aria-label="Unsent draft"]')?.remove(); });
function mount(html = '<p data-od-id="body">Original</p>') {
  return render(<StrictMode><DocumentEditor projectId="date-fixture" fileName="date.html" title="Dates" observed={{ html: documentHtml('Dates', html), sha256: 'date-original' }} onSaved={() => {}} /></StrictMode>);
}
function editor() { return (screen.getByRole('textbox', { name: 'Dates' }) as HTMLElement & { __lexicalEditor: LexicalEditor }).__lexicalEditor; }
it('opens the real calendar immediately from More without prior editor focus and preserves native insertion Undo', async () => {
  mount(); const active = editor();
  fireEvent.click(screen.getByRole('button', { name: 'More document actions' }));
  fireEvent.click(screen.getByRole('button', { name: 'Date' }));
  await waitFor(() => expect(screen.getByRole('dialog', { name: 'Choose date' })).toBeTruthy());
  expect(screen.getByRole('grid', { name: /./ })).toBeTruthy();
  expect(active.read(() => $getRoot().getTextContent())).toMatch(/^Original.+\d{4}$/);
  fireEvent.keyDown(screen.getByRole('dialog', { name: 'Choose date' }), { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Choose date' })).toBeNull());
  await act(async () => { active.dispatchCommand(UNDO_COMMAND, undefined); });
  expect(active.read(() => $getRoot().getTextContent())).toBe('Original');
});
it('keeps persisted labels and refuses calendar editing in Viewing', async () => {
  mount('<p data-od-id="body"><time data-eve-document-date="1" datetime="2024-02-29" data-eve-date-locale="en-US">Frozen date label</time></p>');
  fireEvent.click(screen.getByRole('button', { name: /Editing, mode/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Viewing' }));
  fireEvent.click(screen.getByRole('button', { name: 'Frozen date label' }));
  expect(screen.queryByRole('dialog', { name: 'Choose date' })).toBeNull();
  expect(editor().read(() => $getRoot().getTextContent())).toBe('Frozen date label');
});
it('chooses a day in the actual calendar, keeps one atom, and restores Date focus after commit', async () => {
  mount('<p data-od-id="body"><time data-eve-document-date="1" datetime="2024-02-29" data-eve-date-locale="en-US">Persisted leap day</time></p>');
  fireEvent.click(screen.getByRole('button', { name: 'Persisted leap day' }));
  await waitFor(() => expect(screen.getByRole('dialog', { name: 'Choose date' })).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: /February 28, 2024/ }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Choose date' })).toBeNull());
  expect(editor().read(() => $getRoot().getTextContent())).toBe('Feb 28, 2024');
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Feb 28, 2024' })));
});
it('omits Date in an actual selected table cell and retains its source unchanged', async () => {
  mount('<table><tbody><tr><td><p>Cell</p></td></tr></tbody></table>'); const active = editor();
  await act(async () => active.update(() => { const table = $getRoot().getFirstChildOrThrow(); if ($isElementNode(table)) table.getFirstDescendant()?.selectEnd(); }, { discrete: true }));
  fireEvent.click(screen.getByRole('button', { name: 'More document actions' }));
  expect(screen.queryByRole('button', { name: /^Date$/ })).toBeNull(); expect(active.read(() => $getRoot().getTextContent())).toContain('Cell');
});
it('outside dismissal keeps the newly focused draft input and preserves the selected date', async () => {
  mount('<p data-od-id="body"><time data-eve-document-date="1" datetime="2024-02-29" data-eve-date-locale="en-US">Persisted leap day</time></p>');
  const input = document.createElement('input'); input.setAttribute('aria-label', 'Unsent draft'); document.body.append(input);
  fireEvent.click(screen.getByRole('button', { name: 'Persisted leap day' }));
  await waitFor(() => expect(screen.getByRole('dialog', { name: 'Choose date' })).toBeTruthy());
  fireEvent.mouseDown(input); input.focus(); fireEvent.mouseUp(input); fireEvent.click(input);
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Choose date' })).toBeNull());
  expect(document.activeElement).toBe(input); expect(editor().read(() => $getRoot().getTextContent())).toBe('Persisted leap day'); input.remove();
});
it('shows a protected notice for an imported unowned Date proposal instead of opening an editor', async () => {
  mount('<p data-od-id="body"><ins data-eve-suggestion="1" data-eve-suggestion-id="11111111-1111-4111-8111-111111111111" data-eve-suggestion-operation="insert"><time data-eve-document-date="1" datetime="2024-02-29" data-eve-date-locale="en-US">Imported Date proposal</time></ins></p>');
  fireEvent.click(screen.getByRole('button', { name: 'Imported Date proposal' }));
  expect(screen.queryByRole('dialog', { name: 'Choose date' })).toBeNull();
  expect(screen.getByText('Resolve this suggestion or choose an editable paragraph before changing its date.')).toBeTruthy();
  expect(editor().read(() => $getRoot().getTextContent())).toBe('Imported Date proposal');
});
it.each(['Accept', 'Reject'] as const)('retains a loaded nested Date proposal through first %s native Undo/Redo', async action => {
  mount('<p data-od-id="body"><ins data-eve-suggestion="1" data-eve-suggestion-id="11111111-1111-4111-8111-111111111111" data-eve-suggestion-operation="insert"><a href="https://example.invalid"><time data-eve-document-date="1" datetime="2024-02-29" data-eve-date-locale="en-US">Nested Date proposal</time></a></ins></p>');
  const active = editor(); const before = active.getEditorState().toJSON();
  fireEvent.click(await screen.findByRole('button', { name: action }));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Review suggestions' })).toBeNull());
  await act(async () => { active.dispatchCommand(UNDO_COMMAND, undefined); });
  expect(active.getEditorState().toJSON()).toEqual(before);
  await act(async () => { active.dispatchCommand(REDO_COMMAND, undefined); });
  expect(screen.getByRole('textbox', { name: 'Dates' }).querySelector('ins')).toBeNull();
});
it('preserves authored ISO, locale and label through an unrelated edit, actual conditional writer save and reopen', async () => {
  const atom = '<time data-eve-document-date="1" datetime="2024-02-29" data-eve-date-locale="en-US">An authored frozen label</time>';
  const mounted = mount(`<p data-od-id="body">${atom}</p>`); const active = editor();
  await act(async () => { active.update(() => $getRoot().getFirstChildOrThrow().selectEnd(), { discrete: true }); active.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, ' appended'); });
  fireEvent.click(await screen.findByRole('button', { name: 'Save document' }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  const saved = save.mock.calls[0]![2];
  expect(new DOMParser().parseFromString(saved, 'text/html').querySelector('time')?.outerHTML).toBe(atom);
  expect(new DOMParser().parseFromString(saved, 'text/html').querySelector('main')?.textContent).toContain(' appended');
  mounted.unmount();
  render(<DocumentEditor projectId="reopened-date" fileName="date.html" title="Dates" observed={{ html: saved, sha256: 'saved' }} onSaved={() => {}} />);
  expect(screen.getByRole('button', { name: 'An authored frozen label' })).toBeTruthy();
  expect(editor().read(() => $getRoot().getTextContent())).toContain(' appended');
  expect(screen.queryByRole('button', { name: 'Save document' })).toBeNull();
});
it('uses the actual Suggesting toolbar and calendar for one Add whose day changes before Review', async () => {
  mount(); const active = editor();
  fireEvent.click(screen.getByRole('button', { name: /Editing, mode/ })); fireEvent.click(screen.getByRole('button', { name: /^Suggesting$/ }));
  expect(screen.queryByRole('button', { name: 'Insert table' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'More document actions' })); fireEvent.click(screen.getByRole('button', { name: /^Date$/ }));
  await waitFor(() => expect(screen.getByRole('dialog', { name: 'Choose date' })).toBeTruthy());
  const proposed = screen.getByRole('textbox', { name: 'Dates' }).querySelector('ins')!;
  const id = proposed.getAttribute('data-eve-suggestion-id'), beforeLabel = proposed.textContent; expect(id).toBeTruthy();
  const grid = screen.getByRole('grid'); const selected = grid.querySelector('[aria-selected="true"] [role="button"]') ?? grid.querySelector('[tabindex="0"]');
  expect(selected).toBeTruthy();
  fireEvent.keyDown(selected!, { key: 'ArrowRight' }); fireEvent.keyUp(selected!, { key: 'ArrowRight' }); fireEvent.keyDown(document.activeElement!, { key: 'Enter' }); fireEvent.keyUp(document.activeElement!, { key: 'Enter' });
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Choose date' })).toBeNull());
  const inserts = screen.getByRole('textbox', { name: 'Dates' }).querySelectorAll('ins'); expect(inserts).toHaveLength(1); expect(inserts[0]?.getAttribute('data-eve-suggestion-id')).toBe(id); expect(inserts[0]?.textContent).not.toBe(beforeLabel);
  fireEvent.click(await screen.findByRole('button', { name: 'Reject' }));
  await waitFor(() => expect(active.read(() => $getRoot().getTextContent())).toBe('Original'));
  await act(async () => { active.dispatchCommand(UNDO_COMMAND, undefined); });
  expect(screen.getByRole('textbox', { name: 'Dates' }).querySelectorAll('ins')).toHaveLength(1);
});
it('changes UI locale without regenerating the authored label, changing editor data or queuing a save', async () => {
  function Language() { const { setLocale } = useI18n(); return <button onClick={() => setLocale('fr')}>Use French</button>; }
  const html = documentHtml('Dates', '<p data-od-id="body"><time data-eve-document-date="1" datetime="2024-02-29" data-eve-date-locale="en-US">Authored English date label</time></p>');
  render(<I18nProvider initial="en"><Language /><DocumentEditor projectId="locale-date" fileName="date.html" title="Dates" observed={{ html, sha256: 'authored-date' }} onSaved={() => {}} /></I18nProvider>);
  const before = editor().getEditorState().toJSON(); fireEvent.click(screen.getByRole('button', { name: 'Use French' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Mode Modification' })).toBeTruthy());
  expect(screen.getByRole('button', { name: 'Authored English date label' })).toHaveAttribute('aria-roledescription', 'Date');
  expect(editor().getEditorState().toJSON()).toEqual(before); expect(save).not.toHaveBeenCalled(); expect(screen.queryByRole('button', { name: 'Save document' })).toBeNull();
  localStorage.removeItem('open-design:locale'); localStorage.removeItem('open-design:locale-source');
});
