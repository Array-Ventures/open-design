// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { guardLongPressCompletion } from '../../src/components/embedded/boardui/long-press-completion';
afterEach(() => { vi.useRealTimers(); document.body.replaceChildren(); });
function fixture() {
  const boundary = document.createElement('div'), target = document.createElement('button'), other = document.createElement('button');
  boundary.append(target, other); document.body.append(boundary);
  const completion = guardLongPressCompletion(boundary, target, { x: 40, y: 50 }, 7);
  const dispatch = (type: string, node = target, fields = {}) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, detail: 1, clientX: 40, clientY: 50, ...fields }); node.dispatchEvent(event); return event;
  };
  return { boundary, target, other, completion, dispatch };
}
it('prevents only the originating compatibility mousedown and click, then releases its listeners', () => {
  const { completion, dispatch } = fixture();
  completion.release(7);
  expect(dispatch('mousedown').defaultPrevented).toBe(true);
  expect(dispatch('click').defaultPrevented).toBe(true);
  expect(dispatch('mousedown').defaultPrevented).toBe(false);
});
it('leaves another target, another point and keyboard-generated mouse events untouched', () => {
  const { completion, target, other, dispatch } = fixture();
  expect(dispatch('mousedown', other).defaultPrevented).toBe(false);
  expect(dispatch('mousedown', target, { clientX: 70 }).defaultPrevented).toBe(false);
  expect(dispatch('mousedown', target, { detail: 0 }).defaultPrevented).toBe(false);
  expect(dispatch('click', target, { detail: 0 }).defaultPrevented).toBe(false);
  completion.dispose();
});
it('does not consume a standalone click without the compatibility mousedown', () => {
  const { dispatch } = fixture(); expect(dispatch('click').defaultPrevented).toBe(false);
});
it('expires after the matching pointer release and leaves future ordinary clicks alone', () => {
  vi.useFakeTimers(); const { completion, dispatch } = fixture();
  completion.release(8); vi.advanceTimersByTime(100); expect(dispatch('mousedown').defaultPrevented).toBe(true);
  completion.release(7); vi.advanceTimersByTime(100); expect(dispatch('mousedown').defaultPrevented).toBe(false);
});
it('releases on disposal or when the original target is no longer owned', () => {
  const { completion, target, boundary, dispatch } = fixture();
  target.remove(); document.body.append(target); expect(dispatch('mousedown').defaultPrevented).toBe(false);
  boundary.append(target); completion.dispose(); expect(dispatch('mousedown').defaultPrevented).toBe(false);
});
