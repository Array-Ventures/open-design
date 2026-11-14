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

Scalar edit style annotations must follow the owning
[style preservation guards](workbook-cell-style-guards.md). A compact historical
model ordinal is not a raw stylesheet index or a transferable identity; the
source owner proves any required guard rebase after membership/axis preparation.

### Development checkpoint: source-present membership derivation

`grid-sheet-projection.ts` now derives only current-source survivor projections
when protected deletion contexts are present. Writer and pending decoder call
the same `workbookGridPlan` owner. Original final membership is carried separately
while matched survivor baselines reuse the existing scalar/style/dimension/axis
diff. Source/ACK cell and complete style closure, account/file identity, actual
axis generation, every original and surviving axis, unique contexts and survivor
order are independently checked before filtering. Very-hidden deletion refuses.
Unknown/restored/new IDs refuse; no marker becomes a blank or template grant.

The existing scalar reference/work budget is extracted unchanged into
`grid-scalar-admission.ts` and reused here. Actual pinned SDK formula-plugin
Delete produces genuine cross-sheet `#REF!` references, which remain authored
plan edits. Unresolved references refuse. Defined-name/table sources explicitly
refuse in this initial producer; their metadata is never dropped to make a
synthetic model parse. A deleted active-sheet baseline chooses a surviving
visible model identity for the diff; actual XML view ownership remains the
source writer's policy. The producer neither serializes SDK data as XLSX nor
rewrites source styles or axes.

A genuine SDK Delete now passes the real pending encoder/decoder rather than
bypassing it with a seeded incompatible record. The original earlier refusal
test is updated because this owning producer now derives that exact plan; forged
pending membership still refuses. Another source test drives actual SDK Delete
through Writer and a mocked remote checked receipt, fails device protection,
then retries the same remote intent. The old-source pending checkpoint includes
the selected pre-save history association before source retirement and preserves
an unrelated earlier edit. This is a source-level mocked-transport proof, not a
server/container/ACL, live browser command admission or durable Undo proof.

Controls stay OFF. The awaited storage/lease/revision barrier and live controller
are not installed. New/restored origins, multiple same-source deletion contexts
for one ID (active-token selection), source metadata qualification, actual worker
sheet mutation support, source-absent Undo/Redo and recovered server receipt
rechecks still require their owning slices. No publication or pins change.

Validation: 58 focused SDK-context/Writer/axis-controller/draft-store tests and
nine baseline contract tests passed, plus final web typecheck, full repository
typecheck and guard. The original actual SDK Delete projection test failed
against the prior same-membership planner. No model, browser, container or
production calls were made for this checkpoint.

### Development checkpoint: awaited current-source Delete barrier

`WorkbookWriter.protectSheetDeletion` is a separate awaited admission boundary;
`retainSheetDeletion` remains non-authoritative synchronous pool retention. The
barrier derives the exact post-command plan and validates its complete prospective
pending checkpoint through the existing encoder/byte bound. It then writes only
the current checkpoint plus candidate context through the existing journal queue.
The temporary prospective UUIDs are not a remote operation, pending reservation
or new journal. Later real saves still revalidate current storage/CAS normally;
this does not promise future capacity for unknown receipt/history metadata.

After that actual journal write succeeds, active writer/source identity, desired
revision, pending/running state and the current recovery-session lease must still
match before invoking a synchronous SDK callback. Candidate roots are published
only at this point. Storage, ownership, close or newer-edit refusal never calls
SDK and leaves the old in-memory pool and newer desired edits intact. A candidate
which already reached storage before session withdrawal may remain redundant
protected data; it grants no command or historical authority. Once SDK is invoked,
the durable candidate remains rooted even if SDK throws, and a returned snapshot
mismatch is surfaced rather than being silently accepted. Conflicting recovered
sources refuse before storage. `close()` drains this barrier before lease release.

The real recovery session supplies a current-session predicate which withdraws
immediately on unmount while leaving legitimate journal shutdown drains possible;
the editor preserves this predicate in its existing wrapper. Tests use explicit
journal-entry handshakes, actual pinned SDK Remove and real SDK history. They prove
no callback/history change before durability and under storage rejection, lost
session, close or newer-edit races, plus preservation of the resulting genuine
Undo descriptor. The recovery hook's predicate is checked across actual unmount.
A first test's single-microtask assumption was corrected to the explicit storage
handshake, with unchanged durability assertions.

Validation: 62 focused context/Writer/recovery/editor tests and final web types
passed. No live controller or UI control is installed. Permission, worker/editor
readiness, actual history reachability/Undo outer gates, restored/birth sources
and recovered server receipt validation remain required before activation.
Final full repository typecheck and guard also passed on this barrier source.

### Corrective checkpoint: quarantine unexpected protected SDK outcomes

Independent review found that the previous barrier surfaced callback mismatch or
throw but still allowed a later ordinary grid update/Save to submit that rejected
SDK state. Two actual SDK regressions (Remove plus unexpected cell mutation, and
Remove then throw) each called the remote writer against the prior code. They now
remain fenced with zero remote calls after subsequent update/flush and recovery.

The existing checkpoint carries an optional sticky `sheetActionConflict: true`.
Writer preserves the protected pre-command source/desired and rooted contexts,
sets dirty/error, and refuses new writes or ordinary update-based clearing. The
same fence survives strict decode and Writer reconstruction. Observer updates are
suppressed only within the synchronous protected callback, before verification;
unexpected SDK snapshots are never published as saveable recovery data. Once a
callback has run, mismatch or throw quarantines before storage or Save can admit
that state. Flush also refuses while context protection is pending rather than
racing a write of the older dirty state. Pre-callback refusals do not set the
fence and still preserve usable newer edits.

Quarantine persistence uses the existing journal. If that later transaction also
fails, the in-memory fence remains and the earlier actual durable pre-command
checkpoint still retains the legitimate prior edits and selected context. Tests
explicitly report the absent durable flag in that failed-write case rather than
inventing recovery proof. After a reload the uncertain mutated SDK instance is
not reconstructed from that earlier checkpoint. A successful quarantine write
retains the sticky flag across reload. Actual SDK history is retained in the live
instance, not silently popped or serialized as a replacement history mechanism.

No generic clear operation is exposed. Future deliberate recovery UX must reset
the actual editor/kernel from the protected pre-command desired state under fresh
source/permission validation before clearing the fence; it must preserve earlier
legitimate edits rather than require discarding them. That recovery UX and the
full live controller remain unqualified, so controls remain OFF.

Validation: 66 focused context/Writer/recovery/editor tests passed; final 21
context cases additionally assert nonsticky pre-command refusal. Final web types,
full repository typecheck, guard and diff check passed. The two original failing
regressions are retained in the source tests. No runtime, model, image, production,
publication or pin changes were made.

### Corrective checkpoint: clean saved metadata is not an unsaved draft

Actual recovery-hook/Writer/IndexedDB lifecycle tests reproduced two false prompts:
ordinary checked Save and completed SDK Delete/Save both reported a clean Writer,
but retained history/context metadata became an “Unsaved drafts” head on reopen.
The tests use real production hook, lease, Writer and storage implementations;
only IndexedDB and the browser lock API use deterministic browser stand-ins.
Pending receipt, quarantined and genuinely unsaved branches remain recovery.

The same checkpoint now optionally holds one CURRENT versioned source/snapshot
binding established only during the live checked history-ACK/fresh-preview
transfer. Its bounded canonical hashes cover the full strict typed model (all
style definitions and interpretation metadata), exact acknowledged SDK snapshot,
complete checked receipt and complete journal/account/artifact/draft scope. No
snapshot or history is duplicated. Encoder/decoder recompute the binding; discovery
additionally compares the actual freshly authorized Preview model identity AND
source byte SHA. Model identity is not inferred from a claimed SHA or style
ordinal. JSON semantics reuse the existing bounded canonical encoder, including
optional-key omission and -0 normalization.

This is accidental-corruption/continuity evidence, NOT authentication or an
access/history grant. Locally self-consistent forged data can recompute a SHA;
it cannot become a checked host receipt or authorize a historical asset. Binding
metadata is never accepted from file custom metadata. Missing/legacy/unknown or
unprovable continuity remains conservatively recoverable, not automatically
trusted clean. A changed current Preview model or raw-byte identity likewise
retains recovery. Source adoption protects the new binding atomically with its
current checkpoint and restores the former binding on transfer-storage failure.

Existing heads receive an optional `needsRecovery` hint in the SAME atomic write
as their existing workbook bytes. Pending, quarantine, dirty and unrepresentable
states are recovery first. A clean hint is not deletion authority. Discovery only
inspects explicitly known-clean candidates automatically; historical/unknown
heads preserve their existing explicit-recovery prompt. A known-clean candidate
is strictly reread/reclassified against current Preview after acquiring its EXACT
branch lease before any atomic record/head removal. Active/unavailable leases
are never released by this discovery owner: read-only reclassification can allow
an independent editor while leaving live metadata intact. Corrupt, stale, pending
or newly dirty records remain visible. Cleanup release failure uses the existing
retirement fence; no second store, journal or history stack was added.

Clean metadata is retained while the live editor lease can own Undo/Redo or a
same-lease Writer handoff. `Writer.close()` does not blindly delete it. Once an
exclusive cleanup lease proves that editor is gone, known-clean metadata can be
retired because ordinary reload does not restore native SDK history. Pending
ancestry, current unsaved desired state and quarantine are never collected as
clean. The already-loaded authorized Preview is passed to recovery without
restarting the live session on each own-ACK update.

Coverage includes Save/close/reopen; completed actual SDK Delete/Save with a
second active editor; real pending/quarantine/unsaved records even when their
index hint is falsely clean; changed record between index and cleanup lease;
corrupt JSON, same-ordinal model/ACK style drift, binding/identity version drift,
self-consistent changed model versus actual Preview, changed current raw/model
identity, legacy heads, unavailable cleanup acquisition and failed-release fencing.
Fixture corrections used the SDK's actual saved defaults and IndexedDB's inline
head-key overload; assertions were not relaxed. A root-undefined helper test
asserts the reused encoder's existing TypeError rather than inventing a wrapper.

This remains source-level qualification: controls are OFF, no companion/renderer
or runtime was activated, and no browser visual/release qualification is claimed.

Validation: 11 focused contract tests and 85 focused web/SDK/recovery tests passed,
including the unchanged cross-runtime canonical identity vector. Final web types,
full repository typecheck, guard and diff check passed. No full daemon/web suite
or browser visual test was run. Main is intentionally not rebased during this
qualified source checkpoint; later upstream integration is a separate check.

### Corrective checkpoint: quarantine survives editor handoff and cancelled discard

A later integration review found `use-workbook-editor` classified same-source
handoffs only by their ordinary edit plan. Quarantine deliberately restores its
pre-command desired snapshot, so that plan can be empty while its sticky flag
remains essential. A second `ready()` or cancelled discard could drop that
checkpoint, and the journal's already-consumed replay would not restore the fence.

The hook now retains explicit quarantined checkpoints after its existing exact
scope/journal/source guards and before considering ordinary clean-plan retirement.
It does not revive every clean history record or use the fresh-model garbage
collection classifier as handoff authority. Two real hook regressions start from
an actual SDK Remove/mismatch-generated, encoded/decoded quarantine and drive
ready/reset or the real prepare/cancel discard message protocol. Both failed on
the prior code with the flag missing. They now retain dirty/error, source, protected
pre-command desired and contexts; subsequent ordinary snapshot/Save does not call
the remote transport.

The source-SHA mismatch guard remains strict. The actual production caller,
`WorkbookSurface`, refuses external source-stamp adoption while the editor reports
dirty (including quarantine), preserving the loaded source and showing its refresh
warning before a fresh-source `ready()` path could run. This fix does not force an
old protected checkpoint into another source, artifact or account. Deliberate
recovery/reset still needs its explicit validated editor reset; cancelling discard
is not such permission.
Validation: both new regressions were RED before the handoff guard. All 29 focused
handoff/discard/recovery lifecycle cases, web typecheck, full repository typecheck,
guard and diff check passed after the fix. Controls and runtime remain unchanged.

### Development checkpoint: Delete during an owned pending scalar save

The uninstalled source-present producer now captures a qualified source/ACK
while an unrelated save is pending. The existing Writer durably protects the
prospective Delete and unchanged original pending intent before invoking the
real synchronous SDK command. Neither protection nor its journal waits for the
running save. A returned receipt waits for protection; if another action starts
during receipt storage, that same barrier and context binding repeat before
source retirement. Post-command divergence remains quarantined even when the
remote scalar save already returned a checked receipt.

The first checked receipt associates the context with its immutable pre-save
history version even if the frozen pending snapshot still contains that sheet.
Its original selected baseline and ACK are retained, rather than replaced with
the later edited sheet. Source-present projection after transfer accepts a
carried context only with an explicit owner input recomputed from the existing
full `sourceSnapshotBinding`, current model/ACK and scoped receipt. This is
local continuity evidence, not historical access or authenticity; recovered
restoration still needs server-authorized same-file history and exact asset
SHA/baseline verification.

Author tests first demonstrated the pending admission/capture refusal and
missing pre-retirement association. A separate actual SDK test proves that an
insert's Redo recreates the original blank configuration, and a later cell-edit
Redo independently restores its value. These source tests do not qualify an
installed membership feature. Birth allocation, restored-sheet projection,
repeated Delete token selection, pre-pop Undo protection, worker mutation
admission, and full pending/ACK/history/recovery UI remain unfinished. Controls
stay off; no package, contained renderer, or runtime was activated for this
checkpoint.

Checkpoint author checks: 107 affected web tests across eight files, full fork
`pnpm typecheck`, `pnpm guard`, and `git diff --check` passed. The initial affected
run exposed three pre-existing fixture failures; all three reproduced on exact
unchanged `496dff0e` source. The unsupported membership case now asserts its
actual exact refusal while preserving zero writes, dirty state and Undo checks.
Two legacy hook cases now return complete, attempt-bound receipts and the actual
saved value instead of a target-only receipt/unchanged old model; they assert the
explicit absent kernel ticket. No receipt/source guard or timeout was loosened.
The author preserved the failed runs separately; they are not new product
regressions and are not described as flaky.

### Development checkpoint: protected blank birth origins

The source producer now has a bounded birth state in the existing protected
checkpoint: shared viewer/artifact scope and axis owner, a monotone numeric
high-water ID, and selected-sheet-sized original blank SDK configurations. The
source reader and virtual blank model share the same 100×26 minimum window.
Only the new sheet receives axes under the current kernel generation; existing
source axes are never reseeded. Native Insert captures its exact blank redo
configuration before later cell edits. An undone live birth does not recycle its
ID; the next prepared birth advances the high-water mark.

Writer, decoder and projector use one internal `WorkbookPlanContext` for deletion
records, birth records and the existing current-source consistency proof. Only
an exact validated blank baseline and matching current marker produce
`origin: new`; a historical Delete marker still refuses until its restore owner
is connected. The real pending encoder and derived plan are checked before
storage/SDK mutation. Storage must finish before Insert. Post-command mismatch
uses the same sticky quarantine as Delete, while a prospective quota refusal
leaves ordinary edits usable. These APIs are not installed as controls or tools.

Clean unacknowledged Add→Undo can clear durable draft storage only with no
pending or checked historical roots. The live state/high-water/config remains in
memory; same-generation `ready` handoff retains that data so native Redo remains
saveable. A fresh generation starts new native history and drops only that clean
carry. Data retention is not command issuance: the future kernel/controller must
independently own live tokens and recheck permissions, focus, source, lease and
actual top history after durable waiting.

A local deletion context can now explicitly choose `templateSide: saved-target`;
legacy omission continues to mean the pre-save source version. Its immutable
receipt is not rewritten. The selected side must match the context's exact byte
digest. A checked creation-target capture derives B's complete selected baseline
and exact frozen SDK acknowledgement before retiring A, even if current desired
already omits the birth; it declares B's `versionId`/SHA, never missing A bytes.
The capture refuses changed operation/render/scope/digests, changed stored
receipt, mutated frozen inputs and missing protected birth data. Server history
access and the contained worker's actual baseline comparison remain independent.

Pending birth insertion/removal and actual sheet Undo/Redo admission remain
explicitly unconnected in this checkpoint. Their temporary refusal is not the
final feature scope: pending-save Undo/Redo, lost-ACK materialization, restored
geometry/style ownership, worker mutation admission, dedicated reader membership
capability and real keyboard/toolbar/browser qualification are still required.
The existing structure capability alone must not advertise membership support.
No new runtime, companion, renderer, publication or UI capability was activated.

Author checks for this development boundary: 152 affected web cases across 14
files and 56 actual ZIP reader/sheet-writer cases across two files passed, as did
full workspace `pnpm typecheck`, `pnpm guard` and `git diff --check`. Genuine
pre-fix failures covered missing native birth axes, wrong pre-save versus saved
target association, and clean live ledger loss during hook handoff. An initial
new-constant failure came from stale compiled contract exports; the local
contracts package was rebuilt before the passing source runs. SDK/stand-in
transport proof does not substitute for a contained renderer, live controller,
keyboard/toolbar or pending-source recovery qualification.
