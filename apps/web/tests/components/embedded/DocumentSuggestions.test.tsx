// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { $getRoot, CONTROLLED_TEXT_INSERTION_COMMAND, type LexicalEditor } from 'lexical';
import { DocumentEditor } from '../../../src/components/embedded/document/DocumentEditor';
import { documentHtml } from '../../../src/components/embedded/document/document-html';
const save = vi.hoisted(() => vi.fn());
vi.mock('../../../src/components/embedded/document/document-file', () => ({ saveDocumentFile: save }));
afterEach(() => { cleanup(); vi.clearAllMocks(); document.documentElement.lang = 'en'; document.documentElement.dir = 'ltr'; });
const original = { html: documentHtml('Review', '<p data-od-id="body">Original</p>'), sha256: 'original' };
function editor(): LexicalEditor { return (screen.getByRole('textbox', { name: 'Review' }) as HTMLElement & { __lexicalEditor: LexicalEditor }).__lexicalEditor; }
async function suggest() {
  fireEvent.click(screen.getByRole('button', { name: 'Editing, mode' }));
  fireEvent.click(screen.getByRole('button', { name: 'Suggesting' }));
  const active = editor();
  act(() => active.update(() => { $getRoot().getFirstChildOrThrow().selectEnd(); }, { discrete: true }));
  await act(async () => { active.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, ' proposal'); });
  await screen.findByRole('button', { name: 'Accept' });
}
it('saves a real proposal through the existing writer, reopens it and saves rejection as the original text', async () => {
  save.mockImplementation(async (_project, _file, html) => ({ html, sha256: 'saved-proposal' }));
  const mounted = render(<DocumentEditor projectId="fixture" fileName="review.html" title="Review" observed={original} onSaved={() => {}} />);
  await suggest();
  fireEvent.click(screen.getByRole('button', { name: 'Save document' }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  const proposed = save.mock.calls[0]![2] as string;
  expect(new DOMParser().parseFromString(proposed, 'text/html').querySelector('ins')?.textContent).toBe(' proposal');
  expect(save.mock.calls[0]![3].sha256).toBe('original');
  mounted.unmount();
  render(<DocumentEditor projectId="fixture" fileName="review.html" title="Review" observed={{ html: proposed, sha256: 'saved-proposal' }} onSaved={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Reject' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Save document' }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  const restored = new DOMParser().parseFromString(save.mock.calls[1]![2] as string, 'text/html');
  expect(restored.querySelector('ins,del')).toBeNull();
  expect(restored.querySelector('p')?.textContent).toBe('Original');
  expect(restored.querySelector('p')?.getAttribute('data-od-id')).toBe('body');
  expect(save.mock.calls[1]![3].sha256).toBe('saved-proposal');
});
it('queues acceptance during a pending proposal save against the actual acknowledged source', async () => {
  let finish!: () => void;
  save.mockImplementation(async (_project, _file, html) => {
    if (save.mock.calls.length === 1) await new Promise<void>(resolve => { finish = resolve; });
    return { html, sha256: 'acknowledged-proposal' };
  });
  render(<DocumentEditor projectId="fixture" fileName="review.html" title="Review" observed={original} onSaved={() => {}} />);
  await suggest(); fireEvent.click(screen.getByRole('button', { name: 'Save document' }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
  await act(async () => { finish(); });
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  const accepted = new DOMParser().parseFromString(save.mock.calls[1]![2] as string, 'text/html');
  expect(accepted.querySelector('ins,del')).toBeNull(); expect(accepted.querySelector('p')?.textContent).toBe('Original proposal');
  expect(save.mock.calls[1]![3].sha256).toBe('acknowledged-proposal');
});
it('retains the complete proposal after a source conflict and prevents review while Viewing', async () => {
  save.mockRejectedValue(Object.assign(new Error('Source changed'), { status: 409 }));
  render(<DocumentEditor projectId="fixture" fileName="review.html" title="Review" observed={original} onSaved={() => {}} />);
  await suggest(); fireEvent.click(screen.getByRole('button', { name: 'Save document' }));
  await screen.findByText('Source changed');
  expect(screen.getByRole('button', { name: 'Accept' })).toBeEnabled();
  expect(screen.getByRole('textbox', { name: 'Review' }).querySelector('ins')?.textContent).toBe(' proposal');
  fireEvent.click(screen.getByRole('button', { name: 'Suggesting, mode' })); fireEvent.click(screen.getByRole('button', { name: 'Viewing' }));
  expect(screen.getByRole('button', { name: 'Accept' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
  expect(save).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('textbox', { name: 'Review' }).querySelector('ins')?.textContent).toBe(' proposal');
});

import { $isElementNode, $isTextNode, HISTORY_PUSH_TAG, UNDO_COMMAND, REDO_COMMAND } from 'lexical';
it('blocks an untracked source mutation before it can poison native history or a later save', async () => {
  save.mockImplementation(async (_project, _file, html) => ({ html, sha256: 'saved' }));
  render(<DocumentEditor projectId="fixture" fileName="review.html" title="Review" observed={original} onSaved={() => {}} />);
  await suggest();
  const active = editor();
  act(() => active.update(() => {
    const paragraph = $getRoot().getFirstChildOrThrow();
    if (!$isElementNode(paragraph)) throw Error('Expected paragraph');
    const text = paragraph.getFirstChildOrThrow();
    if (!$isTextNode(text)) throw Error('Expected original text');
    text.setTextContent('UNTRACKED');
  }, { discrete: true, tag: HISTORY_PUSH_TAG }));
  expect(screen.getByRole('textbox', { name: 'Review' }).textContent).toBe('Original proposal');
  await act(async () => { active.dispatchCommand(UNDO_COMMAND, undefined); });
  expect(screen.getByRole('textbox', { name: 'Review' }).textContent).toBe('Original');
  expect(screen.getByRole('textbox', { name: 'Review' }).querySelector('ins,del')).toBeNull();
  await act(async () => { active.dispatchCommand(REDO_COMMAND, undefined); });
  expect(screen.getByRole('textbox', { name: 'Review' }).textContent).toBe('Original proposal');
  fireEvent.click(screen.getByRole('button', { name: 'Save document' }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  const saved = new DOMParser().parseFromString(save.mock.calls[0]![2] as string, 'text/html');
  expect(saved.querySelector('p')?.textContent).toBe('Original proposal');
  expect(saved.querySelector('ins')?.textContent).toBe(' proposal');
  expect(save.mock.calls[0]![2]).not.toContain('UNTRACKED');
});
it('retains unrelated normal Editing history while a proposal remains pending', async () => {
  render(<DocumentEditor projectId="fixture" fileName="review.html" title="Review" observed={original} onSaved={() => {}} />);
  await suggest();
  fireEvent.click(screen.getByRole('button', { name: 'Suggesting, mode' })); fireEvent.click(screen.getByRole('button', { name: 'Editing' }));
  const active = editor();
  act(() => active.update(() => {
    const paragraph = $getRoot().getFirstChildOrThrow();
    if (!$isElementNode(paragraph)) throw Error('Expected paragraph');
    const text = paragraph.getFirstChildOrThrow();
    if (!$isTextNode(text)) throw Error('Expected original text');
    text.select(0, 0);
  }, { discrete: true }));
  await act(async () => { active.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, 'Direct '); });
  expect(screen.getByRole('textbox', { name: 'Review' }).textContent).toBe('Direct Original proposal');
  await act(async () => { active.dispatchCommand(UNDO_COMMAND, undefined); });
  expect(screen.getByRole('textbox', { name: 'Review' }).textContent).toBe('Original proposal');
  await act(async () => { active.dispatchCommand(REDO_COMMAND, undefined); });
  expect(screen.getByRole('textbox', { name: 'Review' }).textContent).toBe('Direct Original proposal');
  expect(screen.getByRole('textbox', { name: 'Review' }).querySelector('ins')?.textContent).toBe(' proposal');
});
it('protects the presentation owner of pending source branches from an untracked SDK formatting change', async () => {
  render(<DocumentEditor projectId="fixture" fileName="review.html" title="Review" observed={original} onSaved={() => {}} />);
  await suggest();
  fireEvent.click(screen.getByRole('button', { name: 'Suggesting, mode' })); fireEvent.click(screen.getByRole('button', { name: 'Editing' }));
  act(() => editor().update(() => { const p = $getRoot().getFirstChildOrThrow(); if (!$isElementNode(p)) throw Error('Expected paragraph'); p.setFormat('center'); }, { discrete: true }));
  expect(screen.getByRole('textbox', { name: 'Review' }).querySelector('p')?.style.textAlign).not.toBe('center');
  expect(screen.getByRole('textbox', { name: 'Review' }).querySelector('ins')?.textContent).toBe(' proposal');
});

import { $hasUpdateTag, $getSelection, $isRangeSelection, type RangeSelection } from 'lexical';
import { DOCUMENT_SUGGESTION_UPDATE_TAG } from '../../../src/components/embedded/document/document-suggestion-policy';
import { $suggestDocumentText } from '../../../src/components/embedded/document/document-suggestion-commands';
it('does not leave an owned tag after a failed proposal constructor in the same update', async () => {
  render(<DocumentEditor projectId="fixture" fileName="review.html" title="Review" observed={original} onSaved={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Editing, mode' })); fireEvent.click(screen.getByRole('button', { name: 'Suggesting' }));
  let failure: unknown, owned = false;
  act(() => editor().update(() => {
    const p = $getRoot().getFirstChildOrThrow(); if (!$isElementNode(p)) throw Error('Expected paragraph');
    const text = p.getFirstChildOrThrow(); if (!$isTextNode(text)) throw Error('Expected text'); text.selectEnd();
    try { $suggestDocumentText('proposal', 'invalid-id'); } catch (error) { failure = error; }
    owned = $hasUpdateTag(DOCUMENT_SUGGESTION_UPDATE_TAG);
    text.setTextContent('UNTRACKED');
  }, { discrete: true }));
  expect(failure).toBeInstanceOf(Error); expect(owned).toBe(false);
  expect(screen.getByRole('textbox', { name: 'Review' }).textContent).toBe('Original');
  expect(screen.queryByRole('button', { name: 'Save document' })).toBeNull();
});

import { I18nProvider } from '../../../src/i18n';
it.each([
  { locale: 'fr' as const, editing: 'Modification', mode: 'Suggestion', modeAria: 'Mode Modification', accept: 'Accepter', reject: 'Rejeter', title: 'Examiner les suggestions' },
  { locale: 'ar' as const, editing: 'تحرير', mode: 'اقتراح', modeAria: 'وضع تحرير', accept: 'قبول', reject: 'رفض', title: 'مراجعة الاقتراحات' },
])('uses the existing locale catalog for the actual $locale suggestion controls', async labels => {
  render(<I18nProvider initial={labels.locale}><DocumentEditor projectId="fixture" fileName="review.html" title="Review" observed={original} onSaved={() => {}} /></I18nProvider>);
  fireEvent.click(screen.getByRole('button', { name: labels.modeAria }));
  fireEvent.click(screen.getByRole('button', { name: labels.mode }));
  const active = editor();
  act(() => active.update(() => { $getRoot().getFirstChildOrThrow().selectEnd(); }, { discrete: true }));
  await act(async () => { active.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, ' proposal'); });
  expect(await screen.findByRole('dialog', { name: labels.title })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: labels.accept })).toBeEnabled();
  expect(screen.getByRole('button', { name: labels.reject })).toBeEnabled();
  expect(screen.queryByText(/Pending suggestions are saved/)).toBeNull();
  const card = screen.getByRole('dialog', { name: labels.title });
  card.focus(); fireEvent.keyDown(card, { key: 'Escape' });
  const trigger = await screen.findByRole('button', { name: labels.title });
  expect(trigger).toHaveFocus(); expect(trigger).toHaveAttribute('title', labels.title);
  expect(trigger).not.toHaveTextContent(labels.title);
  expect(trigger.parentElement?.parentElement?.querySelector('[role="status"]')).not.toBeNull();
  fireEvent.click(trigger);
  expect(await screen.findByRole('dialog', { name: labels.title })).toHaveFocus();
  fireEvent.keyDown(screen.getByRole('dialog', { name: labels.title }), { key: 'Escape' });
  fireEvent.click(screen.getByRole('textbox', { name: 'Review' }).querySelector('ins')!);
  expect(await screen.findByRole('dialog', { name: labels.title })).toBeInTheDocument();

});
it('rolls back an unexpected post-insert failure before history and source writing', async () => {
  render(<DocumentEditor projectId="fixture" fileName="review.html" title="Review" observed={original} onSaved={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Editing, mode' })); fireEvent.click(screen.getByRole('button', { name: 'Suggesting' }));
  const active = editor();
  act(() => active.update(() => { $getRoot().getFirstChildOrThrow().selectEnd(); }, { discrete: true }));
  const prototype = active.getEditorState().read(() => { const selection = $getSelection(); if (!$isRangeSelection(selection)) throw Error('Expected range'); return Object.getPrototypeOf(selection) as RangeSelection; });
  const insert = prototype.insertNodes;
  const fault = vi.spyOn(prototype, 'insertNodes').mockImplementation(function(this: RangeSelection, nodes) { insert.call(this, nodes); throw Error('Injected after real insert'); });
  let faultCalls = 0;
  try { await act(async () => { active.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, 'partial'); }); faultCalls = fault.mock.calls.length; }
  finally { fault.mockRestore(); }
  expect(faultCalls).toBe(1);
  expect(screen.getByRole('textbox', { name: 'Review' }).textContent).toBe('Original');
  await act(async () => { active.dispatchCommand(UNDO_COMMAND, undefined); });
  await act(async () => { active.dispatchCommand(REDO_COMMAND, undefined); });
  expect(screen.getByRole('textbox', { name: 'Review' }).textContent).toBe('Original');
  expect(screen.queryByRole('button', { name: 'Save document' })).toBeNull();
  expect(save).not.toHaveBeenCalled();
});
it('shows only the current anchored card, navigates proposals without source edits and returns owned close focus', async () => {
  const marker = (tag: string, id: string, text: string) => `<${tag} data-eve-suggestion="1" data-eve-suggestion-id="${id}" data-eve-suggestion-operation="${tag === 'ins' ? 'insert' : 'delete'}">${text}</${tag}>`;
  const html = documentHtml('Review', `<p data-od-id="one">${marker('ins', '11111111-1111-4111-8111-111111111111', 'First')}</p><p data-od-id="two">${marker('del', '22222222-2222-4222-8222-222222222222', 'Second')}</p>`);
  render(<DocumentEditor projectId="fixture" fileName="review.html" title="Review" observed={{ html, sha256: 'saved' }} onSaved={() => {}} />);
  const before = editor().getEditorState().toJSON();
  expect(await screen.findByText('Suggestion 1 of 2')).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: 'Accept' })).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Next suggestion' }));
  expect(screen.getByText('Suggestion 2 of 2')).toBeInTheDocument();
  const close = screen.getByRole('button', { name: 'Close' }); close.focus(); fireEvent.click(close);
  const trigger = await screen.findByRole('button', { name: 'Review suggestions' }); expect(trigger).toHaveFocus();
  expect(screen.getByRole('button', { name: 'Editing, mode' }).parentElement).toContainElement(trigger);
  expect(trigger).not.toHaveTextContent('Review suggestions');
  fireEvent.click(trigger); expect(await screen.findByRole('dialog', { name: 'Review suggestions' })).toHaveFocus();
  fireEvent.click(screen.getByRole('button', { name: 'Previous suggestion' }));
  expect(screen.getByText('Suggestion 1 of 2')).toBeInTheDocument();
  expect(editor().getEditorState().toJSON()).toEqual(before); expect(save).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Save document' })).toBeNull();
});
