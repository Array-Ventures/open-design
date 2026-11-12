// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import type { FUniver } from '@univerjs/presets';
import { workbookExportBridge } from '../../../src/components/embedded/workbook/grid-export';
it('publishes the actual active sheet and source binding, withdraws when blocked, and disposes its scoped listeners', () => {
  const send = vi.spyOn(window.parent, 'postMessage');
  let active = 'second'; let callback!: () => void;
  const dispose = vi.fn();
  const api = { getActiveWorkbook: () => ({ getActiveSheet: () => ({ getSheetId: () => active, getSheetName: () => active.toUpperCase() }) }), Event: { ActiveSheetChanged: 'active' }, addEvent: (_: unknown, fn: () => void) => { callback = fn; return { dispose }; } } as unknown as FUniver;
  const scope = { projectId: 'project', controllerId: 'controller', fileName: 'book.xlsx', sourceSha256: 'a'.repeat(64), blocked: false };
  const bridge = workbookExportBridge(api, () => scope);
  expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ selection: expect.objectContaining({ sheetId: 'second', sourceSha256: scope.sourceSha256 }) }), window.location.origin);
  const count = send.mock.calls.length;
  window.dispatchEvent(new MessageEvent('message', { source: window, origin: 'https://foreign.test', data: { type: 'studio:artifact-request', projectId: scope.projectId } }));
  window.dispatchEvent(new MessageEvent('message', { source: null, origin: window.location.origin, data: { type: 'studio:artifact-request', projectId: scope.projectId } }));
  window.dispatchEvent(new MessageEvent('message', { source: window, origin: window.location.origin, data: { type: 'studio:artifact-request', projectId: 'other' } }));
  expect(send.mock.calls).toHaveLength(count);
  active = 'third'; callback(); expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ selection: expect.objectContaining({ sheetId: 'third' }) }), window.location.origin);
  scope.blocked = true; bridge.publish(); expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ selection: null }), window.location.origin);
  bridge.dispose(); expect(dispose).toHaveBeenCalledOnce(); send.mockRestore();
});
