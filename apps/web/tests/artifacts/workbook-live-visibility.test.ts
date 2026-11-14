import { afterEach, expect, it, vi } from 'vitest';
import { createSourceDeleteHistoryFixture, sourceDeleteScope } from '../helpers/workbook-source-delete-fixture';
import { workbookVisibilityBridge } from '../../src/components/embedded/workbook/grid-visibility';
import { workbookMembershipVisibilitySchema, workbookMembershipReadySchema } from '@open-design/contracts/runtime/workbook';
import { workbookMembershipBridge } from '../../src/components/embedded/workbook/grid-membership-bridge';

afterEach(() => vi.unstubAllGlobals());
it('makes a retired publisher inert when a late callback sees a replacement scope', async () => {
  const f = createSourceDeleteHistoryFixture(true), postMessage = vi.fn();
  vi.stubGlobal('window', { parent: { postMessage }, location: { origin: 'http://fixture.invalid' }, addEventListener() {}, removeEventListener() {} });
  let scope = { projectId: sourceDeleteScope.projectId, controllerId: '22222222-2222-4222-8222-222222222222', sourceSha256: 'a'.repeat(64), blocked: false };
  const bridge = workbookVisibilityBridge(f.univer, f.api, () => f.source.model, () => scope);
  try {
    expect(postMessage).toHaveBeenCalledTimes(1);
    bridge.dispose();
    scope = { ...scope, projectId: crypto.randomUUID(), controllerId: crypto.randomUUID() };
    bridge.publish(); bridge.publish();
    expect(bridge.state()).toBeNull();
    expect(postMessage).toHaveBeenCalledTimes(1);
  } finally { bridge.dispose(); await f.close(); }
});
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

it('routes a correlated late probe through the sole installed visibility listener without granting execution', async () => {
  const f = createSourceDeleteHistoryFixture(true), postMessage = vi.fn(), listeners = new Set<(event: MessageEvent) => void>();
  const parent = { postMessage }, origin = 'http://fixture.invalid';
  vi.stubGlobal('window', { parent, location: { origin }, addEventListener: (_: string, handler: (event: MessageEvent) => void) => listeners.add(handler), removeEventListener: (_: string, handler: (event: MessageEvent) => void) => listeners.delete(handler) });
  const scope = { projectId: sourceDeleteScope.projectId, controllerId: '22222222-2222-4222-8222-222222222222', sourceSha256: 'a'.repeat(64), blocked: true };
  const execute = vi.fn(async () => {}), pending: Promise<void>[] = [];
  const management = workbookMembershipBridge({ parentWindow: parent, origin, getScope: () => scope, getState: () => null, execute, publish() {} });
  const publisher = workbookVisibilityBridge(f.univer, f.api, () => f.source.model, () => scope, {
    snapshot: () => null, decorate: management.decorate, receive: event => { pending.push(management.receive(event)); },
  });
  const before = f.book.save();
  const probe = { type: 'studio:workbook-membership-probe', version: 1, projectId: scope.projectId, controllerId: scope.controllerId, handshakeId: crypto.randomUUID() };
  const dispatch = async (data: unknown, source: unknown = parent, from = origin) => {
    for (const listener of listeners) listener({ data, source, origin: from } as MessageEvent);
    await Promise.all(pending.splice(0));
  };
  const replies = () => postMessage.mock.calls.filter(call => call[0]?.type === 'studio:workbook-membership-ready');
  try {
    // There is no early Grid listener here: exercise the one installed handoff listener.
    expect(listeners.size).toBe(1);
    await dispatch(probe);
    expect(replies()).toHaveLength(1);
    const ready = workbookMembershipReadySchema.parse(replies()[0]![0]);
    expect(ready).toMatchObject({ projectId: scope.projectId, controllerId: scope.controllerId, handshakeId: probe.handshakeId });
    for (const invalid of [{ ...probe, controllerId: crypto.randomUUID() }, { ...probe, projectId: crypto.randomUUID() }, { ...probe, version: 2 }, { ...probe, extra: true }, { ...probe, handshakeId: 'invalid' }]) await dispatch(invalid);
    await dispatch(probe, null); await dispatch(probe, parent, 'https://foreign.invalid');
    expect(replies()).toHaveLength(1);
    publisher.dispose(); await dispatch({ ...probe, handshakeId: crypto.randomUUID() });
    expect(listeners.size).toBe(0); expect(replies()).toHaveLength(1);
    expect(execute).not.toHaveBeenCalled(); expect(f.book.save()).toEqual(before);
  } finally { publisher.dispose(); management.dispose(); await f.close(); }
});
