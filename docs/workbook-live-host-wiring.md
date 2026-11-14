# Live worksheet host wiring — historical source checkpoints

The later [candidate 128 qualification](workbook-live128-qualification.md) records
the first bounded packaged Add/Save/Undo/Redo/Rename/Delete/reload flow. Pending
statements below describe their dated source checkpoints, not the current pair.

PR #39 now prepares the reviewed candidate 132 source (`83316f1e`) through
normal merges; this does not relabel candidate 131's actual results. At 131,
numeric persistence, post-Save capability reconnection and a Worker-fault draft
Restore/Save passed bounded checks, while rich append lost its styled prefix,
unused-sheet Rename hit the calculation deadline, live formula repaint was
incomplete and a raw Markdown code fixture failed structured admission. The
source corrections are reviewed; bounded candidate 132 browser results are recorded in the
[132 qualification](workbook-live132-qualification.md), with final review and
remaining gates still open. The [native 131 record](https://github.com/Array-Ventures/evebot/blob/c5954f857b5819bc4e327d7a0d953c3e97abad9a/docs/workbook-live131-qualification.md)
retains the independent XML checks, precise failures and cleanup limits. This PR
remains draft; installer pins and production are unchanged.

Root integration joins private consumer78b1724b with reviewed bridge2101576e
at9e80ed84. The one controller merge conflict retained private pause/rebind
methods; detached inspection remains present once and native registration count
remains five. The joined source is not qualified by the separate parent results.

The existing visibility publisher now optionally reads its live list through the
private management owner. Unsaved born/renamed/removed worksheets therefore do
not depend on an unchanged source model. It exposes undecorated state to its
private bridge getter and applies the negotiated decorator through the same
publisher. New management requests route only after the existing exact parent
and same-origin checks; the installer owns asynchronous withdrawal/disposal.
Legacy callers without this adapter retain their prior publisher and listener.

A genuine real-SDK regression failed on the old publisher because a new renamed
worksheet was absent. The fixed source passes that Add/Rename/Delete/Undo case
and the seven existing visibility cases. Receipts:
/tmp/workbook-live-visibility-qualified-red.log and
/tmp/workbook-live-visibility-green.log. An earlier exploratory test used an
incorrect optional fixture scope property; the qualifying baseline instead uses
the actual exported scope before the source fix, without changing assertions.

This checkpoint is unfinished. Full joined types/guard, executor and lifecycle
wiring, startup negotiation, guarded persistence and maintenance integration,
normalized paused results, discarded-capture races, actual worker/HTTP/browser,
package and crash qualification remain pending. No renderer, preview, installer
pin or production change is implied by this source test.

## Joined live wiring checkpoint

The grid now attaches trusted version negotiation before its SDK readiness and
membership-configuration awaits, then synchronously hands dispatch to the one
visibility listener. A private executor obtains fresh controller, history,
lease, source, scope, permission and worker readiness before invoking the actual
Add/Rename/Delete methods. Grid lifetime owns adapter/controller/maintenance
and settled-history publication disposal. A malformed live worksheet name
refuses publication and removes the initial listener on construction failure.

Native history publication uses the pinned command service's settled boundary:
an ordinary scalar command pushes history after its mutation event, so mutation
publication alone advertises a stale action revision. The O(1) history-revision
check publishes on that change and again after Undo/Redo settles. Tests drive
scalar edit -> host Add -> Rename -> Delete -> SDK Undo without manually
publishing between scalar edit or Undo and the next host assertion. Admission
tests independently refuse stale history/source/scope/private identity,
revoked lease, blocked/saving state and permission/readiness withdrawal.

On this joined product source, 45 focused cases in five files pass serially;
full workspace typecheck and guard pass. Logs are
/tmp/workbook-live-host-boundaries.log,
/tmp/workbook-live-host-full-types-final.log and
/tmp/workbook-live-host-guard-final.log. The first extraction run sent an
invalid Delete packet with an extra confirmation property; the test now parses
its wire packet and requires a result for that exact request ID, rather than
accepting an earlier result. This was a fixture correction, not a product
Delete failure. Earlier typecheck caught an optional live name, now refused.

Still open: a request can precede even the grid's lazy import/mount; the native
host needs its separately tested bounded first-publication retry. Membership
capabilities currently require the visibility-editable capability, as does the
version-one schema. The current reader's membership qualification implies that
visibility qualification, but independently supplied future capability
combinations remain unsupported; enabling Eye/Show implicitly is not a fix.
This source checkpoint does not prove actual browser/worker HTTP persistence,
package acquisition, source-history cancel/recovery, or crash acceptance. The
owned preview remains pair126/69 without these live controls; installer pins
and production remain unchanged.

## Retained-view retirement correction

Read review found that a shown layer intentionally retains its SDK instance
until the replacement shows. With the same artifact ID but a new source/kernel,
a late old management settlement could call a still-callable visibility
publisher after grid cleanup. This was a stale UI publication race, not proven
cross-project access. Grid close now disposes management synchronously, the
visibility scope requires the exact current generation, and a disposed
publisher's state/publish methods are inert. The real-SDK regression replaces
the scope after disposal and verifies that late publication cannot post again.
Existing bridge tests cover disposal while execution is pending.

The final corrected product passes 46 focused cases across five files, full
workspace types and guard. Terminal logs:
/tmp/workbook-live-host-retirement-boundaries.log,
/tmp/workbook-live-host-retirement-types.log and
/tmp/workbook-live-host-retirement-guard.log. No browser/package acceptance or
runtime switch is implied; the remaining gates above still apply.
