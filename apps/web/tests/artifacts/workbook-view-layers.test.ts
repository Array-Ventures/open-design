// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { WorkbookViewLayers } from '../../src/components/embedded/workbook/grid-view-layers';

it('releases every owned resource exactly once when a retained canvas is replaced', () => {
  const host = document.createElement('div'), views = new WorkbookViewLayers(host), first = views.begin(), disposed: string[] = [];
  first.own(() => disposed.push('kernel')); first.own(() => disposed.push('navigation')); first.show(); first.retire();
  expect(disposed).toEqual([]); // the last rendered canvas remains available
  const second = views.begin(); second.show();
  expect(disposed).toEqual(['navigation', 'kernel']); expect(first.element.parentElement).toBeNull();
  first.retire(); views.dispose(); expect(disposed).toEqual(['navigation', 'kernel']);
});
it('releases earlier resources even when a later disposer fails', () => {
  const views = new WorkbookViewLayers(document.createElement('div')), layer = views.begin(), kernel = vi.fn();
  layer.own(kernel); layer.own(() => { throw Error('Shortcut cleanup failed'); });
  expect(() => layer.retire()).toThrow('Shortcut cleanup failed'); expect(kernel).toHaveBeenCalledOnce();
  views.dispose(); expect(kernel).toHaveBeenCalledOnce();
});
it('releases every partial initialization resource when the surface closes', () => {
  const views = new WorkbookViewLayers(document.createElement('div')), layer = views.begin(), kernel = vi.fn(), navigation = vi.fn();
  layer.own(kernel); layer.own(navigation); views.dispose(); views.dispose();
  expect(kernel).toHaveBeenCalledOnce(); expect(navigation).toHaveBeenCalledOnce();
});

it('releases a late resource immediately when its layer already retired', () => {
  const views = new WorkbookViewLayers(document.createElement('div')), layer = views.begin(), resource = vi.fn();
  layer.retire(); layer.own(resource); views.dispose(); expect(resource).toHaveBeenCalledOnce();
});
