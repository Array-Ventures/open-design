// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { InspectorResizeHandle } from '../../../src/components/embedded/InspectorResizeHandle';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it.each(['ltr', 'rtl'])('resizes with logical keyboard direction and bounded endpoints in %s', direction => {
  const onResize = vi.fn();
  render(<InspectorResizeHandle width={320} maximum={560} label="Properties width" onResize={onResize} />);
  const separator = screen.getByRole('separator');
  separator.style.direction = direction;
  fireEvent.keyDown(separator, { key: direction === 'rtl' ? 'ArrowRight' : 'ArrowLeft' });
  expect(onResize).toHaveBeenLastCalledWith(336);
  fireEvent.keyDown(separator, { key: 'Home' });
  expect(onResize).toHaveBeenLastCalledWith(288);
  fireEvent.keyDown(separator, { key: 'End' });
  expect(onResize).toHaveBeenLastCalledWith(560);
});
it('reports a constrained rendered width without persisting layout changes', () => {
  const onResize = vi.fn();
  const { rerender } = render(<InspectorResizeHandle width={320} maximum={560} label="Properties width" onResize={onResize} />);
  rerender(<InspectorResizeHandle width={300} maximum={300} label="Properties width" onResize={onResize} />);
  expect(screen.getByRole('separator').getAttribute('aria-valuenow')).toBe('300');
  expect(onResize).not.toHaveBeenCalled();
});
