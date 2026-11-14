import { afterEach, expect, it, vi } from 'vitest';
import { createSourceDeleteHistoryFixture, sourceDeleteScope } from '../helpers/workbook-source-delete-fixture';
import { workbookVisibilityBridge } from '../../src/components/embedded/workbook/grid-visibility';
import { workbookMembershipVisibilitySchema } from '@open-design/contracts/runtime/workbook';

afterEach(() => vi.unstubAllGlobals());
it('refuses an incoherent live name instead of posting an invalid host worksheet list', async () => {
  const f = createSourceDeleteHistoryFixture(true), postMessage = vi.fn(), addEventListener = vi.fn(), removeEventListener = vi.fn();
  vi.stubGlobal('window', { parent: { postMessage }, location: { origin: 'http://fixture.invalid' }, addEventListener, removeEventListener });
  const malformed = f.book.save();
  delete malformed.sheets['1']!.name;
  try {
    expect(() => workbookVisibilityBridge(f.univer, f.api, () => f.source.model, () => ({
      projectId: sourceDeleteScope.projectId, controllerId: '22222222-2222-4222-8222-222222222222', sourceSha256: 'a'.repeat(64), blocked: false,
    }), { snapshot: () => malformed, decorate: value => value, receive() {} })).toThrow('The live worksheet list is inconsistent.');
    expect(postMessage).not.toHaveBeenCalled();
    expect(removeEventListener).toHaveBeenCalledWith('message', addEventListener.mock.calls[0]![1]);
  } finally { await f.close(); }
});
it('publishes the privately owned live unsaved list through Rename, Delete and Undo rather than the stale source model', async () => {
  const f = createSourceDeleteHistoryFixture(true), postMessage = vi.fn();
  vi.stubGlobal('window', { parent: { postMessage }, location: { origin: 'http://fixture.invalid' }, addEventListener() {}, removeEventListener() {} });
  const scope = { projectId: sourceDeleteScope.projectId, controllerId: '22222222-2222-4222-8222-222222222222', sourceSha256: 'a'.repeat(64), blocked: false };
  const bridge = workbookVisibilityBridge(f.univer, f.api, () => f.source.model, () => scope, {
    snapshot: () => f.controller!.inspectManagement()?.snapshot ?? null,
    decorate: value => value,
    receive: async () => {},
  });
  const published = () => workbookMembershipVisibilitySchema.parse(postMessage.mock.lastCall![0]);
  try {
    await f.controller!.add('Notes', 3); await f.controller!.rename('4', 'Research'); bridge.publish();
    expect(published().sheets.map(sheet => [sheet.id, sheet.name])).toEqual([['1','Sheet 1'],['2','Sheet 2'],['3','Sheet 3'],['4','Research']]);
    expect(f.source.model.sheets).toHaveLength(3);
    await f.controller!.remove('4'); bridge.publish(); expect(published().sheets).toHaveLength(3);
    await f.api.undo(); bridge.publish(); expect(published().sheets.at(-1)).toMatchObject({ id: '4', name: 'Research' });
  } finally { bridge.dispose(); await f.close(); }
});
