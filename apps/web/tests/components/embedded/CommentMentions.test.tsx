// @vitest-environment jsdom
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CommentMentions } from '../../../src/components/embedded/CommentMentions';
vi.mock('../../../src/components/embedded/host-viewer', () => ({ useEmbeddedMentionBots: () => [{ id: 'chief', name: 'Chief' }] }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function Composer({ initial = '@Ch' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return <CommentMentions value={value} onChange={setValue}><textarea aria-label="Note" value={value} onChange={event => setValue(event.target.value)} /></CommentMentions>;
}
it('does not restore an obsolete mention caret after subsequent native input', () => {
  const frames: FrameRequestCallback[] = [];
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frames.push(callback); return frames.length; });
  render(<Composer />);
  const input = screen.getByRole('textbox', { name: 'Note' }) as HTMLTextAreaElement;
  input.focus();
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(input).toHaveValue('@Chief ');
  fireEvent.input(input, { target: { value: '@Chief please', selectionStart: 13, selectionEnd: 13 } });
  expect(input).toHaveValue('@Chief please');
  act(() => { for (const callback of frames.splice(0)) callback(0); });
  expect(input.selectionStart).toBe(13); expect(input.selectionEnd).toBe(13);
});

it('places the committed mention caret before an existing suffix without discarding it', () => {
  render(<Composer initial="@Ch suffix" />);
  const input = screen.getByRole('textbox', { name: 'Note' }) as HTMLTextAreaElement;
  input.focus(); input.setSelectionRange(3, 3); fireEvent.select(input);
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(input).toHaveValue('@Chief  suffix');
  expect(input).toHaveFocus(); expect(input.selectionStart).toBe(7); expect(input.selectionEnd).toBe(7);
});
it('does not accept a mention during composition', () => {
  render(<Composer />);
  const input = screen.getByRole('textbox', { name: 'Note' });
  fireEvent.compositionStart(input); fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
  expect(input).toHaveValue('@Ch');
  fireEvent.compositionEnd(input); fireEvent.keyDown(input, { key: 'Enter' });
  expect(input).toHaveValue('@Chief ');
});
