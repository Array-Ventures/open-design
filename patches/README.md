# Maintained dependency patches

`@univerjs__rpc@1.4.0.patch` snapshots primitive execution options when the
primary admits a mutation to its asynchronous RPC queue. The pinned SDK retains
that options object by reference; a caller can reuse it for later mutations
before the queued call serializes it. Per-input calculation epochs must retain
the value belonging to each execution, including rapid A → B → A updates.

The patch covers the package's ESM, CommonJS and compatibility entry files. It
does not change command parameters, transport ordering, permissions or source
files. Refresh it with `pnpm patch` / `pnpm patch-commit` when updating the pin,
then install the frozen lockfile and run the actual production-RPC shared-options
regression in `apps/web/tests/artifacts/workbook-formula-worker-boundary.test.ts`.
Remove the patch only after the upstream queue snapshots options itself and the
regression still passes through every entry variant used by our builds/tests.


`@univerjs__core@1.4.0.patch` adds a bounded, read-only primitive history
inspection method to the pinned `IUndoRedoService` and `LocalUndoRedoService`.
The existing public interface exposes status counts and only top entries;
`undoRedoStatus$` also publishes counts. Neither reveals older reachable metadata
or default-history trimming/grouped entries. Call sites must not inspect private
stacks or maintain a parallel command history to infer those references.

`getUndoRedoMutationStrings(unitId, mutationId, propertyPath)` projects strings
from both mutation directions of every real item on the requested unit's Undo
and Redo stacks. The result and both arrays are frozen; only immutable primitive
strings leave the service. It does not return real item/config/payload objects,
change focus, pop history, run application callbacks or read getters. Property
traversal uses own data descriptors, never prototype lookup. Missing paths have
no metadata; an existing selected non-string value refuses.

The API bounds unit IDs to 600 characters, mutation IDs to 200, paths to 1–16
ASCII keys (100 characters each, excluding prototype keys), selected strings to
512 characters, total scanned mutations to 100,000 and outputs to 4,096 across
both stacks. Every overflow refuses the whole read; it never truncates or prunes
reachable items. A worksheet descriptor consumer must withdraw destructive and
sheet-Undo authority on refusal, retain its existing protected context and report
the unsupported boundary. This dependency checkpoint does not yet install that
producer or enable controls.

The patch covers ESM, CommonJS, compatibility runtime and the declaration
interface/class. Refresh with `pnpm patch` / `pnpm patch-commit` and install the
updated lockfile; ensure the installed declaration/runtime method actually
exists, rather than trusting patch generation alone. The real SDK regression in
`workbook-history-inspection.test.ts` covers buried Delete history, actual
Undo/Redo, append grouping, default trimming, clear/disposal, getter refusal and
untouched history after finite-bound refusal. Separate Node entry-loader cases
exercise the actual service class with isolated collaborators for every runtime
entry; these are not full worksheet/browser qualification in every variant.
Propose upstreaming the generic read-only inspection API when updating the pin;
remove this patch only after an equivalent upstream boundary passes the same
actual-history and entry-loader cases. No dependency version changes here.


`@univerjs__sheets-formula@1.4.0.patch` removes two misleading pure-constructor
annotations from chained `new Set(...).forEach(...)` traversals in the SDK's
reference Undo/Redo builder. The production Next bundle eliminated both loops,
leaving empty undo/redo maps even after the SDK correctly computed shifted local
and quoted cross-sheet formulas. Raw source tests and an esbuild browser probe
retained the loops, so they did not expose this production optimization failure.

The patch changes annotations only in the ESM, CommonJS and compatibility entry
files consumed here; it does not change command paths, formula semantics, source
identity checks or computed-result provenance. The unused standalone UMD build is
not patched or qualified. Refresh through `pnpm patch` / `pnpm patch-commit` and
install the updated lockfile. A successful source-level SDK test is insufficient:
qualify the real production companion with row/column actions, actual formula
readback, Save, post-ACK Undo/Redo and independent XLSX inspection before removing
the patch. The frozen72 production failure and subsequent candidate qualification
are recorded separately; source test success does not claim a fixed bundle.

The core patch also adds optional public `ICommand.asyncOnly` registration
metadata. `syncExecuteCommand` refuses such a registered command before trigger
attachment, listeners, command-stack changes or handler invocation. The existing
Promise check runs after invocation and cannot prevent a rejected synchronous
call from causing a delayed async side effect. `executeCommand` and ordinary
synchronous registrations remain unchanged. No execution-option stamp or RPC
payload is added.

A future owned worksheet-history controller can register a scoped wrapper using
a fresh command object and call the original exported Undo/Redo handler only
after durable protection. It must not mutate the global exported commands.
Actual source tests prove blocked storage, denied protection, exact retry and no
late Undo after synchronous refusal. Entry-loader tests cover ES/CJS/compat;
the unused standalone UMD is not patched or qualified. Public keyboard/toolbar,
post-await unit/top-entry/lease validation, membership projection and production
browser qualification remain mandatory before installing that controller. No
wrapper or new controls are installed by this dependency checkpoint. Refresh via
`pnpm patch` / `pnpm patch-commit`, preserve the existing primitive inspection
patch, and rerun `workbook-sheet-history-command.test.ts` when updating the pin.

The primitive history query accepts optional fourth argument `position: 'top'`.
It inspects only the actual top entry on each native stack, while preserving both
mutation directions, immutable string output and the same refusal limits.
Omitting the argument retains the existing complete reachability query. Unknown
positions refuse. This is a semantic projection, not an object identity or an
authorization token. A pending sheet-action owner must also revalidate its
source, Writer revision, lease and focused unit after awaiting storage: actual
SDK edit/Undo and sheet Undo/Redo can return to the same top token after changing
state in between. No top query or matching token alone admits a command.

The core patch also adds `ICommandService.replaceCommand(expected, replacement)`
for an identity-scoped registration. Both commands must have equal ID/type,
replacement must be a different object with a handler, and the exact expected
object must still be the registered single command. Active scoped replacements
are non-nestable per ID. The returned frozen handle exposes only `isCurrent()`
and idempotent `dispose()`. Its authority is the private registration record,
not command-object identity: unregistering and reinserting the very same object
revokes the old handle. Disposal restores expected only while that exact
registration is still current; it never overwrites an unknown later owner or
resurrects a disposed wrapper. No mutable registry or registration token escapes.
Existing internal getCommand callers retain their fresh `[command]` tuple shape.

This boundary permits a future worksheet owner to revalidate registration after
awaited protection and before invoking native Undo/Redo or membership mutations.
It does not protect storage, grant a worksheet action, install wrappers or change
native command/history behavior itself. Actual SDK tests cover earlier/later
unknown owners, non-nesting, same-object registration ABA, normal restoration,
exported-object immutability and authority withdrawal before native history pop.
The three consumed runtime variants have real Node entry-loader coverage; the
unused standalone UMD remains unpatched/unqualified. Refresh through pnpm patch,
preserve all prior core boundaries and rerun these focused cases before changing
the pinned SDK or removing this patch.

The core patch adds frozen `IUndoRedoService.getUndoRedoCheckpoint()` with the
actual focused editor-history unit, service-local monotone revision and boolean
Undo/Redo availability. It exposes no native entries. The revision advances
before pushes (including same-count grouped/batched replacement), clear, pop and
successful rollback; unrelated units may conservatively invalidate it. Rollback
can change history without emitting the existing status observable, so counting
status emissions is insufficient. Empty focus reports an empty unit and false
availability. Disposed or exhausted revision inspection refuses; exhaustion
refuses before history mutation. It is an in-memory consistency checkpoint, not
authorization, persisted lineage or a substitute for protected source/lease and
live issued-descriptor checks. Consumed ES/CJS/compat entries and declarations
are patched; standalone UMD remains unconsumed/unqualified. Actual SDK tests cover
Undo/Redo ABA, grouped replacement, rollback, focus, empty focus, immutable output,
disposal and test-injected exhaustion. Controller installation remains pending:
real UI multi-implementation command dispatch must be qualified before selecting
scoped replacement versus a pre-dispatch protection boundary.

The optional `ICommand.syncHandler` supplies explicit synchronous behavior.
Only `_syncExecute` selects it; ordinary `executeCommand` still invokes `handler`.
The existing `asyncOnly: true` refusal remains earlier and unconditional, including
when a sync handler exists. Params, options, listeners and registry dispatch stay
unchanged. This permits a future identity-scoped Undo/Redo replacement to refuse
protected worksheet sync calls without scheduling work, while delegating unrelated
Docs paste-mode sync Undo/Redo to the exact known native handler. It does not
loosen multiple-implementation replacement refusal or install a controller.

Tests cover mode selection, protected no-delayed-work refusal, strict asyncOnly,
params/options identity and listener order in real services and the three consumed
runtime entries. An isolated full pinned SDK UI/worker probe also exercised actual
keyboard and toolbar gated async dispatch, formula-editor history and native Docs
clipboard Paste options mode changes with a scoped prototype. That scratch probe
is evidence for this SDK dispatch seam, not Evebot application or durable Writer
integration qualification. See `docs/workbook-history-sync-dispatch.md`.

The history checkpoint also exposes nullable `undoEntryId` / `redoEntryId`.
These are SDK-owned service-local primitive identities for the actual native
items, held in a WeakMap without exposing payloads. On each push, the actual final
undo item receives the already-advanced service revision, including grouped or
batched replacement. Moving an item between undo/redo stacks does not reissue it;
new pushes, copied items and re-pushing the same object revoke the prior identity.
The query does not allocate IDs or change history. Empty focus explicitly returns
false availability/null identities even if a malformed empty-unit bucket exists.

A live issuer can bind its own successful native Add to that exact item, then
reject a different history item carrying copied real birth metadata before
protection. IDs alone are not authority and are never persisted: kernel/source,
registration, lease, generation, revision and issued descriptor guards still
apply. Actual tests cover native movement, copied/same-object push, grouping,
batching, unrelated-unit invalidation and all three consumed runtime variants.
No worksheet controller is installed by this dependency checkpoint.
