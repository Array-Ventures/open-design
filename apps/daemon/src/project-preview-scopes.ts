import { randomUUID } from "node:crypto";
type ScopeWorkspace = { workspaceId: string; workspaceMemberId: string } | null;
type ScopeOptions = { ttlMs?: number };
type ScopeEntry = {
  projectId: string;
  workspace: ScopeWorkspace;
  reusable: boolean;
  expiresAt: number;
  documentExpiresAt: number;
};
const PROJECT_PREVIEW_SCOPE_TTL_MS = 60 * 60 * 1000;
export function createProjectPreviewScopeRegistry() {
  const scopes = new Map<string, ScopeEntry>();

  function pruneExpired(now = Date.now()) {
    for (const [scope, entry] of scopes) {
      if (entry.expiresAt <= now) scopes.delete(scope);
    }
  }

  // A scope is either one-shot or reusable, and the two must never be
  // confused. One-shot scopes belong to a single job that owns their whole
  // lifetime -- a screenshot/PDF export mints one for the render and `revoke`s
  // it in its `finally`. Reusable scopes belong to whatever live preview is
  // currently showing an artifact and are released only by expiry.
  //
  // The distinction has to live on the ENTRY, not on the call site: `acquire`
  // searches by (project, workspace), and an export shares that tuple with the
  // preview it runs alongside. Without a marker, a preview could adopt an
  // export's scope and lose it the moment that export finished.
  function create(
    projectId: unknown,
    workspace: ScopeWorkspace,
    options: ScopeOptions,
    reusable: boolean,
  ) {
    pruneExpired();
    const scope = randomUUID();
    const expiresAt =
      Date.now() + (options.ttlMs ?? PROJECT_PREVIEW_SCOPE_TTL_MS);
    scopes.set(scope, {
      projectId: String(projectId),
      workspace,
      reusable,
      expiresAt,
      // The expiry this scope's DOCUMENTS report, frozen at creation.
      // `expiresAt` floats as the client renews; anything embedded in a served
      // body must not, or the same artifact comes back with different bytes and
      // the iframe reloads. The host only needs this as the seed for its first
      // renewal — every renewal after that is driven by the renew response.
      documentExpiresAt: expiresAt,
    });
    return scope;
  }

  return {
    mint(
      projectId: unknown,
      workspace: ScopeWorkspace = null,
      options: ScopeOptions = {},
    ) {
      return create(projectId, workspace, options, false);
    },
    // Reuse the live scope for this exact (project, workspace) instead of
    // minting a new one, and do NOT renew it while doing so. The preview
    // transport injects the scope into a `<base href>` AND serializes its
    // expiry into the bridge script, so anything that moves per request --
    // a fresh id or a bumped expiry -- makes the SAME artifact serve different
    // bytes every read: the web client rebuilds its srcDoc, React assigns a
    // new string, and the iframe reloads; the artifact visibly disappears and
    // comes back (OPEND-2283). `options.ttlMs` applies only to a scope this
    // call has to create; keeping one alive is `renew`'s job.
    //
    // Deliberately NOT folded into `mint`: export flows mint a scope and
    // `revoke` it when the render finishes, and sharing one id with a live
    // preview would revoke the preview out from under it. That is why only
    // entries this method created are eligible below -- see `create`.
    acquire(
      projectId: unknown,
      workspace: ScopeWorkspace = null,
      options: ScopeOptions = {},
    ) {
      pruneExpired();
      const wantedProject = String(projectId);
      const wantedWorkspace = workspace
        ? `${workspace.workspaceId}\u0000${workspace.workspaceMemberId}`
        : "";
      for (const [scope, entry] of scopes) {
        // A one-shot scope's owner will revoke it; adopting it here would let
        // that teardown blank a preview that is still using it.
        if (entry.reusable !== true) continue;
        if (entry.projectId !== wantedProject) continue;
        const entryWorkspace = entry.workspace
          ? `${entry.workspace.workspaceId}\u0000${entry.workspace.workspaceMemberId}`
          : "";
        if (entryWorkspace !== wantedWorkspace) continue;
        // Deliberately does NOT renew `expiresAt`. The expiry is serialized
        // into the bridge script of the document this scope is about to be
        // injected into, so bumping it here changes the served bytes on every
        // read -- which reloads the iframe just as surely as a fresh scope id
        // would, defeating the whole point of reusing one. Lifetime extension
        // has its own path: the client renews explicitly
        // (`x-od-preview-scope-renewal`), and that response is not a document.
        return scope;
      }
      return create(projectId, workspace, options, true);
    },
    revoke(scope: unknown) {
      scopes.delete(String(scope || ""));
    },
    /**
     * The expiry to embed in a served document. Stable for the scope's whole
     * life, unlike `expiresAt`, which renewal moves. JSON responses should
     * keep using `expiresAt`; only bodies whose bytes must not change use this.
     */
    documentExpiresAt(projectId: unknown, scope: unknown) {
      const key = String(scope || "");
      const entry = scopes.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt <= Date.now()) {
        scopes.delete(key);
        return undefined;
      }
      if (entry.projectId !== String(projectId)) return undefined;
      return entry.documentExpiresAt ?? entry.expiresAt;
    },
    expiresAt(projectId: unknown, scope: unknown) {
      const key = String(scope || "");
      const entry = scopes.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt <= Date.now()) {
        scopes.delete(key);
        return undefined;
      }
      if (entry.projectId !== String(projectId)) return undefined;
      return entry.expiresAt;
    },
    renew(projectId: unknown, scope: unknown, options: ScopeOptions = {}) {
      const key = String(scope || "");
      const entry = scopes.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt <= Date.now()) {
        scopes.delete(key);
        return undefined;
      }
      if (entry.projectId !== String(projectId)) return undefined;
      entry.expiresAt =
        Date.now() + (options.ttlMs ?? PROJECT_PREVIEW_SCOPE_TTL_MS);
      return entry.expiresAt;
    },
    validate(projectId: unknown, scope: unknown) {
      const key = String(scope || "");
      const entry = scopes.get(key);
      if (!entry) return false;
      if (entry.expiresAt <= Date.now()) {
        scopes.delete(key);
        return false;
      }
      return entry.projectId === String(projectId);
    },
    resolve(projectId: unknown, scope: unknown) {
      const key = String(scope || "");
      const entry = scopes.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt <= Date.now()) {
        scopes.delete(key);
        return undefined;
      }
      if (entry.projectId !== String(projectId)) return undefined;
      return entry.workspace ?? null;
    },
  };
}
