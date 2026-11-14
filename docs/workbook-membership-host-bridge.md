# Negotiated worksheet-management bridge

This is an uninstalled frame adapter checkpoint, based on fork `ebeae186`.
It adds no Grid hook, SDK command, controller installation, worker admission,
HTTP route, or host UI. The separately reviewed native host remains the wire
consumer. Source callback tests are not actual worksheet/worker qualification.

## One publisher, exact negotiation

`workbookMembershipBridge` returns `decorate`, `receive` and `dispose`. The Grid
installer must attach `receive` to its existing exact-parent message listener and
invoke `decorate(legacyVisibility)` inside its ONE existing visibility publisher.
The bridge never independently posts a visibility state. Its `publish` callback
calls that existing publisher; the supplied legacy snapshot must exactly match
the fresh private getter's management snapshot. No racing legacy/new publishers
or optimistic host list are introduced.

Before exact-parent, same-origin `studio:artifact-request` version 1 negotiation
for the current project/controller, `decorate` returns the legacy shape with no
membership property. Older strict hosts therefore keep the old wire contract.
Support is scoped to the negotiated project/controller; another controller must
negotiate again. Same-controller source/private-owner changes retire old ticket
mapping and cached results, while the host's version support remains applicable.

The new pure contracts are exported through the existing runtime/workbook entry.
They mirror the native strict version-1 fields, finite error codes, worksheet-name
rules and capability consistency checks. No tool/agent schema changes are made.
`membership.revision` is an opaque controls ticket, NOT the SDK history revision.

## Private callback boundary

`getState()` must return null when no coherent private owner is available. Otherwise
it supplies the existing visibility snapshot, private controller identity object,
owner UUID, actual history revision and current operation capabilities/busy state.
The bridge captures these as a frozen private stamp. Host fields never manufacture
that identity object or replace the actual history revision.

The installer supplies `execute(action, capturedStamp)`. It MUST independently
recheck exact controller/kernel, history revision, current source, lease, worker,
permissions and operational admission immediately before executing. The bridge's
name/capability/ticket checks are UI protocol checks, not that authority. Resolution
means the actual admitted operation applied; rejection maps to a finite safe code.
Exception strings, file paths and stacks are never sent to the host. A failing or
unknown optional error classifier falls back to `failed`.

The bridge also rereads its private getter after reservation publication and before
calling the executor. An already withdrawn/replaced private owner or changed
history cannot cause a foreign-kernel callback. This is an additional fence, not a
substitute for the executor's independent checks.

## Ordering and bounded duplicate handling

One request reserves `activeRequestId` BEFORE publication/execution. Every decorated
state retains that ID while its private owner/source remain exact, including real
SDK list/history changes. The final result echoes the ORIGINAL host ticket. The
bridge publishes the correlated busy state, posts that result, then releases the
active ID and publishes the final current availability. A changed private owner or
source retires old replies; disposal posts nothing and starts no further callback.
Disposal cannot undo an operation already admitted by the private executor.

A monotone bridge-owned advertised revision advances on coherent management/private
history changes and after EVERY settled current-ticket attempt, including local
no-effect rejection. Unchanged publications do not advance it. The actual private
history revision remains separately captured and never overwritten by this counter.
Observed withdrawal/restoration does not reset the counter. Counter exhaustion
withdraws the membership bundle rather than reusing a controls ticket.

Exact active duplicates coalesce without another execution. Same UUID with different
payload rejects while active or retained. Dedupe is scoped to the original
ticket; after eviction, a reused UUID on a freshly valid later revision is a
new scoped intent, not replay of the old request. The last 32 exact results are retained for the current owner/source;
eviction is safe because their original advertised revision is already stale. An
older evicted ticket cannot execute again. There is no permanent 32-action quota,
unbounded result map, reconstructed issuer or durable history shadow.

## Source checks and remaining work

Focused cases cover exact negotiation/parent/origin, active-ID ordering through a
changed SDK callback snapshot, duplicate/coalesced requests, changed-payload UUID,
80 no-effect attempts and old-ticket eviction, stale/private/capability withdrawal,
malformed names, reservation-time history change, source ABA, private replacement,
safe failures and disposal. Contract cases retain the native legacy shape/name/
capability/result boundaries, including the invalid noneditable `canHide` fixture
that previously exposed a host-test admission mistake.

These use the actual bridge with injected private callbacks and a publisher that
calls its real decorator. They are NOT actual SDK operations, worker/lease tests,
HTTP receipts, packaged builds, crash cuts, browser focus or visual qualification.
Root still owns integrating the existing visibility publisher and actual private
controller after the live-consumer checkpoint freezes. No stack, preview, pins,
publication, real account or data changed.

Author receipts: `/tmp/workbook-membership-bridge-final6-tests.log` records 17
bridge callback cases; `/tmp/workbook-membership-bridge-contract-tests.log`
records five contract cases. Initial typechecking caught test-fixture nullable
accessor typing and then an explicit `.js` extension required by the existing
Node declaration-consumer lane; both were corrected without weakening checks.
Final full workspace types and guard receipts are
`/tmp/workbook-membership-bridge-freeze-types.log` and
`/tmp/workbook-membership-bridge-freeze-guard.log`; their terminal results are
reported separately without relabeling callback tests as actual execution.

Reservation publication is inside the attempt's failure boundary. A publication
exception cannot invoke the executor; if the exact owner still refreshes, the
attempt consumes its ticket and replies with finite `failed`. Its active ID clears
even if final idle publication fails. A private getter that becomes incoherent
inside an attempt retires the bridge/mapping before external failure delivery and
best-effort legacy withdrawal. Synchronous disposal during first publication
prevents execution and late replies. Focused callback tests cover these boundaries.
A transport exception can still reject `receive`; the installer must catch it and
withdraw/rebind a broken owner/publisher. Getter errors before reservation likewise
require installer withdrawal rather than invented execution or schema relaxation.
No promise can guarantee delivery through a lost parent transport.

The contracts package pins Zod 3 while the native host pins Zod 4. Inspection
found that their built-in UUID predicates differ: Zod 3 accepts grouped hex with
invalid RFC version/variant bits. A genuine contract RED captures that mismatch;
the new wire schema adds the native RFC version/variant boundary (including its
nil/max sentinels), without changing existing unrelated workbook/API schemas.
