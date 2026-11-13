// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { $getRoot, $getNodeByKey, UNDO_COMMAND, type LexicalEditor } from 'lexical';
import { $isTableNode, $isTableCellNode } from '@lexical/table';
import { DocumentEditor } from '../../../src/components/embedded/document/DocumentEditor';
import { documentHtml } from '../../../src/components/embedded/document/document-html';
import { readDocumentTableTarget, runDocumentTableAction } from '../../../src/components/embedded/document/document-table-actions';
const save = vi.hoisted(() => vi.fn());
vi.mock('../../../src/components/embedded/document/document-file', () => ({ saveDocumentFile: save }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
beforeEach(() => { save.mockReset(); save.mockImplementation(async (_project, _file, html) => ({ html, sha256: 'saved' })); });
const simple = '<p data-od-id="before">Keep before</p><table data-od-id="table"><tbody><tr><th><p>A</p></th><th><p>B</p></th></tr><tr><td><p>C</p></td><td><p>D</p></td></tr></tbody></table><p data-od-id="after">Keep after</p>';
function fixture(body = simple) {
  const observed = { html: documentHtml('Report', body), sha256: 'owned-original' };
  const view = render(<DocumentEditor projectId="fixture" fileName="report.html" title="Report" observed={observed} onSaved={() => {}} />);
  const root = screen.getByRole('textbox', { name: 'Report' }) as HTMLElement & { __lexicalEditor: LexicalEditor };
  return { ...view, editor: root.__lexicalEditor, root, observed };
}
async function open(cell: Element) { fireEvent.contextMenu(cell, { clientX: 40, clientY: 50 }); return screen.findByRole('menu', { name: 'Table rows and columns' }); }
const rows = () => Array.from(screen.getByRole('table').querySelectorAll('tr'));

it('targets the clicked adjacent cell instead of the old caret and saves semantic source with unrelated identities', async () => {
  const { editor, root, observed } = fixture();
  act(() => editor.update(() => { const table = $getRoot().getChildren().find($isTableNode)!; table.getFirstDescendant()!.selectStart(); }, { discrete: true }));
  await open(rows()[1]!.children[1]!); fireEvent.click(screen.getByRole('menuitem', { name: 'Insert row above' }));
  await waitFor(() => expect(rows()).toHaveLength(3));
  expect(rows()[0]!.textContent).toBe('AB'); expect(rows()[1]!.textContent).toBe(''); expect(rows()[2]!.textContent).toBe('CD');
  fireEvent.click(screen.getByRole('button', { name: 'Save document' }));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  const html = save.mock.calls[0]![2] as string, parsed = new DOMParser().parseFromString(html, 'text/html');
  expect(parsed.querySelectorAll('tr')).toHaveLength(3);
  const ids = Array.from(parsed.querySelectorAll('[data-od-id]')).map(node => node.getAttribute('data-od-id'));
  expect(new Set(ids).size).toBe(ids.length);
  expect(Array.from(parsed.querySelectorAll('tr')[1]!.children).every(cell => cell.hasAttribute('data-od-id'))).toBe(true);
  expect(parsed.querySelector('[data-od-id="before"]')?.textContent).toBe('Keep before');
  expect(parsed.querySelector('[data-od-id="after"]')?.textContent).toBe('Keep after'); expect(save.mock.calls[0]![3]).toBe(observed);
  expect(root.querySelector('table')?.textContent).toBe('ABCD');
  await waitFor(() => expect(root).toHaveFocus());
});
for (const [label, rowCount, columns] of [
  ['Insert row above', 3, 2], ['Insert row below', 3, 2], ['Insert column left', 2, 3], ['Insert column right', 2, 3], ['Delete row', 1, 2], ['Delete column', 2, 1],
] as const) it(`${label} is one reversible Lexical history operation`, async () => {
  const { editor } = fixture(); await open(rows()[1]!.children[1]!);
  fireEvent.click(screen.getByRole('menuitem', { name: label }));
  await waitFor(() => { expect(rows()).toHaveLength(rowCount); expect(rows()[0]!.children).toHaveLength(columns); });
  act(() => { editor.dispatchCommand(UNDO_COMMAND, undefined); });
  await waitFor(() => { expect(rows()).toHaveLength(2); expect(rows()[0]!.children).toHaveLength(2); expect(screen.getByRole('table').textContent).toBe('ABCD'); });
});
it('refuses a captured cell removed while the portal is open, instead of mutating another cell', async () => {
  const { editor } = fixture(); const cell = rows()[1]!.children[1]!, target = readDocumentTableTarget(editor, cell, false)!;
  await open(cell);
  act(() => editor.update(() => { $getNodeByKey(target.cellKey)!.remove(); }, { discrete: true }));
  const before = screen.getByRole('table').outerHTML;
  fireEvent.click(screen.getByRole('menuitem', { name: 'Insert column right' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('cell changed'); expect(screen.getByRole('table').outerHTML).toBe(before);
});
it('does not intercept ordinary text or viewing-mode context menus and rejects late read-only actions', async () => {
  const { editor, root } = fixture();
  const plain = root.querySelector('p')!, event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 50 });
  fireEvent(plain, event); expect(event.defaultPrevented).toBe(false); expect(screen.queryByRole('menu')).toBeNull();
  const cell = rows()[1]!.children[1]!, target = readDocumentTableTarget(editor, cell, false)!; await open(cell);
  act(() => editor.setEditable(false)); await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  expect(() => runDocumentTableAction(editor, 'row-delete', target)).toThrow('viewing');
  const viewing = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 50 });
  fireEvent(cell, viewing); expect(viewing.defaultPrevented).toBe(false);
});
it('opens for the keyboard selection, Escape preserves the table, and long touch retains its actual cell', async () => {
  const { editor, root } = fixture();
  act(() => editor.update(() => { $getRoot().getChildren().find($isTableNode)!.getLastDescendant()!.selectStart(); }, { discrete: true }));
  const anchor = vi.spyOn(rows()[1]!.children[1]!, 'getBoundingClientRect');
  fireEvent.keyDown(root, { key: 'F10', shiftKey: true }); const menu = await screen.findByRole('menu');
  expect(anchor).toHaveBeenCalled();
  fireEvent.keyDown(menu, { key: 'Escape' }); expect(screen.queryByRole('menu')).toBeNull(); expect(rows()).toHaveLength(2);
  // JSDOM has no native PointerEvent fields; supply the same touch fields that
  // the actual browser dispatches, without replacing the timer/menu mechanism.
  const target = rows()[1]!.children[0]!, down = new Event('pointerdown', { bubbles: true });
  Object.defineProperties(down, { pointerType: { value: 'touch' }, clientX: { value: 40 }, clientY: { value: 50 }, pointerId: { value: 1 } });
  fireEvent(target, down); await screen.findByRole('menu');
  fireEvent.click(screen.getByRole('menuitem', { name: 'Insert row below' }));
  await waitFor(() => expect(rows()).toHaveLength(3)); expect(rows()[1]!.textContent).toBe('CD');
});
it('uses merge-aware column insertion without losing spanned-cell content', async () => {
  fixture('<table><tbody><tr><th colspan="2"><p>Spanned</p></th></tr><tr><td><p>Left</p></td><td><p>Right</p></td></tr></tbody></table>');
  await open(rows()[0]!.children[0]!); expect(screen.getByRole('menuitem', { name: 'Delete 2 columns' })).toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
  await open(rows()[1]!.children[0]!); fireEvent.click(screen.getByRole('menuitem', { name: 'Insert column right' }));
  await waitFor(() => expect(rows()[1]!.children).toHaveLength(3));
  expect(rows()[0]!.children[0]).toHaveAttribute('colspan', '3'); expect(rows()[0]!.textContent).toBe('Spanned'); expect(rows()[1]!.textContent).toBe('LeftRight');
});
for (const label of ['Delete row', 'Delete column', 'Delete table']) it(`${label} on the final table dimension leaves a usable document and can be undone`, async () => {
  const { editor, root } = fixture('<table><tbody><tr><td><p>Only cell</p></td></tr></tbody></table>');
  await open(rows()[0]!.children[0]!); fireEvent.click(screen.getByRole('menuitem', { name: label }));
  await waitFor(() => expect(root.querySelector('table')).toBeNull()); expect(root.querySelector('p')).not.toBeNull();
  act(() => { editor.dispatchCommand(UNDO_COMMAND, undefined); });
  await waitFor(() => expect(screen.getByRole('table').textContent).toBe('Only cell'));
});

it('names the full merged deletion range and preserves a spanning neighbour when deleting one unmerged row', async () => {
  const { editor } = fixture('<table><tbody><tr><td rowspan="2"><p>Shared</p></td><td><p>Upper</p></td></tr><tr><td><p>Lower</p></td></tr><tr><td><p>Keep</p></td><td><p>Tail</p></td></tr></tbody></table>');
  await open(rows()[0]!.children[0]!); expect(screen.getByRole('menuitem', { name: 'Delete 2 rows' })).toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
  await open(rows()[1]!.children[0]!); fireEvent.click(screen.getByRole('menuitem', { name: 'Delete row' }));
  await waitFor(() => expect(rows()).toHaveLength(2)); expect(rows()[0]!.textContent).toBe('SharedUpper'); expect(rows()[1]!.textContent).toBe('KeepTail');
  expect(rows()[0]!.children[0]).not.toHaveAttribute('rowspan', '2');
  act(() => { editor.dispatchCommand(UNDO_COMMAND, undefined); }); await waitFor(() => expect(rows()).toHaveLength(3));
  await open(rows()[0]!.children[0]!); fireEvent.click(screen.getByRole('menuitem', { name: 'Delete 2 rows' }));
  await waitFor(() => expect(rows()).toHaveLength(1)); expect(rows()[0]!.textContent).toBe('KeepTail');
});
it('rejects changed merged extent captured before a menu action', () => {
  const { editor } = fixture(); const target = readDocumentTableTarget(editor, rows()[0]!.children[0]!, false)!;
  act(() => editor.update(() => { const cell = $getNodeByKey(target.cellKey)!; if ($isTableCellNode(cell)) cell.setColSpan(2); }, { discrete: true }));
  expect(() => runDocumentTableAction(editor, 'column-delete', target)).toThrow('cell changed');
});
it('persists inserted document table columns through the real Markdown serializer and import path', async () => {
  const { readMarkdownDocument, finalizeMarkdownDocument } = await import('../../../src/components/embedded/document/markdown-document');
  const observed = { ...await readMarkdownDocument('# Report\n\n| A | B |\n| --- | --- |\n| C | D |\n', 'Report'), sha256: 'markdown-original', format: 'markdown' as const };
  const saved = vi.fn(); save.mockImplementation(async (_project, _file, content) => ({ ...await readMarkdownDocument(await finalizeMarkdownDocument(content), 'Report'), sha256: 'markdown-saved', format: 'markdown' }));
  render(<DocumentEditor projectId="fixture" fileName="report.md" title="Report" observed={observed} onSaved={saved} />);
  await open(rows()[1]!.children[1]!); fireEvent.click(screen.getByRole('menuitem', { name: 'Insert column right' }));
  await waitFor(() => expect(rows()[0]!.children).toHaveLength(3)); fireEvent.click(screen.getByRole('button', { name: 'Save document' }));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  const reopened = new DOMParser().parseFromString(saved.mock.calls[0]![0].html, 'text/html');
  expect(Array.from(reopened.querySelectorAll('tr')).map(row => row.querySelectorAll('th,td').length)).toEqual([3, 3]);
  expect(Array.from(reopened.querySelectorAll('th,td')).map(cell => cell.textContent?.trim())).toEqual(['A', 'B', '', 'C', 'D', '']);
});
