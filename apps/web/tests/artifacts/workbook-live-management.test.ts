import { afterEach, expect, it, vi } from 'vitest';
import { workbookMembershipVisibilitySchema, workbookMembershipActionSchema } from '@open-design/contracts/runtime/workbook';
import { createSourceDeleteHistoryFixture, sourceDeleteScope } from '../helpers/workbook-source-delete-fixture';
import { workbookMembershipExecutor, publishWorkbookMembershipHistory } from '../../src/components/embedded/workbook/grid-membership-executor';
import { workbookMembershipBridge } from '../../src/components/embedded/workbook/grid-membership-bridge';
import { workbookVisibilityBridge } from '../../src/components/embedded/workbook/grid-visibility';

afterEach(() => vi.unstubAllGlobals());
const origin = 'http://fixture.invalid';
const controllerId = '22222222-2222-4222-8222-222222222222';
const ownerId = '33333333-3333-4333-8333-333333333333';

it('routes negotiated host Add, Rename and Delete into the real private SDK controller and publishes live Undo', async () => {
  const f = createSourceDeleteHistoryFixture(true), postMessage = vi.fn(), listeners = new Set<(event: MessageEvent) => void>();
  f.source.model.worksheetVisibilityEditable = true;
  const parent = { postMessage };
  vi.stubGlobal('window', { parent, location: { origin }, addEventListener: (_: string, handler: (event: MessageEvent) => void) => listeners.add(handler), removeEventListener: (_: string, handler: (event: MessageEvent) => void) => listeners.delete(handler) });
  const scope = { projectId: sourceDeleteScope.projectId, controllerId, sourceSha256: f.source.sourceSha256, blocked: false };
  let publisher: ReturnType<typeof workbookVisibilityBridge> | undefined;
  const executor = workbookMembershipExecutor(ownerId, () => publisher ? {
    controller: f.controller!, visibility: publisher.state()!, scope, sourceSha256: f.source.sourceSha256,
    current: true, writerCurrent: true, calculationReady: true, ready: true, editable: true, canEdit: true,
  } : null);
  const management = workbookMembershipBridge({ parentWindow: parent, origin, getScope: () => scope, ...executor, publish: () => publisher?.publish() });
  const event = (data: unknown) => ({ source: parent, origin, data }) as unknown as MessageEvent;
  // A real early request arrives before the existing visibility publisher.
  await management.receive(event({ type: 'studio:artifact-request', projectId: scope.projectId, controllerId, workbookMembershipVersion: 1 }));
  let pending: Promise<void> | undefined;
  publisher = workbookVisibilityBridge(f.univer, f.api, () => f.source.model, () => scope, {
    snapshot: () => f.controller!.inspectManagement()?.snapshot ?? null,
    decorate: management.decorate, receive: packet => { pending = management.receive(packet); },
  });
  const historyPublication = publishWorkbookMembershipHistory(f.univer, () => true, () => publisher!.publish());
  const published = () => workbookMembershipVisibilitySchema.parse(postMessage.mock.calls.filter(call => call[0].type === 'studio:workbook-visibility-state').at(-1)![0]);
  const send = async (action: { kind: 'add'; name: string } | { kind: 'rename'; sheetId: string; name: string } | { kind: 'delete'; sheetId: string }) => {
    const state = published(); expect(state.membership).toBeDefined();
    const request = workbookMembershipActionSchema.parse({ type: 'studio:workbook-membership', projectId: scope.projectId, controllerId,
      sourceSha256: scope.sourceSha256, ownerId, revision: state.membership!.revision, requestId: crypto.randomUUID(), action });
    const packet = event(request);
    for (const listener of listeners) listener(packet);
    await pending;
    expect(postMessage.mock.calls.filter(call => call[0].type === 'studio:workbook-membership-result').at(-1)![0]).toMatchObject({ requestId: request.requestId, state: 'applied', error: null });
  };
  try {
    publisher.publish();
    const beforeEdit = published().membership!.revision;
    f.book.getActiveSheet().getRange(0, 0).setValue('Typed before Add');
    expect(published().membership!.revision).toBeGreaterThan(beforeEdit);
    await send({ kind: 'add', name: 'Notes' });
    expect(published().sheets.at(-1)).toMatchObject({ id: '4', name: 'Notes' });
    await send({ kind: 'rename', sheetId: '4', name: 'Research' });
    expect(published().sheets.at(-1)?.name).toBe('Research');
    await send({ kind: 'delete', sheetId: '4' });
    expect(published().sheets).toHaveLength(3);
    await f.api.undo();
    expect(published().sheets.at(-1)).toMatchObject({ id: '4', name: 'Research' });
    expect(published().membership).toMatchObject({ busy: false, canAdd: true });
    expect(f.source.model.sheets).toHaveLength(3);
    expect(listeners.size).toBe(1);
  } finally { historyPublication.dispose(); publisher.dispose(); management.dispose(); await f.close(); }
  expect(listeners.size).toBe(0);
});

it('independently rejects stale history, source, owner, scope, permission and readiness before any SDK mutation', async () => {
  const f = createSourceDeleteHistoryFixture(true);
  const scope = { projectId: sourceDeleteScope.projectId, controllerId, blocked: false, saving: false };
  const visibility = { type: 'studio:workbook-visibility-state' as const, ...scope, sourceSha256: f.source.sourceSha256,
    editable: true, activeSheetId: '1', error: null,
    sheets: f.source.model.sheets.map(sheet => ({ id: sheet.id, name: sheet.name, visibility: 'visible' as const, canHide: true })) };
  const context = { controller: f.controller!, visibility, scope, sourceSha256: f.source.sourceSha256,
    current: true, writerCurrent: true, calculationReady: true, ready: true, editable: true, canEdit: true };
  const executor = workbookMembershipExecutor(ownerId, () => context);
  const stamp = () => ({ projectId: scope.projectId, controllerId, sourceSha256: f.source.sourceSha256,
    ownerId, lifetime: f.controller!, historyRevision: f.controller!.inspectManagement()!.historyRevision });
  try {
    const before = f.book.save();
    for (const key of ['current', 'writerCurrent', 'calculationReady', 'ready', 'editable', 'canEdit'] as const) {
      context[key] = false;
      expect(executor.getState()).toBeNull();
      await expect(executor.execute({ kind: 'add', name: 'Denied' }, stamp())).rejects.toThrow();
      context[key] = true;
    }
    for (const key of ['blocked', 'saving'] as const) {
      scope[key] = true;
      expect(executor.getState()?.canAdd).toBe(false);
      await expect(executor.execute({ kind: 'add', name: 'Denied' }, stamp())).rejects.toThrow();
      scope[key] = false;
    }
    for (const change of [{ historyRevision: stamp().historyRevision + 1 }, { sourceSha256: 'b'.repeat(64) }, { ownerId: crypto.randomUUID() }, { lifetime: {} }, { projectId: crypto.randomUUID() }, { controllerId: crypto.randomUUID() }]) {
      await expect(executor.execute({ kind: 'add', name: 'Denied' }, { ...stamp(), ...change })).rejects.toThrow();
    }
    expect(f.book.save()).toEqual(before);
    const old = stamp();
    await executor.execute({ kind: 'add', name: 'Accepted' }, old);
    await expect(executor.execute({ kind: 'add', name: 'Stale' }, old)).rejects.toThrow();
    expect(f.book.save().sheetOrder).toHaveLength(4);
  } finally { await f.close(); }
});
