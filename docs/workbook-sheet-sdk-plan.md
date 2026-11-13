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

The pinned large-sheet helper is named `countCells`, but actual SDK probes
show its `ObjectMatrix.forEach` counts matrix **rows**, not literal cells.
The default threshold is 6,000 counted rows: a 6,400-cell/100-row book keeps
undo, while a generic 6,001-row/one-column SDK book clears it. A bounded higher
threshold retains the real deletion and prior-edit undo entries in that generic
probe. The current qualified XLSX reader's minimum 26-column window and 100,000
area cap exclude a persisted 6,001-row source, so no production threshold
override is currently justified. Recheck if geometry qualification changes;
copy and reorder remain independently unadmitted.

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
   source survivors/order, absent births, names, final visible membership and
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

## Required correction: undoing a committed deletion

The original source foundation's fresh-ID/append-only `new` policy could not express
all real SDK undo. `RemoveSheetUndoMutationFactory` returns the old index and
`worksheet.getConfig()`. After deleting sheet 2 and acknowledging a source with
survivors 1 and 3, undo must reinsert **ID 2 between 1 and 3**. Renumbering that
snapshot or restoring the whole historical file would corrupt undo semantics
or discard unrelated later edits. Clearing undo at ACK is not an alternative.

Two restoration classes must be distinguished before producer implementation:

- A redo of the original add command retains its original blank configuration.
  A later deletion's marker on the live sheet does not retroactively change
  that older add-redo configuration. Its known blank birth can be reconstructed
  from the deterministic blank baseline, retaining its old ID and position.
- Undo of source-backed deletion retains the full SDK snapshot, but that is not
  the full original worksheet package. Reader/grid models omit print options,
  page margins/header/footer and other admitted raw metadata; styles and shared
  strings also have package-level owners. A blank baseline cannot preserve them.

Implemented source extension: `origin: new` now means absent from
**the current source**, with a bounded, noncolliding numeric ID, rather than a
claim that the ID never existed historically. Allow absent-sheet insertion
positions while keeping all current survivors in exactly their relative order.
Normal fresh UI allocation still uses its monotonic high-water mark. This
permits replaying a known blank add birth without renumbering it.

For source-backed resurrection, add an explicit qualified historical worksheet
template origin. Its descriptor names the exact retained source SHA and original
sheet ID. Freeze that same artifact file's existing binary-history version through
the native history access boundary and existing source manifest. The contained
owner extracts only the selected worksheet, keeps current unrelated sheets and
edits, and applies actual SDK cell/axis/style deltas relative to the historical
template. It must not restore the entire file or accidentally resurrect cells
which the actual undo snapshot has cleared.

### Retained source and axis identity

Stamp an immutable template/source-axis descriptor into the live SDK sheet
configuration **before the delete command captures undo**. A per-deletion marker
is necessary: a global sheet-ID-to-latest-template map confuses repeated deletion
at different geometries. The descriptor refers to the current acknowledged
source and its actual axis identities/logical window. Keep it within existing
SDK snapshots and protected checkpoints, not a second action replay journal.

The checked save receipt already has `sourceVersionId` for the before-save binary
and `versionId` for its target. The checked ACK consumer now explicitly validates those identities and protects
the before-source association in the existing pending checkpoint before retiring
its baseline. The per-delete producer still must bind that checked association
to its captured descriptor, not infer it from the latest target version. A lost ACK must recover the same receipt/association.
This provenance must be protected before a pending source transition can discard
its predecessor. Do not trust an arbitrary passthrough receipt field.

Keep inner edit plans opaque to the native host. Proposed historical inputs
belong in a separately typed outer history-asset field, scoped to the same
project/file and frozen with their authenticated version/digest. The inner
restoration template SHA must match an actual frozen asset. History expiry,
wrong scope, missing template or changed identity refuses preparation; none
permits substitution from a newer file.

Retain only bounded descriptors/axis baselines reachable from real SDK undo/redo
or protected pending/desired snapshots. Admit destructive commands only when
that future undo can be protected within the resource budget. Do not silently
prune still-reachable source context or clear unrelated history to save space.

### Package-level dependencies

Historical worksheet XML cannot blindly retain historical style/string indices.
Current unrelated formatting may have appended or otherwise changed global
owners. First investigate and prove the current source writers' append/preserve
invariants: checked historical style/font/fill/border/number-format components
must still occupy equivalent indices, and shared-string/theme ownership must
remain compatible. A verified continuous source-preserving lineage could make
this a bounded prefix-qualification policy. Byte-prefix comparison of the entire
XML file is insufficient because serializers and counts change.

If those invariants do not cover an advertised restoration, the source owner
must import/remap all used global dependencies. External replacement or a
whole-file history restore changes source/kernel authority; it must not be
mistaken for continuity. Either approach needs actual ZIP/readback/calculation
proof, including unrelated formatting performed after deletion.

Additional mandatory cases: delete 2 between 1/3→ACK→unrelated edits→undo→save;
original add→ACK→undo add→ACK→redo original blank add; source-backed restore with
nondefault geometry/merges/print metadata; repeated deletion at different axis
states; lost ACK and protected remount; malformed/unavailable historical asset;
and unrelated current styles/shared strings retained. No capability should claim
post-ACK undo until these source and identity extensions are genuinely qualified.


### Actual SDK command probe scope

The command-boundary tests use real pinned insert/remove/edit/undo/redo commands
with an initialized locale and focused workbook. They confirm old ID/index,
merges and row geometry survive deletion undo while an earlier unrelated-sheet
edit remains; original add redo is actually blank after undoing its later edit
and then its insertion. Snapshot reads are not simulated server receipts: real
writer ACK/history/retention integration remains a separate required gate.

### Standalone historical worksheet XML owner

`sheet-template.ts` prepares a selected, SHA-checked historical worksheet only
after current/historical source admission and raw global-resource continuity.
Its returned XML retains raw style/string indices, merges, geometry and print
metadata; it removes derived formula caches and tab selection. It does not
authorize history access, assemble the final ZIP, expose a restore wire field,
or enable the SDK producer.

Qualified historical references resolve through the historical name→stable-ID
map, then the explicit final source/restored ID→name projection. An absent ID
becomes `#REF!`; a different ID reusing its old name never receives that reference.
Final SDK-authored formula edits must subsequently be applied and the complete
source validated/recalculated. Compatibility is not ancestry: only checked
per-delete source/kernel identity may supply this projection; external or
whole-file kernel resets withdraw that descriptor. Each other restored identity
still requires its independently checked template in the eventual assembler.

Focused tests exercise actual ZIP-derived XML, quoted references/string literals,
renamed survivor binding, different-ID name reuse, exact raw metadata/indices,
source immutability, invalid hashes/IDs and missing-descriptor refusal. They do not
claim the outstanding actual SDK delete→ACK→Undo→save chronology or positive
durable checkpoint/recovery/render-asset qualification.

The source blank-birth replay test deletes ID 2 from an actual 1/2/3 package,
replays a blank ID 2 between survivors, calculates/readbacks the result, and
checks survivor values/part identities and global bytes. Reordered survivors,
current-ID collisions and numeric overflow remain refused. This does not yet
qualify source-backed restoration or implement the SDK high-water producer.

### Source-only restoration assembly

`calculateWorkbookRestoredSheetEdits` composes those templates with the existing
membership/relationship/content-type/view writer. It requires exactly one
SHA-checked, resource-qualified template for every restored ID and refuses
duplicate/missing/undeclared owners before final calculation. Distinct historical input
archives together are bounded by the existing workbook archive-byte limit;
multiple restored sheets sharing one exact digest/byte asset count it once.
Inconsistent bytes under a shared digest are refused before assembly.
Only selected raw worksheet parts are inserted; current globals and unrelated
worksheets retain their own owners. The assembled package is actually reparsed,
source-qualified, calculated with final authored cell edits and optional axis/
dimension/style changes, then read back through the ordinary reader.

The source fixture retains current Other=20 while its historical file still has
Other=10, restores the middle sheet's raw geometry/merges/print metadata and
applies its final authored formula/cell edits. Actual output calculation and an
independent ExcelJS read both confirm 22. Another actual calculation returns
`#REF!` rather than retargeting an absent historical ID to a different current ID
with the same name. These are source-layer fixtures, not simulated proof of SDK
Undo or receipts. The next atomic wire layer carries strict historical references and scoped
frozen asset declarations to this source owner. SDK per-delete/ACK descriptors,
positive draft recovery and actual contained execution remain required; the
sheet-actions UI capability stays off.

A genuine 13MiB STORE XLSX reused by two restored IDs verifies distinct-asset
budgeting and cross-restoration formula calculation. The same new regression
failed before the deduplication fix with aggregate-limit refusal. Two different
valid archives still exceed the combined budget; a repeated digest with
different bytes is refused. This boundary uses actual archives, not a raised
production limit.

### Atomic historical asset carrier

The strict plan now accepts a `restore` entry only with its exact
`template: {versionId, versionSha256}`. Ordinary source/new entries forbid that
metadata. Direct ordinary sheet patch APIs retain the source/new-only schema;
restoration must go through the complete frozen-asset owner. Conflicting digests
for one historical version are refused. Save and explicit cancellation derive
exact deduplicated outer references from the same retained plan, sorted in
explicit code-point order rather than locale order.

The contained worker requires declared `{versionId, versionSha256, fileName}`
assets whose file names equal the full-SHA derived immutable path. Every needed
inner reference must be declared and every declaration used. All referenced
bytes are bounded and passed to the actual template assembler/calculator. CSV,
planless and whole-file restore combinations refuse the field. Native owns
same-canonical-file history authorization and actual immutable capture; its
paired carrier is documented in Evebot's `docs/workbook-sheet-assets.md`.

Actual worker-entry tests cover restored XLSX and preview, two restored sheets
sharing one asset, qualified formula recalculation, raw header preservation,
wrong version/bytes, undeclared/unused assets and refusal before output. Web tests
cover prepare/cancel reference equality. Protected draft tests still reject a
restore projection not derivable from the SDK snapshot and preserve the previous
journal. These are not positive SDK/ACK recovery or real container proofs.

The implemented API permits an explicitly authored, authorized same-file
selected-history template restore. Host ACL and compatible resources do not
prove a prior SDK Delete command. Automatic Undo remains unavailable until the
producer can prove and persist its protected per-delete/ACK kernel identity;
this source API must not be presented as that lineage guarantee.

### Checked acknowledgement metadata foundation

`save-identity.ts` explicitly validates optional `sourceVersionId` metadata.
Older receipts may omit it or return null and still support ordinary saves;
they supply no historical ownership. `checkedWorkbookSaveAcknowledgement` binds
the receipt to its retained operation/project/file/render, pre-save source digest
and refreshed saved-target digest. It returns a discriminated history result
with non-null pre-save `sourceVersionId` and saved-target `versionId`, or an
explicit unavailable result for a legacy or whole-file-restore receipt. One
immutable version cannot represent different source and target byte digests.

This helper does not itself read historical bytes, establish SDK Delete lineage,
persist a checkpoint, transfer writer ownership or enable a producer. Those
consumers are not connected yet. The next owning slice must protect its checked
association in the existing journal before baseline retirement, retain only
current/reachable per-delete associations, and prove lost-ACK/storage-failure
ordering before the UI capability may be enabled. Whole-file/external kernel
reset must retire the old ancestry rather than relabel it as a new source.


### Development checkpoint: ACK writer consumer

The editor now consumes that result after fresh-preview validation and returns
an internal `{preview, acknowledgement}` pair to the existing Writer, without
adding fields to the strict preview wire schema. The existing protected pending
checkpoint retains its old source, snapshot and immutable intent while recording
the checked association before baseline retirement. A failed transfer-storage
write restores the old in-memory baseline and pending identity. Recovery checks
the same remote receipt again; it does not skip source/target validation based on
a client-stored acknowledgement. Legacy receipts remain explicitly unavailable.

After successful protection, only the latest source-bound association survives
in the existing checkpoint; this is not an append-only cell-save journal.
Decoder checks bind historical ACKs to account/artifact scope, current target or
pending operation/render/source. Source tests cover actual Writer failure and
IndexedDB recovery, cross-owner refusal and the React hook consumer. Two new
failure regressions fail against the original Writer. This remains a development
checkpoint: own-ACK same-kernel retention, per-delete descriptor ownership,
reachable older association retention, outer Undo gating and actual contained
SDK recovery are not integrated, and sheet controls remain disabled.


### Development checkpoint: protected scalar kernel/source handoff

The editor issues an in-memory own-ACK ticket only after successful Writer
protection, within the same controller and journal lease, and for the exact
previously published Preview object. A multi-save drain retains that live owner
continuity but carries only its last checked receipt; this does not manufacture a
persisted historical chain. Without a journal, or after a legacy receipt, no
retained-kernel ticket is issued.

The surface keeps a separate kernel generation. External/history/reset source
adoption creates a new generation; a matching own-ACK alone retains it. The grid
then checks exact previous model/digest references, target/controller/project
binding, scalar worker readiness and stable source capabilities before adopting
the fresh source. Source closures and visibility gates read that rebased owner.
The live worker, its input epochs/generation floors, actual Univer instance and
SDK Undo history remain intact. A source change without a valid handoff retires
the old kernel instead of trusting an equal checksum or a borrowed generation.

The existing formula display owner explicitly rebases genuine source caches and
the acknowledged input baseline, preserving newer desired inputs and verified
calculated-output provenance. The input-equivalence guard normalizes only reader
blank-window extents to the ACK-owned geometry, rejects source cells outside
that window and never reseeds axis identities or modifies raw SDK cells. A cache
rebase publishes after the grid's current-source guard has adopted the target.

Source tests separately cover component lifetime retention, actual pinned SDK
unit identity and Undo/Redo, live visibility capability withdrawal, stale worker
epoch refusal, wrong source/controller/digest/project tickets and protected
multi-ACK handoff. They are not browser/container or full SDK sheet-action
qualification. Array/CSV source-family handoff, per-delete descriptor production,
reachable older template associations, pending sheet Undo gating, protected
restart recovery and actual worksheet add/remove/rename admission remain open.
Sheet controls remain disabled; no distribution pins change.


### Development checkpoint: live SDK history reachability

A maintained generic `@univerjs/core` patch supplies the missing read-only
primitive-history query; its boundaries and refresh evidence are documented in
[`patches/README.md`](../patches/README.md). It projects detached strings from
actual SDK history, including grouped entries and references retained on the
opposite stack after Undo. No source consumer may inspect private stacks,
truncate overflowing reachability or substitute a shadow history. Inspection
refusal must withdraw sheet deletion/Undo authority while retaining protected
context. The descriptor consumer is not installed yet.

Ordinary browser reload starts a fresh SDK Undo/Redo history, as it already does
for workbook edits. This work does not serialize or restore that native history.
Durable restart qualification must protect the current acknowledged/desired and
pending restored-sheet ownership, same operation/receipt and exact history
assets. Live own-ACK handoff, separately, must retain actual Undo/Redo across
saves. These are distinct guarantees; the new query provides live reachability
only, not durable Undo stacks.


### Development checkpoint: selected source-deletion capture

`sheet-delete-context.ts` captures only a currently source-present scalar sheet:
its typed source sheet, exact source SHA, selected ACK sheet/axis baseline,
account/artifact scope and a fresh per-delete token. It reuses the existing SDK
snapshot schema and source/ACK authored-input equivalence guard; blank logical
windows do not imply missing source content. Source-absent restoration and blank
birth cases refuse here until their separate owner exists.

The stamping helper uses the official Worksheet custom-metadata API and replaces
its object before the real RemoveSheetCommand captures Undo. Earlier actual SDK
undo configs retain their original token. Tests edit an unrelated sheet and the
deleted sheet before removal; real Undo retains both prior edits while the
captured template baseline stays at the earlier source/ACK value. Receipt data
association distinguishes sourceVersionId from saved target versionId and
rejects scope/source changes or immutable rebinding.

This is serialized context data, not authority. No file custom metadata, token,
stored receipt or parsed context alone selects a historical asset, creates a
blank origin or authorizes a sheet command. A recovered association must be
checked again against server-owned receipt/source/history bytes and the selected
sheet/axes under the current ACL. Capture/stamp/association do not install a live
controller. Bounded pool admission, actual history-reachability pruning/refusal,
blank births, inherited restoration, Writer pre-retirement association and actual
recovered-origin derivation still remain required before controls can be enabled.


### Development checkpoint: versioned selected baseline identity

`runtime/workbook-sheet-baseline` defines the version-1 public-preview model
identity. One extractor captures the complete typed selected sheet (including
cached formula values, rich runs, merges, geometry and row/column owners), its
referenced style closure including default style 0 and complete effective style
definitions, date system, theme colors, sheet-ID/name reference map, defined
names/tables, features and interpretation flags. Unused style definitions alone
do not affect this selected baseline. Raw historical file SHA, same-file access,
resource continuity and checked receipt ownership remain separate authorities.

The canonical encoder reuses `canonicalCommentJson` unchanged: object keys use
JavaScript UTF-16 lexicographic ordering (the typed key domain is ASCII), not JCS
or general Unicode-code-point order. Array order is retained, undefined optional
object keys are omitted, and -0 normalizes to 0 exactly as the existing preview
JSON transport. Raw file SHA still binds exact source bytes. Version changes are
required when interpreted reader representation changes; unknown versions refuse
rather than silently reinterpret protected baseline data. Node/depth/text budgets
are checked before cloning, and the final UTF-8 canonical body has a 64-MiB cap.

Tests cover same ordinal/different style definitions, default/cell/row/column
style owners, rich/cached/global-reference changes, JSON roundtrip/optional-key
normalization, forged or incomplete baseline data, unknown versions and bounded
non-JSON refusal. A reviewed fixed canonical vector agrees between actual
@noble browser-library hashing and Node SHA-256. These are source-level identity
checks, not actual historical ZIP/contained-worker proof yet.

No baseline field is accepted on edit-plan restore entries at this checkpoint.
Next, that field must be consumed by the actual historical template owner before
assembly, preserving raw versionId/versionSha256 and opaque outer plan hashes.
The context must store one baseline object and recompute its hash rather than
trust a separately stored digest. Old strict workers must refuse unknown fields;
no SDK producer may enable controls before the paired capability and complete
worker/receipt/recovery pipeline are qualified.


### Development checkpoint: selected-baseline consumer and context migration

The optional `baselineIdentity: { version: 1, sha256 }` is now accepted only on
restored-sheet entries. `sheet-template.ts` consumes it before assembly or cell
deltas: it extracts the selected baseline from the actual fully validated
historical `WorkbookDocument`, recomputes the canonical digest and rejects any
mismatch. Parsing the standalone baseline schema is never content authority.
Legacy manually authorized restoration without the optional field retains its
existing semantics. The original `template.versionId/versionSha256` and current
source CAS remain independent and unchanged; all historical assets still pass
exact same-file server authorization, frozen byte hashes and resource checks.

The development Delete context now stores one full selected baseline (including
referenced style definitions), not separate source-sheet/flag copies or a stored
claimed digest. Its helper recomputes the identity after JSON recovery. Serialized
context and receipt association remain data: no descriptor controller may use
them without rechecking the actual protected operation, server receipt/history
association and source scope. This checkpoint does not implement that controller.

Actual source tests pass a valid identity through `renderWorkbook` and inspect
the independently loaded XLSX; forged claims and unknown versions produce no
output. Historical-template tests reject changed selected values, same-ordinal
style definitions, date system and ID/name maps before assembly. Existing worker
asset tests retain wrong/missing/version/extra/hash refusal and unchanged source
checks; existing context tests retain receipt source/scope/rebinding refusals.
The captured old strict field set rejects the new claim (source-level proof,
not an old-image execution). Genuine merged/blank historical models exposed and
now cover JSON-null admission in the canonical preclone guard.

SDK sheet controls and capability remain OFF. No contained pair or runtime was
built/activated for this checkpoint; producer/controller integration, actual
old/new pair negotiation, checked recovered receipt binding and full protected
Undo/Redo/ACK/recovery qualification remain required before enablement.

Checkpoint validation: nine focused contract tests, fourteen historical-template
and actual renderer tests, and six SDK-context/cross-runtime tests passed.
Full repository typecheck and guard passed. The first full typecheck exposed
NodeNext import-extension and exact-optional interface mismatches; those were
corrected before the final pass. No full daemon/web suite, browser, contained
image or server-side receipt recovery run is claimed by these source checks.

### Development checkpoint: context protection in the existing draft owner

`WorkbookCheckpoint.sheetDeletions` now retains bounded typed selected-baseline
contexts, including on otherwise clean drafts. `WorkbookWriter.retainSheetDeletion`
requires the real journal's synchronous validator and checks the entire prospective
checkpoint through the exact serializer used by IndexedDB storage (same schema
and 128 MiB byte bound), before changing the retained pool. Wrong source/scope,
replacement tokens, pool overflow or encoder refusal retain existing contexts.
Recovery decoding checks unique tokens and exact account/artifact scope; decoding
is still data validation, never recovered server receipt or lineage authority.
The recovery session supplies this validator and the editor preserves it when
wrapping the journal. No separate cache or replay journal was introduced.

This is context retention only, not post-command admission. No live command
controller is installed and no Delete/Undo authority is granted. Current pending
membership derivation still fails closed; an actual encoder negative proves that
an invented pending Delete plan cannot bypass it. The next producer slice must
validate its exact post-command checkpoint before Remove or Undo/Redo stack pops,
maintain real history reachability, and bind checked historical receipts before
source retirement. No untested positive Delete receipt association is claimed.

Validation: 33 focused Writer/real-SDK-context tests and 30 affected existing
storage/recovery/editor tests passed; web typecheck, full repository typecheck
and guard passed. The refusal callback test covers atomic pool retention; it
is not a claim that a new large-quota or browser-storage boundary was exercised.
No runtime, image, UI controls or publication changed.
