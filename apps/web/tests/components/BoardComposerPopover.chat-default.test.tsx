// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PreviewComment } from '../../src/types';
import { BoardComposerPopover } from '../../src/components/BoardComposerPopover';
vi.mock('../../src/components/embedded/host-viewer', () => ({ useEmbeddedMentionBots: () => [{ id: 'chief', name: 'Chief' }], useEmbeddedViewer: () => ({ memberId: 'evebot:person', displayName: 'Person' }) }));
afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());
const target = { filePath: 'deck.html', elementId: 'title', selector: 'h1', label: 'Title', text: 'Title', position: { x: 20, y: 20, width: 100, height: 30 }, htmlHint: '' };
const save = vi.fn(), send = vi.fn();
function tree(draft = '@Chief help', overrides = {}) {
  return <BoardComposerPopover target={target} existing={null} compact draft={draft} notes={[]} images={[]} onDraft={vi.fn()} onAddDraft={vi.fn()} onRemoveQueuedNote={vi.fn()} onClose={vi.fn()} onSaveComment={save} onSendBatch={send} onRemoveMember={vi.fn()} sending={false} t={((key: string) => key) as never} {...overrides} />;
}
it('defaults to staging only on explicit save, preserves opt-out, and resets for new picks', () => {
  save.mockClear(); send.mockClear();
  const view = render(tree());
  expect(screen.getByRole('checkbox', { name: 'Add to chat' })).toBeChecked(); expect(save).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Add to chat' }));
  view.rerender(tree('@Chief more @Chief'));
  expect(screen.getByRole('checkbox', { name: 'Add to chat' })).not.toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: 'Add comment' })); expect(save).toHaveBeenCalledWith(false);
  view.rerender(tree('@Chief', { rootSelectionIntent: 1 }));
  expect(screen.getByRole('checkbox', { name: 'Add to chat' })).toBeChecked();
});
it('fails closed when edit/send permissions disappear and preserves an opt-out on return', () => {
  const view = render(tree());
  fireEvent.click(screen.getByRole('checkbox', { name: 'Add to chat' }));
  view.rerender(tree('@Chief', { canSendToAgent: false })); expect(screen.queryByRole('checkbox')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Add comment' })); expect(save).toHaveBeenLastCalledWith(false);
  view.rerender(tree('@Chief')); expect(screen.getByRole('checkbox')).not.toBeChecked();
  view.rerender(tree('@Chief', { canEditComment: false, canSendToAgent: false }));
  expect(screen.queryByRole('checkbox')).toBeNull(); expect(screen.queryByRole('button', { name: 'Add comment' })).toBeNull();
});
it('also defaults an actively edited saved root with a mention', () => {
  const existing = { ...target, id: 'root', note: 'Original', status: 'open', createdAt: 1, updatedAt: 1 } as PreviewComment;
  render(tree('@Chief revise', { existing, rootEditIntent: 1 }));
  expect(screen.getByRole('checkbox')).toBeChecked();
});
