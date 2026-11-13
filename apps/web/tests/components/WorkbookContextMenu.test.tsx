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
