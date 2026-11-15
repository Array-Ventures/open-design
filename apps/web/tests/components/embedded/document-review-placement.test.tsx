// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createEditor, $getSelection } from 'lexical';
import { useRef } from 'react';
import { useDocumentCommentPlacement } from '../../../src/components/embedded/document/useDocumentCommentPlacement';
const editor = createEditor({ namespace: 'placement', onError: error => { throw error; } });
let scrollBounds = { left: 0, width: 804 };
let rtl = false;
let canvasWidth = 1140;
let anchorLeft = 450;
let resize: () => void;
const observed = new Set<Element>();
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.documentElement.removeAttribute('dir'); observed.clear(); rtl = false; canvasWidth = 1140; anchorLeft = 450; scrollBounds = { left: 0, width: 804 }; });
function fixture() {
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback; }
    observe(element: Element) { observed.add(element); }
    disconnect() {}
  });
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { callback(0); return 1; });
  vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockImplementation(function (this: HTMLElement) { return this.parentElement; });
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const name = this.getAttribute('data-testid');
    if (name === 'scroll') return new DOMRect(scrollBounds.left, 0, scrollBounds.width, 600);
    return new DOMRect(0, 0, name === 'card' ? 320 : canvasWidth, name === 'card' ? 160 : 600);
  });
  const selection = document.createRange();
  selection.getClientRects = () => [new DOMRect(anchorLeft, 100, 40, 20)] as unknown as DOMRectList;
  const range = () => selection;
  function Surface() {
    const scroll = useRef<HTMLDivElement>(null);
    const placement = useDocumentCommentPlacement(editor, null, true, 0, 320, range, scroll);
    return <div data-testid="canvas" style={{ direction: rtl ? 'rtl' : 'ltr' }}><div ref={scroll} data-testid="scroll">Unchanged paragraph</div><aside ref={placement.card} data-testid="card" style={{ width: 320, ...placement.style }} /></div>;
  }
  render(<Surface />);
}
it.each([false, true])('places the review in the actual reserved gutter without overlapping content (RTL=%s)', async direction => {
  rtl = direction; scrollBounds = direction ? { left: 336, width: 804 } : { left: 0, width: 804 };
  const before = editor.getEditorState().toJSON();
  const selection = editor.getEditorState().read($getSelection);
  const nativeRanges = window.getSelection()?.rangeCount;
  fixture();
  const card = screen.getByTestId('card');
  await waitFor(() => expect(card.style.getPropertyValue('--document-comment-left')).toBe(direction ? '8px' : '812px'));
  const left = parseFloat(card.style.getPropertyValue('--document-comment-left'));
  expect(direction ? left + 320 <= scrollBounds.left : left >= scrollBounds.left + scrollBounds.width).toBe(true);
  expect(left).toBeGreaterThanOrEqual(0); expect(left + 320).toBeLessThanOrEqual(1140);
  expect(editor.getEditorState().toJSON()).toEqual(before);
  expect(editor.getEditorState().read($getSelection)).toBe(selection);
  expect(window.getSelection()?.rangeCount).toBe(nativeRanges);
  expect(screen.getByTestId('scroll').textContent).toBe('Unchanged paragraph');
});
it('remeasures when opening the card reserves scroll space without resizing its parent', async () => {
  scrollBounds = { left: 0, width: 1140 }; fixture();
  expect(observed.has(screen.getByTestId('scroll'))).toBe(true);
  scrollBounds = { left: 0, width: 804 };
  act(() => resize());
  await waitFor(() => expect(screen.getByTestId('card').style.getPropertyValue('--document-comment-left')).toBe('812px'));
});

it('keeps the bounded narrow overlay when no real gutter fits', async () => {
  canvasWidth = 390; scrollBounds = { left: 0, width: 390 }; anchorLeft = 80;
  fixture();
  await waitFor(() => expect(screen.getByTestId('card').style.getPropertyValue('--document-comment-left')).toBe('58px'));
  expect(screen.getByTestId('card').style.getPropertyValue('--document-comment-top')).toBe('132px');
});

it('moves to the logical end gutter when the host locale direction changes', async () => {
  fixture();
  expect(screen.getByTestId('card').style.getPropertyValue('--document-comment-left')).toBe('812px');
  scrollBounds = { left: 336, width: 804 };
  act(() => { screen.getByTestId('scroll').style.direction = 'rtl'; document.documentElement.dir = 'rtl'; });
  await waitFor(() => expect(screen.getByTestId('card').style.getPropertyValue('--document-comment-left')).toBe('8px'));
});
