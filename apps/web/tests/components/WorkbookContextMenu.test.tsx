// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ContextMenu, ContextMenuItem, ContextMenuTrigger } from '../../src/components/embedded/boardui/context-menu';
afterEach(cleanup);
function Fixture({ disabled = false, admit = () => true }: { disabled?: boolean; admit?: () => boolean }) {
  return <ContextMenuTrigger capture isDisabled={disabled} onBeforeOpen={admit}>
    <button onContextMenu={event => event.stopPropagation()}>Worksheet</button>
    <ContextMenu aria-label="Worksheet actions"><ContextMenuItem id="insert">Insert row</ContextMenuItem></ContextMenu>
  </ContextMenuTrigger>;
}
it('opens from a captured canvas context gesture and dismisses with Escape', async () => {
  render(<Fixture />); fireEvent.contextMenu(screen.getByRole('button'), { clientX: 40, clientY: 50 });
  const menu = await screen.findByRole('menu'); expect(screen.getByRole('menuitem').textContent).toBe('Insert row');
  fireEvent.keyDown(menu, { key: 'Escape' }); expect(screen.queryByRole('menu')).toBeNull();
});
it('opens with Shift F10 and withdraws an open menu when ownership is disabled', async () => {
  const view = render(<Fixture />); fireEvent.keyDown(screen.getByRole('button'), { key: 'F10', shiftKey: true });
  await screen.findByRole('menu'); view.rerender(<Fixture disabled />); expect(screen.queryByRole('menu')).toBeNull();
});
it('checks live admission before preventing a browser context gesture', () => {
  const admit = vi.fn(() => false); render(<Fixture admit={admit} />);
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 50 });
  fireEvent(screen.getByRole('button'), event); expect(admit).toHaveBeenCalledOnce(); expect(event.defaultPrevented).toBe(false); expect(screen.queryByRole('menu')).toBeNull();
});

import { WorkbookStructureMenu } from '../../src/components/embedded/workbook/WorkbookStructureMenu';
import type { WorkbookStructureController, WorkbookStructureSelection } from '../../src/components/embedded/workbook/grid-structure-actions';
function actions() {
  let selected: WorkbookStructureSelection | null = { key: 'owned-source-selection', sheetId: '1', range: { startRow: 1, endRow: 1, startColumn: 0, endColumn: 5 }, rowCount: 8, columnCount: 6, axis: 'row', allowed: { 'row-before': true, 'row-after': true, 'row-delete': false } };
  const run = vi.fn(), owner: WorkbookStructureController = { read: () => selected, run, dispose() { selected = null; } };
  return { owner, run };
}
it('offers only the selected axis and passes its captured identity to the controller', async () => {
  const { owner, run } = actions(); render(<WorkbookStructureMenu controller={owner} disabled={false}><button>Grid</button></WorkbookStructureMenu>);
  fireEvent.contextMenu(screen.getByRole('button'), { clientX: 30, clientY: 40 }); await screen.findByRole('menu');
  expect(screen.queryByText('Insert columns left')).toBeNull(); expect(screen.getByRole('menuitem', { name: 'Delete rows' }).getAttribute('aria-disabled')).toBe('true');
  fireEvent.click(screen.getByRole('menuitem', { name: 'Insert rows above' })); expect(run).toHaveBeenCalledWith('row-before', 'owned-source-selection');
});
it('does not intercept a retired controller and withdraws an open menu during a save', async () => {
  const { owner } = actions(); const view = render(<WorkbookStructureMenu controller={owner} disabled={false}><button>Grid</button></WorkbookStructureMenu>);
  fireEvent.contextMenu(screen.getByRole('button'), { clientX: 30, clientY: 40 }); await screen.findByRole('menu');
  view.rerender(<WorkbookStructureMenu controller={owner} disabled><button>Grid</button></WorkbookStructureMenu>); expect(screen.queryByRole('menu')).toBeNull();
  owner.dispose(); view.rerender(<WorkbookStructureMenu controller={owner} disabled={false}><button>Grid</button></WorkbookStructureMenu>);
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 30, clientY: 40 }); fireEvent(screen.getByRole('button'), event); expect(event.defaultPrevented).toBe(false);
});

import { liveWorkbookStructureMenu, type WorkbookStructureMenuController } from '../../src/components/embedded/workbook/grid-structure-actions';
it('reads a newly ready kernel at the first gesture without waiting for a React render', async () => {
  let current: WorkbookStructureMenuController | null = null;
  const proxy = liveWorkbookStructureMenu(() => current), { owner, run } = actions();
  render(<WorkbookStructureMenu controller={proxy} disabled={false}><button>Grid</button></WorkbookStructureMenu>);
  fireEvent.contextMenu(screen.getByRole('button'), { clientX: 30, clientY: 40 }); expect(screen.queryByRole('menu')).toBeNull();
  // Canvas readiness can publish before React commits another state update.
  current = owner;
  fireEvent.contextMenu(screen.getByRole('button'), { clientX: 30, clientY: 40 }); await screen.findByRole('menu');
  fireEvent.click(screen.getByRole('menuitem', { name: 'Insert rows above' })); expect(run).toHaveBeenCalledOnce();
  current = null; expect(() => proxy.run('row-before', 'owned-source-selection')).toThrow('not ready');
});
it('withdraws a replaced source menu while preserving its actual canvas host', async () => {
  const { owner } = actions();
  const view = render(<WorkbookStructureMenu controller={owner} resetKey="source-a" disabled={false}><button>Grid</button></WorkbookStructureMenu>);
  const host = screen.getByRole('button'); fireEvent.contextMenu(host, { clientX: 30, clientY: 40 }); await screen.findByRole('menu');
  view.rerender(<WorkbookStructureMenu controller={owner} resetKey="source-b" disabled={false}><button>Grid</button></WorkbookStructureMenu>);
  expect(screen.queryByRole('menu')).toBeNull(); expect(screen.getByRole('button')).toBe(host); expect(host.isConnected).toBe(true);
});
it('captures SDK-owned editor keyboard targets locally and releases that listener on retirement', async () => {
  const { owner } = actions(), read = vi.spyOn(owner, 'read');
  const view = render(<><button>Chat</button><WorkbookStructureMenu controller={owner} disabled={false}><div data-testid="sdk-root" /></WorkbookStructureMenu></>);
  const host = screen.getByTestId('sdk-root'), editor = document.createElement('div'); editor.contentEditable = 'true'; editor.tabIndex = 0; host.appendChild(editor);
  fireEvent.keyDown(screen.getByRole('button', { name: 'Chat' }), { key: 'F10', shiftKey: true }); expect(read).not.toHaveBeenCalled();
  editor.focus(); const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'F10', shiftKey: true }); fireEvent(editor, event);
  await screen.findByRole('menu'); expect(event.defaultPrevented).toBe(true); expect(read).toHaveBeenCalledOnce();
  view.unmount(); const retired = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ContextMenu' }); fireEvent(editor, retired);
  expect(retired.defaultPrevented).toBe(false); expect(read).toHaveBeenCalledOnce();
});
it('removes native capture when a trigger returns to ordinary bubbling', async () => {
  const admit = vi.fn(() => true);
  const content = (capture: boolean) => <ContextMenuTrigger capture={capture} onBeforeOpen={admit}><button>Grid</button><ContextMenu aria-label="Worksheet actions"><ContextMenuItem id="insert">Insert row</ContextMenuItem></ContextMenu></ContextMenuTrigger>;
  const view = render(content(true)), target = screen.getByRole('button');
  fireEvent(target, new KeyboardEvent('keydown', { bubbles: false, cancelable: true, key: 'F10', shiftKey: true })); await screen.findByRole('menu');
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' }); view.rerender(content(false)); admit.mockClear();
  fireEvent(target, new KeyboardEvent('keydown', { bubbles: false, cancelable: true, key: 'F10', shiftKey: true }));
  expect(admit).not.toHaveBeenCalled(); expect(screen.queryByRole('menu')).toBeNull();
});
it('retains selected-cell keyboard anchoring and target admission across source resets', async () => {
  const admit = vi.fn(() => true), anchor = document.createElement('div');
  const measure = vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue({ x: 30, y: 40, left: 30, top: 40, right: 90, bottom: 70, width: 60, height: 30, toJSON() {} });
  const content = (source: string) => <ContextMenuTrigger capture resetKey={source} onBeforeOpen={admit} getKeyboardAnchor={() => anchor}><div data-testid="editor-owner" /><ContextMenu aria-label="Cell actions"><ContextMenuItem id="insert">Insert row</ContextMenuItem></ContextMenu></ContextMenuTrigger>;
  const view = render(content('a')), editor = document.createElement('div'); screen.getByTestId('editor-owner').appendChild(editor);
  fireEvent(editor, new KeyboardEvent('keydown', { bubbles: false, cancelable: true, key: 'ContextMenu' }));
  await screen.findByRole('menu'); expect(admit).toHaveBeenLastCalledWith(editor, true); expect(measure).toHaveBeenCalled();
  view.rerender(content('b')); expect(screen.queryByRole('menu')).toBeNull(); expect(editor.isConnected).toBe(true);
  fireEvent.contextMenu(editor, { clientX: 40, clientY: 50 }); await screen.findByRole('menu'); expect(admit).toHaveBeenLastCalledWith(editor, false);
});

function touch(target: Element, type: string, fields: Record<string, unknown> = {}) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  for (const [name, value] of Object.entries({ pointerType: 'touch', pointerId: 1, isPrimary: true, clientX: 40, clientY: 50, ...fields })) Object.defineProperty(event, name, { value });
  fireEvent(target, event); return event;
}
it('keeps a completed long-touch menu open without letting its compatibility press refocus the editor', async () => {
  render(<Fixture />); const target = screen.getByRole('button');
  touch(target, 'pointerdown'); await screen.findByRole('menu'); touch(target, 'pointerup');
  const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true, detail: 1, clientX: 40, clientY: 50 });
  fireEvent(target, down); expect(down.defaultPrevented).toBe(true);
  const click = new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1, clientX: 40, clientY: 50 });
  fireEvent(target, click); expect(click.defaultPrevented).toBe(true); expect(screen.getByRole('menu')).toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
  const ordinary = new MouseEvent('mousedown', { bubbles: true, cancelable: true, detail: 1, clientX: 40, clientY: 50 });
  fireEvent(target, ordinary); expect(ordinary.defaultPrevented).toBe(false);
});
it.each(['disable', 'reset', 'cancel', 'new-pointer', 'unmount'])('releases a fired long-touch guard on %s', async how => {
  const content = (disabled = false, resetKey = 'one') => <ContextMenuTrigger capture isDisabled={disabled} resetKey={resetKey}><button>Cell</button><ContextMenu><ContextMenuItem id="insert">Insert</ContextMenuItem></ContextMenu></ContextMenuTrigger>;
  const view = render(content()), target = screen.getByRole('button'); touch(target, 'pointerdown'); await screen.findByRole('menu');
  if (how === 'disable') view.rerender(content(true));
  else if (how === 'reset') view.rerender(content(false, 'two'));
  else if (how === 'cancel') touch(target, 'pointercancel');
  else if (how === 'new-pointer') touch(target, 'pointerdown', { pointerType: 'mouse' });
  else { view.unmount(); document.body.append(target); }
  const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true, detail: 1, clientX: 40, clientY: 50 }); fireEvent(target, down); expect(down.defaultPrevented).toBe(false);
  if (how === 'unmount') target.remove();
});
it('does not suppress ordinary short taps or a moving touch scroll', async () => {
  const admit = vi.fn(() => true); render(<Fixture admit={admit} />); const target = screen.getByRole('button');
  touch(target, 'pointerdown'); touch(target, 'pointerup');
  touch(target, 'pointerdown'); touch(target, 'pointermove', { clientY: 100 }); touch(target, 'pointerup', { clientY: 100 });
  await new Promise(resolve => setTimeout(resolve, 550));
  expect(admit).not.toHaveBeenCalled(); expect(screen.queryByRole('menu')).toBeNull();
  const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true, detail: 1, clientX: 40, clientY: 50 }); fireEvent(target, down); expect(down.defaultPrevented).toBe(false);
});
it('withdraws a touch completion guard before an SDK stops a new pointer gesture bubbling', async () => {
  render(<Fixture />); const target = screen.getByRole('button');
  touch(target, 'pointerdown'); await screen.findByRole('menu');
  target.addEventListener('pointerdown', event => event.stopPropagation());
  touch(target, 'pointerdown', { pointerType: 'mouse' });
  const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true, detail: 1, clientX: 40, clientY: 50 }); fireEvent(target, down); expect(down.defaultPrevented).toBe(false);
});
