// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { $createTextNode, $getRoot, $isElementNode, $isTextNode, HISTORY_PUSH_TAG, UNDO_COMMAND, type LexicalEditor } from 'lexical';
import { $createHeadingNode } from '@lexical/rich-text';
import { $generateHtmlFromNodes } from '@lexical/html';
import { DocumentEditor } from '../../../src/components/embedded/document/DocumentEditor';
import { documentHtml } from '../../../src/components/embedded/document/document-html';
import { readDocumentSections } from '../../../src/components/embedded/document/document-outline';
const save = vi.hoisted(() => vi.fn());
vi.mock('../../../src/components/embedded/document/document-file', () => ({ saveDocumentFile: save }));
const observed = { html: documentHtml('Report', '<h1 data-od-id="first">Intro</h1><p data-od-id="body">Body text</p><h2 data-od-id="second">Intro</h2>'), sha256: 'original' };
function editor(): LexicalEditor { return (screen.getByRole('textbox', { name: 'Report' }) as HTMLElement & { __lexicalEditor: LexicalEditor }).__lexicalEditor; }
function setup(html = observed) { return render(<DocumentEditor projectId="fixture" fileName="report.html" title="Report" observed={html} onSaved={vi.fn()} />); }
function open() { fireEvent.click(screen.getByRole('button', { name: 'Document outline' })); return screen.getByRole('navigation', { name: 'Document sections' }); }
async function settle() { await act(async () => { await vi.advanceTimersByTimeAsync(200); }); }
beforeEach(() => { vi.useFakeTimers(); save.mockReset(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
it('navigates duplicate-named headings by existing identity without a source write or editor replacement', async () => {
  setup(); const active = editor(), content = screen.getByRole('textbox');
  const before = active.getEditorState().read(() => $generateHtmlFromNodes(active));
  const heading = content.querySelector('h2')!; const scroll = vi.spyOn(heading, 'scrollIntoView');
  const outline = open();
  expect(outline.querySelectorAll('[data-document-section-id]')).toHaveLength(2);
  expect(outline.querySelector('[data-document-section-id="second"]')).toBeTruthy();
  fireEvent.click(within(outline).getByRole('button', { name: 'Section 2, heading level 2: Intro' }));
  await settle();
  expect(scroll).toHaveBeenCalledWith({ block: 'start', inline: 'nearest', behavior: 'auto' });
  expect(heading).toHaveFocus(); expect(heading).toHaveAttribute('tabindex', '-1');
  expect(editor()).toBe(active); expect(screen.getByRole('textbox')).toBe(content);
  expect(active.getEditorState().read(() => $generateHtmlFromNodes(active))).toBe(before);
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); }); expect(save).not.toHaveBeenCalled();
  fireEvent.blur(heading); expect(heading).not.toHaveAttribute('tabindex');
});
it('reconciles real heading edits, insertion, deletion and undo with stable section IDs', async () => {
  setup(); const active = editor(); open();
  act(() => active.update(() => {
    const text = $getRoot().getFirstDescendant(); if ($isTextNode(text)) text.setTextContent('Renamed');
  }, { discrete: true, tag: HISTORY_PUSH_TAG }));
  expect(screen.getByRole('button', { name: 'Section 1, heading level 1: Renamed' })).toBeVisible();
  act(() => active.update(() => { $getRoot().append($createHeadingNode('h3').append($createTextNode('New section'))); }, { discrete: true, tag: HISTORY_PUSH_TAG }));
  const inserted = active.getEditorState().read(readDocumentSections).at(-1)!;
  expect(inserted.id).not.toBe('first'); expect(inserted.id).not.toBe('second');
  expect(screen.getByRole('button', { name: 'Section 3, heading level 3: New section' })).toBeVisible();
  await act(async () => { active.dispatchCommand(UNDO_COMMAND, undefined); });
  expect(screen.queryByRole('button', { name: /New section/ })).toBeNull();
  expect(active.getEditorState().read(readDocumentSections).map(s => s.id)).toEqual(['first', 'second']);
  act(() => active.update(() => { $getRoot().getLastChildOrThrow().remove(); }, { discrete: true, tag: HISTORY_PUSH_TAG }));
  expect(screen.queryByRole('button', { name: 'Section 2, heading level 2: Intro' })).toBeNull();
  await act(async () => { active.dispatchCommand(UNDO_COMMAND, undefined); });
  expect(screen.getByRole('button', { name: 'Section 2, heading level 2: Intro' })).toBeVisible();
  expect(save).not.toHaveBeenCalled();
});
it('refuses a queued navigation after its heading is deleted instead of choosing a same-named heading', async () => {
  setup(); const active = editor(), content = screen.getByRole('textbox'); const first = content.querySelector('h1')!;
  const scroll = vi.spyOn(first, 'scrollIntoView');
  fireEvent.click(within(open()).getByRole('button', { name: 'Section 2, heading level 2: Intro' }));
  act(() => active.update(() => { $getRoot().getLastChildOrThrow().remove(); }, { discrete: true, tag: HISTORY_PUSH_TAG }));
  await settle(); expect(scroll).not.toHaveBeenCalled(); expect(first).not.toHaveFocus();
});
it('supports bounded keyboard navigation and section focus in Viewing mode', async () => {
  setup(); const active = editor();
  fireEvent.click(screen.getByRole('button', { name: 'Editing, mode' }));
  fireEvent.click(screen.getByRole('button', { name: 'Viewing' }));
  const outline = open(), buttons = within(outline).getAllByRole('button');
  await settle(); expect(buttons[0]).toHaveFocus();
  act(() => buttons[0]!.focus()); fireEvent.keyDown(buttons[0]!, { key: 'End' }); expect(buttons[1]).toHaveFocus();
  fireEvent.keyDown(buttons[1]!, { key: 'ArrowDown' }); expect(buttons[0]).toHaveFocus();
  fireEvent.keyDown(buttons[0]!, { key: 'Home' }); expect(buttons[0]).toHaveFocus();
  fireEvent.click(buttons[1]!); await settle();
  expect(screen.getByRole('textbox').querySelector('h2')).toHaveFocus(); expect(active.isEditable()).toBe(false);
  expect(save).not.toHaveBeenCalled();
});
it('offers an honest empty outline without adding headings or dirtying a document', () => {
  setup({ ...observed, html: documentHtml('Report', '<p>Only body text</p>') });
  expect(open()).toHaveTextContent('No headings yet'); expect(editor().getEditorState().read(readDocumentSections)).toEqual([]);
  expect(save).not.toHaveBeenCalled();
});

it('restores keyboard focus on Escape and cancels queued navigation on editor unmount', async () => {
  const view = setup(); const trigger = screen.getByRole('button', { name: 'Document outline' });
  act(() => trigger.focus()); const outline = open(); await settle();
  const buttons = within(outline).getAllByRole('button'); expect(buttons[0]).toHaveFocus();
  fireEvent.keyDown(buttons[0]!, { key: 'Escape' }); await settle();
  expect(screen.queryByRole('navigation', { name: 'Document sections' })).toBeNull(); expect(trigger).toHaveFocus();
  const target = screen.getByRole('textbox').querySelector('h2')!; const scroll = vi.spyOn(target, 'scrollIntoView');
  fireEvent.click(within(open()).getByRole('button', { name: 'Section 2, heading level 2: Intro' }));
  view.unmount(); await settle(); expect(scroll).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled();
});

it('retains unsaved document text and its editor identity while navigating sections', async () => {
  setup(); const active = editor(), content = screen.getByRole('textbox');
  act(() => active.update(() => {
    const text = $getRoot().getChildren()[1];
    const leaf = text && $isElementNode(text) ? text.getFirstDescendant() : null;
    if ($isTextNode(leaf)) leaf.setTextContent('Body text with unsaved changes');
  }, { discrete: true }));
  const desired = active.getEditorState().read(() => $generateHtmlFromNodes(active));
  fireEvent.click(within(open()).getByRole('button', { name: 'Section 2, heading level 2: Intro' }));
  await settle();
  expect(editor()).toBe(active); expect(content).toHaveTextContent('Body text with unsaved changes');
  expect(active.getEditorState().read(() => $generateHtmlFromNodes(active))).toBe(desired);
  expect(screen.getByRole('button', { name: 'Save document' })).toBeEnabled(); expect(save).not.toHaveBeenCalled();
});


it('keeps the outline fade outside its bounded scroller and resets it when reopened', async () => {
 setup();const list=open();
 expect(list).toHaveClass('max-h-80','overflow-y-auto');
 const overlay=list.nextElementSibling as HTMLElement;
 expect(overlay).toHaveAttribute('aria-hidden','true');expect(overlay).toHaveClass('pointer-events-none','absolute');
 const opacity=()=>[...overlay.children].map(layer=>(layer as HTMLElement).style.opacity);
 expect(opacity()).toEqual(['0','0','0']);
 fireEvent.scroll(list,{target:{scrollTop:24}});expect(opacity()).toEqual(['1','1','1']);
 fireEvent.scroll(list,{target:{scrollTop:0}});expect(opacity()).toEqual(['0','0','0']);
 fireEvent.scroll(list,{target:{scrollTop:24}});
 fireEvent.click(screen.getByRole('button',{name:'Document outline'}));await settle();
 const reopened=open();expect([...reopened.nextElementSibling!.children].map(layer=>(layer as HTMLElement).style.opacity)).toEqual(['0','0','0']);
 expect(save).not.toHaveBeenCalled();
});
