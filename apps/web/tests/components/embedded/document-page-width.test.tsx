// @vitest-environment jsdom
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { $getRoot, $getSelection, CONTROLLED_TEXT_INSERTION_COMMAND, UNDO_COMMAND, REDO_COMMAND, type LexicalEditor } from 'lexical';
import { DocumentEditor } from '../../../src/components/embedded/document/DocumentEditor';
import { documentHtml } from '../../../src/components/embedded/document/document-html';
import { I18nProvider } from '../../../src/i18n';
const save = vi.hoisted(() => vi.fn());
const actor = vi.hoisted(() => ({ memberId: 'person-a' }));
vi.mock('../../../src/components/embedded/host-viewer', () => ({ useEmbeddedViewer: () => actor }));
vi.mock('../../../src/components/embedded/document/document-file', () => ({ saveDocumentFile: save }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); localStorage.clear(); actor.memberId = 'person-a'; });
const observed = { html: documentHtml('Layout', '<p data-od-id="body">Original</p>'), sha256: 'original' };
function mount(projectId = 'project-a', fileName = 'report.html') {
  return render(<StrictMode><DocumentEditor projectId={projectId} fileName={fileName} title="Layout" observed={observed} onSaved={() => {}} /></StrictMode>);
}
function editor() { return (screen.getByRole('textbox') as HTMLElement & { __lexicalEditor: LexicalEditor }).__lexicalEditor; }
function more() { fireEvent.click(screen.getByRole('button', { name: 'More document actions' })); }
function width(name: 'Make page wide' | 'Use standard page width') { more(); fireEvent.click(screen.getByRole('button', { name })); }
function currentAction(name: string) { more(); expect(screen.getByRole('button', { name })).toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'More document actions' })); }

it('changes page layout without changing source, native selection or text Undo/Redo', async () => {
  mount(); const active = editor(), textbox = screen.getByRole('textbox');
  act(() => active.update(() => { $getRoot().getFirstChildOrThrow().selectEnd(); }, { discrete: true }));
  await act(async () => { active.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, ' typed'); });
  const source = active.getEditorState().toJSON();
  const caret = active.getEditorState().read(() => JSON.stringify($getSelection()));
  width('Make page wide');
  expect(screen.getByRole('textbox')).toBe(textbox);
  expect(active.getEditorState().toJSON()).toEqual(source);
  expect(active.getEditorState().read(() => JSON.stringify($getSelection()))).toBe(caret);
  await act(async () => { active.dispatchCommand(UNDO_COMMAND, undefined); });
  expect(textbox.textContent).toBe('Original');
  width('Use standard page width');
  await act(async () => { active.dispatchCommand(REDO_COMMAND, undefined); });
  expect(textbox.textContent).toBe('Original typed');
  expect(save).not.toHaveBeenCalled();
});

it('remembers layout for this viewer and file without dirtying a clean document', () => {
  const first = mount(); width('Make page wide');
  expect(screen.queryByRole('button', { name: 'Save document' })).toBeNull();
  first.unmount(); const reopened = mount(); currentAction('Use standard page width');
  expect(screen.queryByRole('button', { name: 'Save document' })).toBeNull();
  expect(save).not.toHaveBeenCalled(); reopened.unmount();
  const otherFile = mount('project-a', 'other.html'); currentAction('Make page wide'); otherFile.unmount();
  const otherProject = mount('project-b'); currentAction('Make page wide'); otherProject.unmount();
  actor.memberId = 'person-b'; const otherPerson = mount(); currentAction('Make page wide'); otherPerson.unmount();
  actor.memberId = 'person-a'; mount(); currentAction('Use standard page width');
});

it('keeps layout usable when browser preference storage is unavailable', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw Error('Storage blocked'); });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw Error('Storage blocked'); });
  const first = mount(); width('Make page wide'); currentAction('Use standard page width');
  expect(screen.queryByRole('button', { name: 'Save document' })).toBeNull();
  first.unmount(); mount(); currentAction('Make page wide');
  expect(save).not.toHaveBeenCalled();
});

it.each([
  { locale: 'fr' as const, wide: 'Élargir la page', standard: 'Utiliser la largeur de page standard' },
  { locale: 'ar' as const, wide: 'توسيع الصفحة', standard: 'استخدام عرض الصفحة القياسي' },
])('uses translated width controls in $locale without changing the document', labels => {
  render(<I18nProvider initial={labels.locale}><DocumentEditor projectId="localized" fileName="report.html" title="Layout" observed={observed} onSaved={() => {}} /></I18nProvider>);
  const active = editor(), source = active.getEditorState().toJSON();
  more(); fireEvent.click(screen.getByRole('button', { name: labels.wide }));
  currentAction(labels.standard);
  expect(active.getEditorState().toJSON()).toEqual(source);
  expect(save).not.toHaveBeenCalled();
});
