# Sheet SDK ownership and positive durability plan

Planning only, based on `12672ba`. The source owner and atomic render carriers
exist, but the SDK producer, sheet-action capability and UI remain disabled.
This slice must not loosen protected-draft validation to make a new plan pass.

## Actual pinned SDK seams

Univer 1.4.0 `InsertSheetCommand` accepts `params.sheet.id`, merges the supplied
sheet configuration with defaults, and retains that same configuration in its
real undo/redo mutations. Supply a bounded numeric birth ID before the command;
never replace a random SDK ID after insertion. Supply the source owner's blank
100-row, 26-column geometry explicitly instead of importing larger SDK defaults.

Rename and delete run real command interceptor pre-redos, the owning mutation,
and post-redos; their formula reference effects and undo arrays must stay intact.
A mutation-only helper would bypass those effects. Actual RPC tests must prove
completion against the final composite input, not just the first mutation.

`RemoveSheetCommand` clears the entire undo stack at the default large-sheet
threshold of **6,000 cells**. That falls inside our existing 100,000-cell budget.
Before exposing deletion, prove a bounded plugin threshold above the admitted
cell cap (proposed `largeSheetOperation.largeSheetCellCountThreshold =
WORKBOOK_MODEL_LIMITS.cells + 1`) preserves real delete undo for every admitted
snapshot. Test at and above 6,000 cells. Do not enable copy or reorder as a side
effect of this configuration; they remain independently unadmitted.

## Proposed identity owner

Use the existing workbook kernel generation and source/checkpoint authority,
not a second action journal. Add a bounded sheet identity helper beside
`grid-structure-identity.ts` that validates numeric imported IDs, unique live
sheet membership and a monotonic birth high-water mark. Allocate a new numeric
ID above both the current source maximum and retained high-water mark before a
real insert command captures undo. Protect that metadata in the existing
acknowledged, desired and pending snapshots; do not reuse a deleted/undone birth
within the same kernel or restored checkpoint.

At every ACK, source model membership determines `origin: source` versus `new`.
A sheet born in this kernel becomes a source sheet after its successful save,
even though its SDK birth metadata survives for undo. Do not infer origin from a
static birth flag, renumber on ACK or make a fresh write identity after a lost
response. A separate source revision/kernel is scoped by its source digest and
existing generation; numeric IDs alone never grant source authority.

A newly appended blank sheet needs row/column editing before its first save.
Its virtual baseline is deterministic: the same blank 100×26 worksheet emitted
by the source owner. Share a pure axis-seeding helper with the existing axis
identity owner so its baseline axes and actual insert snapshot use the same
kernel generation, sheet ID and initial axis identities. The virtual baseline
must contain no invented authored cells or caches. Later axis operations remain
expressed through the existing final axis projection.

## Projection composition

Introduce a pure `grid-sheet-plan` owner before `gridStructuralBaseline`:

1. Require qualified source capability and exact current kernel/source ownership;
   leave old previews/drafts on their existing strict refusal path.
2. Derive the final ordered sheet projection from actual SDK snapshots. Validate
   source survivors/order, appended births, names, final visible membership and
   aggregate budgets. Refuse unknown membership, copy and reorder.
3. Project source and initial baselines into final membership: remove deleted
   sheets; synthesize only qualified blank births; align renamed sheet names.
   Source model IDs remain authoritative after ACK.
4. Apply the existing row/column baseline and ordinary cell/style/dimension diff
   against those final identities. SDK reference rewrites may appear as genuine
   final formula edits; the contained source owner still independently rewrites
   and calculates actual source bytes. Do not infer cache authority from them.
5. Omit `sheets` entirely when membership/names have no delta. A clean ACK must
   yield the existing empty plan, not a perpetual dirty full projection.

Do not weaken `gridStructureIdentity` globally to accept arbitrary membership.
Only the validated sheet projection may supply aligned synthetic baselines to
its existing axis checks. Internal identity metadata must be stripped from
ordinary authored formatting comparisons, never serialized into OOXML.

## Calculation and command admission

Extend exact mutation admission for insert/remove/name only when the registered
source/book identity is sheet-capable. Validate proposed membership, blank birth
shape, final visibility and prospective area/axis limits before mutation. Keep
legacy books and unknown mutations refused. Recheck current editor focus,
permissions, controller, save/history/recovery and pending-source ownership in
the future action handler; source capability alone is insufficient.

Carry every real authored input mutation through the established host input
epoch/RPC provenance mechanism. Sheet changes with surviving formulas require a
fresh verified scalar pass after the complete interceptor sequence. Removing
the last formula ends liveness without promoting stored caches. Actual worker
RPC must cover cold and coalesced rename/delete reference results, stale caches,
rapid successive commands and real undo/redo.

## Positive durable proof before UI enablement

Use the existing `WorkbookWriter`, protected checkpoint and receipt protocols.
Its ACK deliberately sets the baseline to the exact pending snapshot, then
rebases later desired changes against the refreshed source model. Extend the
pure derivation and identity validators to make this path genuinely work; do not
replace its independently derived plan check with trust in a stored plan.

Required real SDK/actual source-calculator cases:

- Add→rename/edit/format/insert axes→first save→edit→second save, with stable IDs.
- Add/delete or rename while an earlier save is pending→ACK→rebase→second ACK.
- Undo/redo insert, rename and delete before and after ACK; deletion at the
  pinned large-sheet threshold must not clear unrelated history.
- Lost preparation/admission/ACK responses resume the same intent and candidate;
  protected remount preserves the birth high-water mark and exact plan.
- Independently derived pending plan equals its frozen snapshot; forged/missing
  births, wrong source/controller, source ID collisions and changed projection
  remain refused without replacing the prior protected draft.
- Concurrent source/CAS conflict retains the unacknowledged draft; current
  permission loss withdraws mutation authority and pending replay safely.

Then qualify a clean paired package/container, actual receipt/preparation crash
cuts with sheet-bearing plans and independent ZIP assertions, saved/history
reopen, XLSX/selected CSV exports, and manual keyboard/pointer behavior in both
themes and narrow/wide panes. Native carrier mocks and source tests do not prove
these properties. Only after these gates may the reader advertise sheet-action
capability and the real UI connect compact controls to qualified commands.
