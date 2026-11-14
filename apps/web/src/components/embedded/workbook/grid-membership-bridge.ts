import { workbookMembershipActionSchema, workbookMembershipControlsRequestSchema, workbookMembershipResultSchema, workbookMembershipVisibilitySchema, workbookMembershipProbeSchema, workbookMembershipReadySchema,
  type WorkbookMembershipAction, type WorkbookMembershipResult, type WorkbookMembershipVisibility } from '@open-design/contracts/runtime/workbook';

type LegacyVisibility = Omit<WorkbookMembershipVisibility, 'membership'>;
type ErrorCode = Extract<WorkbookMembershipResult, { state: 'rejected' }>['error'];
export interface WorkbookMembershipPrivateStamp {
  readonly projectId: string; readonly controllerId: string; readonly sourceSha256: string;
  readonly ownerId: string; readonly historyRevision: number; readonly lifetime: object;
}
export interface WorkbookMembershipBridgeState {
  visibility: LegacyVisibility;
  ownerId: string;
  historyRevision: number;
  /** Actual private controller/kernel identity, never copied from a host packet. */
  lifetime: object;
  busy: boolean;
  canAdd: boolean;
  sheets: { id: string; canRename: boolean; canDelete: boolean }[];
}
interface Options {
  parentWindow: Pick<Window, 'postMessage'>;
  origin: string;
  getState(): WorkbookMembershipBridgeState | null;
  /** Trusted frame context, available before private membership readiness.
   * Version negotiation alone never supplies an executable owner. */
  getScope?(): { projectId: string; controllerId: string } | null;
  /** Calls the ONE existing visibility publisher, which invokes decorate(). */
  publish(): void;
  /** Must independently admit the captured private stamp against the current
   * controller, history, lease, source and worker. Resolution means applied. */
  execute(action: WorkbookMembershipAction['action'], stamp: WorkbookMembershipPrivateStamp): Promise<void>;
  /** Optional finite classification; exception messages are never published. */
  classifyError?(error: unknown): ErrorCode;
}
interface Current { state: WorkbookMembershipBridgeState; stamp: WorkbookMembershipPrivateStamp; fingerprint: string; revision: number }
interface Active { current: Current; request: WorkbookMembershipAction; identity: string; done: Promise<void> }
const CACHE_LIMIT = 32;
// One identity per iframe document, shared across disposable grid bridges.
// It is readiness correlation data, never a native issuer or permission.
let documentId: string | undefined;
let documentEpoch = 0;

/** Negotiated UI adapter only. No SDK command, durable issuance or independent
 * visibility publisher. The installer owns event attachment and disposal. */
export function workbookMembershipBridge(options: Options) {
  if (documentEpoch === Number.MAX_SAFE_INTEGER) throw Error('Worksheet readiness epochs are exhausted. Reopen this frame.');
  const readiness = { documentId: documentId ??= crypto.randomUUID(), epoch: ++documentEpoch };
  let announced = false;
  let disposed = false, exhausted = false, revision = 0;
  let withdrawing = false;
  let current: Current | null = null;
  let negotiated: string | null = null;
  let knownScope: string | null = null;
  let active: Active | null = null;
  const results = new Map<string, { identity: string; result: WorkbookMembershipResult }>();
  const contextKey = (scope: { projectId: string; controllerId: string }) => `${scope.projectId}:${scope.controllerId}`;
  const scopeKey = (state: WorkbookMembershipBridgeState) => contextKey(state.visibility);
  const trustedScope = () => {
    const scope = options.getScope?.();
    const checked = scope && workbookMembershipControlsRequestSchema.safeParse({
      type: 'studio:artifact-request', projectId: scope.projectId,
      controllerId: scope.controllerId, workbookMembershipVersion: 1,
    });
    const currentScope = checked?.success ? checked.data : null;
    const key = currentScope ? contextKey(currentScope) : null;
    if (key !== knownScope) { knownScope = key; negotiated = null; }
    return currentScope;
  };
  const advance = () => { if (revision === Number.MAX_SAFE_INTEGER) { exhausted = true; return; } revision++; };
  const refresh = (): Current | null => {
    if (disposed || exhausted) return null;
    const scope = options.getScope ? trustedScope() : null;
    const raw = options.getScope && !scope ? null : options.getState();
    const mismatchedScope = Boolean(raw && scope && scopeKey(raw) !== contextKey(scope));
    if (mismatchedScope) negotiated = null;
    if (!raw || mismatchedScope) { if (current) { advance(); results.clear(); } current = null; return null; }
    if (!Number.isSafeInteger(raw.historyRevision) || raw.historyRevision < 0 || !raw.lifetime || typeof raw.lifetime !== 'object') throw Error('The worksheet membership owner is invalid.');
    const visibility = workbookMembershipVisibilitySchema.parse(raw.visibility);
    if (visibility.membership) throw Error('The existing visibility publisher must not supply a second membership bundle.');
    // Validate the trusted getter's advertised capabilities before composing it.
    const checked = workbookMembershipVisibilitySchema.parse({ ...visibility, membership: { ownerId: raw.ownerId, revision: 0, busy: raw.busy, activeRequestId: null, canAdd: raw.canAdd, sheets: raw.sheets } });
    const state = { ...raw, visibility, sheets: checked.membership!.sheets };
    const fingerprint = JSON.stringify([visibility, raw.ownerId, raw.historyRevision, raw.busy, raw.canAdd, state.sheets]);
    if (!current || current.stamp.lifetime !== raw.lifetime || current.fingerprint !== fingerprint) {
      if (current) advance();
      if (!current || current.stamp.lifetime !== raw.lifetime || current.stamp.ownerId !== raw.ownerId || current.stamp.sourceSha256 !== visibility.sourceSha256 || scopeKey(current.state) !== scopeKey(state)) results.clear();
      current = { state, fingerprint, revision, stamp: Object.freeze({ projectId: visibility.projectId, controllerId: visibility.controllerId, sourceSha256: visibility.sourceSha256, ownerId: raw.ownerId, historyRevision: raw.historyRevision, lifetime: raw.lifetime }) };
    }
    return exhausted ? null : current;
  };
  const sameOwner = (a: Current, b: Current | null) => Boolean(b && a.stamp.lifetime === b.stamp.lifetime && a.stamp.ownerId === b.stamp.ownerId && a.stamp.projectId === b.stamp.projectId && a.stamp.controllerId === b.stamp.controllerId && a.stamp.sourceSha256 === b.stamp.sourceSha256);
  const post = (result: WorkbookMembershipResult) => options.parentWindow.postMessage(workbookMembershipResultSchema.parse(result), options.origin);
  const result = (request: WorkbookMembershipAction, error: ErrorCode | null): WorkbookMembershipResult => {
    const { action: _action, ...ticket } = request;
    return error ? { ...ticket, type: 'studio:workbook-membership-result', state: 'rejected', error }
      : { ...ticket, type: 'studio:workbook-membership-result', state: 'applied', error: null };
  };
  const reject = (request: WorkbookMembershipAction, error: ErrorCode) => post(result(request, error));
  const allowed = (value: Current, action: WorkbookMembershipAction['action']): ErrorCode | null => {
    const state = value.state, visibility = state.visibility;
    if (state.busy || !visibility.editable) return 'unavailable';
    const sheet = action.kind === 'add' ? null : state.sheets.find(sheet => sheet.id === action.sheetId);
    if (action.kind === 'add' ? !state.canAdd : action.kind === 'rename' ? !sheet?.canRename : !sheet?.canDelete) return 'not-allowed';
    if (action.kind !== 'delete' && visibility.sheets.some(sheet => sheet.name.toLowerCase() === action.name.toLowerCase() && (action.kind === 'add' || sheet.id !== action.sheetId))) return 'name-in-use';
    if (action.kind === 'rename' && visibility.sheets.find(sheet => sheet.id === action.sheetId)?.name === action.name) return 'invalid-name';
    return null;
  };
  const decorate = (legacy: LegacyVisibility): WorkbookMembershipVisibility => {
    const value = refresh();
    if (!value || negotiated !== scopeKey(value.state)) return legacy;
    if (JSON.stringify(workbookMembershipVisibilitySchema.parse(legacy)) !== JSON.stringify(value.state.visibility)) throw Error('The worksheet management state is not coherent with its visibility publisher.');
    const ownActive = active && sameOwner(active.current, value) ? active.request.requestId : null;
    const busy = Boolean(ownActive || value.state.busy);
    return workbookMembershipVisibilitySchema.parse({ ...legacy, sheets: legacy.sheets.map(sheet => ({ ...sheet, canHide: busy ? false : sheet.canHide })), membership: {
      ownerId: value.stamp.ownerId, revision: value.revision, busy, activeRequestId: ownActive,
      canAdd: !busy && value.state.canAdd, sheets: value.state.sheets.map(sheet => ({ ...sheet, canRename: !busy && sheet.canRename, canDelete: !busy && sheet.canDelete })),
    } });
  };
  const receive = async (event: Pick<MessageEvent, 'source' | 'origin' | 'data'>): Promise<void> => {
    if (disposed || event.source !== options.parentWindow || event.origin !== options.origin) return;
    const probe = workbookMembershipProbeSchema.safeParse(event.data);
    if (probe.success) {
      const scope = options.getScope ? trustedScope() : refresh()?.stamp;
      if (scope && contextKey(probe.data) === contextKey(scope)) {
        options.parentWindow.postMessage(workbookMembershipReadySchema.parse({ type: 'studio:workbook-membership-ready',
          version: 1, projectId: scope.projectId, controllerId: scope.controllerId, ...readiness, handshakeId: probe.data.handshakeId }), options.origin);
      }
      return;
    }
    const negotiation = workbookMembershipControlsRequestSchema.safeParse(event.data);
    if (negotiation.success) {
      // Cache only against an independently known frame context. In the
      // compatibility path, the fully ready private getter remains required.
      const scope = options.getScope ? trustedScope() : refresh()?.stamp;
      if (scope && contextKey(negotiation.data) === contextKey(scope)) {
        negotiated = contextKey(scope); options.publish();
      }
      return;
    }
    const value = refresh(); if (!value) return;
    const parsed = workbookMembershipActionSchema.safeParse(event.data);
    if (!parsed.success || negotiated !== scopeKey(value.state)) return;
    const request = parsed.data;
    if (request.projectId !== value.stamp.projectId || request.controllerId !== value.stamp.controllerId || request.sourceSha256 !== value.stamp.sourceSha256 || request.ownerId !== value.stamp.ownerId) return;
    const identity = JSON.stringify(request), cached = results.get(request.requestId);
    if (cached) { if (cached.identity === identity) post(cached.result); else reject(request, 'changed'); return; }
    if (active) {
      if (active.identity === identity) return active.done;
      reject(request, active.request.requestId === request.requestId ? 'changed' : 'unavailable'); return;
    }
    if (request.revision !== value.revision) { reject(request, 'changed'); return; }
    const denial = allowed(value, request.action);
    // Every valid current-ticket attempt consumes that advertised revision,
    // including local no-effect rejection. An evicted ticket cannot execute.
    let finish!: () => void;
    const done = new Promise<void>(resolve => { finish = resolve; });
    const operation: Active = { current: value, request, identity, done }; active = operation;
    let applied = false;
    try {
      let error = denial;
      try {
        options.publish();
        const admitted = refresh();
        error = !sameOwner(value, admitted) || admitted!.stamp.historyRevision !== value.stamp.historyRevision ? 'changed' : error ?? allowed(admitted!, request.action);
        if (!error) {
          try { await options.execute(Object.freeze({ ...request.action }), value.stamp); applied = true; }
          catch (failure) {
            let code: ErrorCode | undefined;
            try { code = options.classifyError?.(failure); } catch { /* Never serialize or trust a failing classifier. */ }
            error = code && ['changed', 'not-allowed', 'invalid-name', 'name-in-use', 'unavailable', 'failed'].includes(code) ? code : 'failed';
          }
        }
      } catch { error = 'failed'; }
      let next: Current | null;
      try { next = refresh(); }
      catch {
        // Unknown getter lifetime cannot authorize another attempt.
        const report = !disposed;
        disposed = true; withdrawing = true; results.clear(); current = null; negotiated = null;
        if (report) { try { post(result(request, applied ? null : 'failed')); } catch { /* Retired before any external delivery callback. */ } }
        return;
      }
      if (disposed || !sameOwner(value, next)) return;
      advance(); if (exhausted) return;
      current = { ...next!, revision };
      const reply = result(request, error);
      results.set(request.requestId, { identity, result: reply });
      while (results.size > CACHE_LIMIT) results.delete(results.keys().next().value!);
      // Still active during publication and result delivery. The parent sees
      // its original active ID even if SDK state/revision already changed.
      try { options.publish(); } catch {
        // Execution already settled. Publication failure cannot turn a known
        // applied operation into a rejection or replace its cached receipt.
      }
      if (!disposed) post(reply);
    } finally {
      if (active === operation) active = null;
      finish();
      // A failed publisher is an installer recovery concern. Never leave an
      // active ID held or serialize its raw exception into host feedback.
      if (!disposed || withdrawing) { withdrawing = false; try { options.publish(); } catch { /* No automatic retry. */ } }
    }
  };
  return { decorate, receive, announceReady() {
    if (disposed || announced) return;
    const scope = options.getScope ? trustedScope() : refresh()?.stamp;
    if (!scope) return;
    // The installer calls this only after its receive listener exists.
    announced = true;
    options.parentWindow.postMessage(workbookMembershipReadySchema.parse({ type: 'studio:workbook-membership-ready',
      version: 1, projectId: scope.projectId, controllerId: scope.controllerId, ...readiness }), options.origin);
  }, dispose() { disposed = true; results.clear(); current = null; negotiated = null; } };
}
