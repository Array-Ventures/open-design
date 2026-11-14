import { expect, it } from 'vitest';
import { workbookMembershipBridge, type WorkbookMembershipBridgeState } from '../../src/components/embedded/workbook/grid-membership-bridge';
import { workbookMembershipActionSchema, workbookMembershipVisibilitySchema, type WorkbookMembershipAction } from '@open-design/contracts/runtime/workbook';

const projectId = '11111111-1111-4111-8111-111111111111', controllerId = '22222222-2222-4222-8222-222222222222', ownerId = '33333333-3333-4333-8333-333333333333';
function fixture(execute: Parameters<typeof workbookMembershipBridge>[0]['execute'] = async () => {}) {
  let state: WorkbookMembershipBridgeState | null = { lifetime: {}, ownerId, historyRevision: 1, busy: false, canAdd: true,
    sheets: [{ id: '1', canRename: true, canDelete: true }, { id: '2', canRename: true, canDelete: true }],
    visibility: { type: 'studio:workbook-visibility-state', projectId, controllerId, sourceSha256: 'a'.repeat(64), editable: true, activeSheetId: '1', error: null,
      sheets: [{ id: '1', name: 'Inputs', visibility: 'visible', canHide: true }, { id: '2', name: 'Summary', visibility: 'visible', canHide: true }] } };
  const messages: Record<string, unknown>[] = [], stamps: unknown[] = [];
  let calls = 0, duringPublish: (() => void) | undefined;
  const parent = { postMessage: (value: Record<string, unknown>, origin: string) => { expect(origin).toBe('http://localhost:6261'); messages.push(structuredClone(value)); } } as unknown as Window;
  const options = { parentWindow: parent, origin: 'http://localhost:6261', getState: () => state,
    publish: () => { duringPublish?.(); if (state) messages.push(bridge.decorate(state.visibility) as unknown as Record<string, unknown>); },
    execute: async (action: WorkbookMembershipAction['action'], stamp: Parameters<typeof execute>[1]) => { calls++; stamps.push(stamp); await execute(action, stamp); } };
  const bridge = workbookMembershipBridge(options);
  const send = (data: unknown, source: MessageEventSource | null = parent, origin = options.origin) => bridge.receive({ data, source, origin });
  const negotiate = () => send({ type: 'studio:artifact-request', projectId, controllerId, workbookMembershipVersion: 1 });
  const view = () => workbookMembershipVisibilitySchema.parse(bridge.decorate(state!.visibility));
  const request = (action: WorkbookMembershipAction['action'] = { kind: 'add', name: 'New' }, requestId = crypto.randomUUID()) => {
    const value = view(); return workbookMembershipActionSchema.parse({ type: 'studio:workbook-membership', projectId, controllerId, sourceSha256: value.sourceSha256, ownerId: value.membership!.ownerId, revision: value.membership!.revision, requestId, action });
  };
  return { bridge, send, negotiate, view, request, messages, stamps, get calls() { return calls; }, get state(): WorkbookMembershipBridgeState { return state!; }, set state(next: WorkbookMembershipBridgeState) { state = next; }, clearState() { state = null; }, set duringPublish(next: (() => void) | undefined) { duringPublish = next; } };
}
it('stays legacy until exact-parent same-origin version/controller negotiation and never independently publishes', async () => {
  const f = fixture(); expect(f.view().membership).toBeUndefined(); expect(f.messages).toEqual([]);
  const negotiation = { type: 'studio:artifact-request', projectId, controllerId, workbookMembershipVersion: 1 };
  await f.send(negotiation, null); await f.send(negotiation, undefined, 'https://foreign.test'); await f.send({ ...negotiation, controllerId: ownerId });
  expect(f.messages).toEqual([]); expect(f.view().membership).toBeUndefined();
  await f.negotiate(); expect(f.view().membership?.ownerId).toBe(ownerId); expect(f.calls).toBe(0);
});
it('holds original active ID through changed SDK state and posts original-ticket result before final idle', async () => {
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const f = fixture(async (_action, stamp) => {
    expect(stamp.lifetime).toBe(f.state.lifetime); expect(Object.isFrozen(stamp)).toBe(true);
    f.state = { ...f.state, historyRevision: 2, visibility: { ...f.state.visibility, sheets: f.state.visibility.sheets.map(sheet => sheet.id === '2' ? { ...sheet, name: 'Renamed' } : sheet) } };
    f.messages.push(f.bridge.decorate(f.state.visibility) as unknown as Record<string, unknown>); await gate;
  });
  await f.negotiate(); const request = f.request({ kind: 'rename', sheetId: '2', name: 'Renamed' });
  const work = f.send(request); await Promise.resolve();
  expect(f.view().membership).toMatchObject({ activeRequestId: request.requestId, busy: true });
  expect(f.view().membership!.revision).toBeGreaterThan(request.revision);
  release(); await work;
  const resultIndex = f.messages.findIndex(value => value.type === 'studio:workbook-membership-result');
  expect(f.messages[resultIndex]).toMatchObject({ state: 'applied', revision: request.revision, requestId: request.requestId });
  expect(f.messages[resultIndex - 1]!.membership).toMatchObject({ activeRequestId: request.requestId, busy: true });
  expect(f.messages[resultIndex + 1]!.membership).toMatchObject({ activeRequestId: null, busy: false });
});
it('coalesces exact in-flight duplicates and refuses changed payload with the same UUID', async () => {
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const f = fixture(async () => gate); await f.negotiate(); const request = f.request();
  const first = f.send(request), duplicate = f.send(request);
  await f.send({ ...request, action: { kind: 'add', name: 'Different' } }); expect(f.calls).toBe(1);
  release(); await Promise.all([first, duplicate]); await f.send(request); expect(f.calls).toBe(1);
  expect(f.messages.at(-1)).toMatchObject({ state: 'applied', requestId: request.requestId });
});
it('consumes failed no-effect tickets without a permanent action ceiling or executable cache eviction', async () => {
  const f = fixture(); await f.negotiate(); const original = f.request({ kind: 'add', name: 'Inputs' });
  await f.send(original);
  for (let index = 0; index < 80; index++) await f.send(f.request({ kind: 'add', name: 'Inputs' }));
  expect(f.calls).toBe(0); expect(f.view().membership!.revision).toBeGreaterThan(80);
  await f.send(original); expect(f.messages.at(-1)).toMatchObject({ state: 'rejected', error: 'changed' }); expect(f.calls).toBe(0);
});
it('rejects stale/private-source/capability withdrawal and malformed names without invoking the executor', async () => {
  const f = fixture(); await f.negotiate(); const old = f.request();
  f.state = { ...f.state, historyRevision: 2, canAdd: false }; await f.send(old);
  expect(f.messages.at(-1)).toMatchObject({ error: 'changed' });
  await f.send(f.request()); expect(f.messages.at(-2)).toMatchObject({ error: 'not-allowed' });
  await f.send({ ...f.request(), action: { kind: 'add', name: 'Bad/name' } });
  await f.send({ ...f.request(), sourceSha256: 'b'.repeat(64) });
  expect(f.calls).toBe(0);
});
it('rechecks the captured private owner after reservation publication before calling the executor', async () => {
  const f = fixture(); await f.negotiate(); const request = f.request();
  let changed = false; f.duringPublish = () => { if (!changed) { changed = true; f.state = { ...f.state, historyRevision: 2 }; } };
  await f.send(request); expect(f.calls).toBe(0); expect(f.messages.find(value => value.type === 'studio:workbook-membership-result')).toMatchObject({ error: 'changed' });
});
it.each(['absent', 'different-source'])('does not revive a ticket after observed %s withdrawal and restoration', async withdrawal => {
  const f = fixture(); await f.negotiate(); const original = f.request(), state = f.state;
  if (withdrawal === 'absent') { f.clearState(); expect(f.bridge.decorate(state.visibility).membership).toBeUndefined(); }
  else { f.state = { ...state, visibility: { ...state.visibility, sourceSha256: 'b'.repeat(64) } }; expect(f.view().sourceSha256).toBe('b'.repeat(64)); }
  f.state = state; await f.send(original); expect(f.calls).toBe(0); expect(f.messages.at(-1)).toMatchObject({ error: 'changed' });
});
it.each(['owner', 'source'])('retires old result ownership when a new private %s replaces a pending executor', async change => {
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const f = fixture(async () => gate); await f.negotiate(); const request = f.request(); const work = f.send(request);
  f.state = change === 'owner' ? { ...f.state, lifetime: {}, ownerId: '44444444-4444-4444-8444-444444444444' } : { ...f.state, visibility: { ...f.state.visibility, sourceSha256: 'b'.repeat(64) } };
  expect(f.view().membership).toMatchObject({ ownerId: f.state.ownerId, activeRequestId: null });
  release(); await work; expect(f.messages.some(value => value.type === 'studio:workbook-membership-result')).toBe(false);
});
it('maps executor failures to finite errors, consumes the ticket and does not expose exception text', async () => {
  const f = fixture(async () => { throw Error('/private/secret stack'); }); await f.negotiate(); const request = f.request();
  await f.send(request); await f.send(request); expect(f.calls).toBe(1);
  expect(f.messages.at(-1)).toMatchObject({ error: 'failed' }); expect(JSON.stringify(f.messages)).not.toContain('/private');
});
it('stops replies and publications after disposal, including an already pending executor', async () => {
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const f = fixture(async () => gate); await f.negotiate(); const work = f.send(f.request());
  f.bridge.dispose(); const count = f.messages.length; release(); await work; await f.negotiate();
  expect(f.messages).toHaveLength(count);
});

it('requires exact parent and origin for actions as well as negotiation', async () => {
  const f = fixture(); await f.negotiate(); const request = f.request();
  await f.send(request, null); await f.send(request, undefined, 'https://foreign.test');
  await f.send({ ...request, projectId: controllerId }); await f.send({ ...request, controllerId: ownerId }); await f.send({ ...request, ownerId: controllerId });
  expect(f.calls).toBe(0); await f.send(request); expect(f.calls).toBe(1);
});

it('keeps unchanged publication tickets stable and advances on a coherent capability change', async () => {
  const f = fixture(); await f.negotiate(); const revision = f.view().membership!.revision;
  expect(f.view().membership!.revision).toBe(revision); expect(f.view().membership!.revision).toBe(revision);
  f.state = { ...f.state, canAdd: false }; expect(f.view().membership!.revision).toBeGreaterThan(revision);
});

it('settles a reservation-publication failure without executing or exposing the exception', async () => {
  const f = fixture(); await f.negotiate(); const request = f.request();
  f.duringPublish = () => { f.duringPublish = undefined; throw Error('/private/publication'); };
  await f.send(request); expect(f.calls).toBe(0);
  expect(f.messages.find(value => value.type === 'studio:workbook-membership-result')).toMatchObject({ state: 'rejected', error: 'failed' });
  expect(f.view().membership).toMatchObject({ busy: false, activeRequestId: null });
  expect(f.view().membership!.revision).toBeGreaterThan(request.revision);
  await f.send(request); expect(f.calls).toBe(0); expect(JSON.stringify(f.messages)).not.toContain('/private');
});
it('never invokes an executor if first reservation publication synchronously disposes the bridge', async () => {
  const f = fixture(); await f.negotiate(); const request = f.request();
  f.duringPublish = () => { f.duringPublish = undefined; f.bridge.dispose(); };
  await f.send(request); expect(f.calls).toBe(0);
  expect(f.messages.some(value => value.type === 'studio:workbook-membership-result')).toBe(false);
});

it('retires incoherent private state after reservation without an executable stale ticket', async () => {
  const f = fixture(); await f.negotiate(); const request = f.request();
  f.duringPublish = () => { f.duringPublish = undefined; f.state = { ...f.state, historyRevision: -1 }; };
  await f.send(request); expect(f.calls).toBe(0);
  expect(f.messages.find(value => value.type === 'studio:workbook-membership-result')).toMatchObject({ error: 'failed' });
  expect(f.bridge.decorate(f.state.visibility).membership).toBeUndefined();
  f.state = { ...f.state, historyRevision: 1 }; await f.send(request); expect(f.calls).toBe(0);
});
