// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ThumbnailRailResize } from '../../../src/components/embedded/ThumbnailRailResize';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('does not overwrite the preferred width when a temporary layout is narrower', () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(200);
  const onResize = vi.fn();
  render(<div><ThumbnailRailResize width={194} defaultWidth={194} collapsed={false} onResize={onResize}>Slides</ThumbnailRailResize></div>);
  expect(onResize).not.toHaveBeenCalled();
});

it('still persists an explicit keyboard resize', () => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
  const onResize = vi.fn();
  render(<div><ThumbnailRailResize width={194} defaultWidth={194} collapsed={false} onResize={onResize}>Slides</ThumbnailRailResize></div>);
  fireEvent.keyDown(screen.getByRole('separator', { name: 'Resize slide thumbnails' }), { key: 'ArrowRight' });
  expect(onResize).toHaveBeenCalledExactlyOnceWith(202);
});
