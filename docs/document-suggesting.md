# Bounded document suggestions

This source checkpoint introduces genuine proposed text insertion, deletion and
replacement. It is not comment storage or Viewing mode, and it has no packaged
browser, release or production qualification yet. It follows the observed
Editing/Suggesting distinction in the native document reference record; that
observation does not define every review, reply or export behavior.

## Source and review policy

Proposals live in the same HTML or Markdown file as the document. A dedicated
Lexical inline node retains the original deletion branch and the proposed
insertion branch, including text formats and links. A replacement has adjacent
DEL and INS segments sharing one UUID; an insertion or deletion has one segment.
The only marker attributes are `data-eve-suggestion="1"`,
`data-eve-suggestion-id` (a UUID v4), and
`data-eve-suggestion-operation` (`insert`, `delete`, or `replace`).

The complete source is validated before sanitization/import and before save.
Duplicate IDs, unpaired/reversed/nonadjacent replacement segments, nested
proposals, unknown attributes/version and structural children are refused.
Ordinary authored INS/DEL remains unsupported for structured editing rather than
being mistaken for a trusted proposal. Source markup, UUIDs and display state
never grant permissions or assert an authenticated author. The current file
editor may review any proposal; existing project/file authorization still owns
the actual write. There is no new role, grant, comment record or side journal.

Accepting an insertion keeps its text; rejecting it removes it. Accepting a
deletion removes its retained text; rejecting it restores ordinary text. Paired
replacement decisions are atomic. Review is a native history operation, and the
existing serialized `DocumentWriter` saves against the acknowledged source hash
and parent version. Edits/review during a save remain queued, and a conflict
retains the unsaved desired source without overwriting changed remote bytes.
Saved proposals survive a whole source reload in HTML and Markdown; Markdown
uses lossless raw HTML for affected blocks with existing stable block identities.
This does not add durable recovery for unsaved document edits.

## Input and lifetime bounds

The first supported input is inline text within one paragraph, heading or list
item, including a paragraph inside a table cell. Typed insertion coalesces only
with the current insertion minted by the live input owner. Character deletion
uses Unicode grapheme boundaries. Text/selection replacement preserves original
formatted and linked runs; native Undo/Redo covers proposal and review changes.
Erasing the insertion of a replacement leaves a valid deletion proposal rather
than an orphan replacement marker.

Cross-block, paragraph/line-break, code-block and structural suggestions are not
implemented. Rich paste, drag/drop, formatting/indentation and checklist changes
are blocked visibly in Suggesting. Pending branches are non-editable DOM islands;
that render-only attribute is not serialized. While proposals are pending,
structural/format controls are unavailable and direct edits to proposal content
are blocked; unrelated normal Editing text/history remains available. With no
pending proposals, existing Editing behavior is retained.

IME composition is deliberately unsupported in Suggesting in this checkpoint:
composition starts with a visible notice and a temporary read-only guard that
clears on composition end, blur or owner cleanup. This is not proof of OS/browser
IME behavior; composition support remains follow-up work. Unexpected untracked
source changes are rejected by a RootNode transform before commit, HistoryPlugin
and the source writer. It uses Lexical's existing error recovery to restore the
committed state, not a writer-listener rollback or an independent history stack.
The guard has no HISTORIC-tag authorization bypass. Tests exercise an invalid
update, native Undo and Redo, and subsequent save to exclude history poisoning.
Root listeners/transforms/commands retire with their editor lifetime. Failed
validation/constructors do not leave an owned update tag; atomic/segmented text
is refused before extraction. Unexpected failures after insertion escape the
local catch and use SDK rollback before history or saving.

## Review layout and locales

Review uses a compact current-proposal card, with count and previous/next
controls, rather than a new top row or a list pushing the document downward.
The existing placement hook measures the actual proposal DOM range without
changing native/editor selection. Wide views reserve a side gutter; narrow
views use the bounded overlay. Automatic opening does not steal typing focus;
explicit close/open focus stays with its owning controls. There is no permanent
export-guidance row. Actual geometry/visual acceptance remains pending.

New controls/notices and the touched mode labels use the existing `useT`
context, with 20 typed catalog keys across all 19 supported locales. French and
Arabic source-component tests exercise real translated controls; this is not
a claim of native-speaker review or a full localized document UI.

## Export policy

Pending proposals must be resolved before converted document export. The
renderer preparation boundary and direct Word/Markdown adapter both enforce
this rule, including the PDF preparation path. They return a resolve-first
error rather than silently choosing a deletion/insertion branch or inventing
native Word tracked changes. Ordinary unmarked strikethrough preparation is not
banned. Original source download stays on its existing byte-preserving route.
Accepted/rejected source uses the existing export adapters; new actual consumer
qualification remains required. Suggestion replies, author attribution,
accept-all, collaborative merging and native tracked-change exports are open.

## Author evidence

The original source failed the recognized admission assertion (one failure,
seven passing refusal controls). A separate old-source real Lexical/Markdown
roundtrip lost both tracked markers. The actual renderer preparation boundary
also failed the new resolve-first assertion before correction. These failures
are distinct from the new input-owner implementation tests.

New source tests cover strict pairing, exact HTML/Markdown/Lexical roundtrip,
Unicode/formats/links/block identity, native input commands, cancellation,
coalescence/caret boundaries, native Undo/Redo, source conflicts, queued review
while saving, read-only review and pre-commit history safety. An early partial
link oracle incorrectly demanded one anchor wrapper; actual SDK range insertion
splits equivalent same-URL links. The corrected oracle checks every linked
character and URL. Genuine coalescing, caret and Backspace failures were retained
before their corrections. No old visual baseline or existing assertion was
loosened.

Final new-base focused checks, workspace types, catalog validation and guard
results are recorded at freeze. An intermediate table fixture omitted the real
block-ID initializer for its second cell; its metadata failure was corrected in
the fixture without changing source admission. A jsdom clipboard fixture needed
the browser event constructors and empty files collection used by the real SDK
paste path; those harness failures are distinct from the genuine literal-text
clipboard-policy regression. No real browser screenshots, immutable pair or conversion consumer
results are claimed by this source checkpoint. Actual rapid typing, IME refusal,
clipboard, table-cell flow, access withdrawal, reload/conflict/history, themes,
phone/fullscreen and original-download/conversion boundaries remain required
before claiming user-level acceptance.

Initial `2831ec60` author qualification on base `c12ffd58`: 266 web cases across fourteen
focused files and eight daemon cases across two files passed. Full workspace
`pnpm typecheck`, `pnpm guard`, `pnpm i18n:check`, the frozen install and diff
check exited 0. The final logs use `/tmp/document-suggesting-freeze-*.log`.
This includes the existing comment placement cases after adding the passive
proposal-range accessor. No browser, Worker, renderer image, model call or
runtime change was used for this qualification. The remaining actual immutable
pipeline/visual/interaction gates above remain open, including Markdown renderer
preparation and the resolve-first conversion error as seen through the normal UI.


## Character-deletion domain correction

Independent review of frozen `2831ec60` found that collapsed character deletion
flattened `getAllTextNodes()` while element offsets also counted BR/image nodes.
The producer could delete text on the wrong side of a barrier, or change the
active selection before refusing the operation. This is a source/SDK finding,
not an executed packaged-browser failure.

The follow-up planner retains BR, image, proposal and unknown inline nodes as
explicit barriers. It maps actual SDK TextPoints and ElementPoints through
native child boundaries, then measures Unicode graphemes only within the
contiguous text segment on the requested side. Links retain their text children
in that same segment. All checks and detached-range construction precede any
active-selection or source mutation. The segment iterator does not allocate a
whole-paragraph array of grapheme objects.

Twenty actual SDK cases initially had twelve failures and eight passes. The
corrected source passes all twenty: eight barrier refusals compare exact source,
selection points and native Undo/Redo stacks; eight valid same-side controls
exercise native Undo/Redo; four formatted/link grapheme controls preserve their
text, styles and URL. The final affected lane passes 59 cases across four files.
Full workspace types, guard, frozen install and diff checks exit 0. Logs are
`/tmp/document-suggestion-barriers-{red,green,focused,types,guard}.log`.
The original checkpoint and its earlier proofs remain frozen. No browser,
Worker, renderer or runtime qualification is implied by this correction.


## Actual 135 acceptance and reopen correction

Local immutable 135/78 from `8fa699e6` passed its 335 joined web cases, nine
daemon cases, two actual RPC cases, types and guard. Those source results did
not qualify the new Suggesting interaction. Actual browser input inserted six
characters as one proposal, retained focus and autosaved its valid INS metadata.
Normal reload then fell back to the original HTML viewer instead of the
structured review surface. The captured source is retained byte exact in
`apps/web/tests/components/embedded/fixtures/suggestion135-saved.html`.

The exact source passed JSDOM admission and the real DocumentSurface component
route. A separate real Chrome source-module probe on an empty local page
reproduced admission refusal at a generated TH border: Chrome enumerated
`border-image-source:none`, slice `100%`, width `1`, outset `0`, repeat `stretch`,
where the existing owner allowed only `initial`. The new controlled CSSOM case
also failed before the correction. This was a generated table-border admission
problem, not evidence of lost proposal metadata. The fix accepts only those
individual reset values when the existing exact canonical cell border owns
them. Raw authored border-image declarations still pass through their separate
strict declaration guard; unsupported INS/DEL still retains the original viewer.

The real source-module Chrome probe now admits the unchanged saved bytes. It
uses no app/runtime overlay and does not qualify a packaged reload. Matching
component/admission cases exercise this fixture and unsupported INS/DEL. Actual
135 source download/export refusal, browser closure and four exact absent
sessions are recorded privately in
`/tmp/artifact135-document-ui/qualification-in-progress.json`. The actual
review-card screenshot also showed default blue controls; separate follow-up
`941fec12` reuses neutral BoardUI secondary/document icon styles. Both fixes
require a new immutable pair and actual reload/review/visual acceptance; 135 is
unchanged. Suggestions remain unqualified as a complete user workflow.

Correction author checks: 136 cases across four component/admission files,
follow-up 29 surface cases after changing only the fixture-loading mechanism,
web and full-workspace types, guard, frozen install and diff check exited 0.
The initial typecheck failure was the test's undeclared `?raw` HTML import;
using the existing `readFileSync` fixture pattern corrected it without changing
production or admission policy. Private logs use
`/tmp/document-suggestion-reopen-*`; the exact source fixture SHA-256 remains
`25a04473b1a6a8921af377d2300c665af7b17eb09662a037f629a9a9bc4230a0`.


## Review controls and reserved gutter follow-up

Actual 136 revealed two review UI defects, retained privately in
`/tmp/artifact136-document-ui/review-closed-narrow-light.png` and
`markdown-expanded-wide-light.png`. At 390px the closed-card text trigger
floated over the heading. At wide size, the card sat beside a short selected
phrase and covered another paragraph while the reserved end gutter was empty.

The reopen affordance is now a neutral existing BoardUI icon button in the
already-present document status/mode header. A normal React portal targets an
owned header slot; selection, review state and close/reopen focus remain in
DocumentSuggestions. The empty slot consumes no layout space, the mode control
does not shrink, and the status can truncate instead of displacing controls.
The icon retains the existing translated accessible name and tooltip. There is
no new row, floating text button, permission or host message mechanism.

Suggestions pass their exact scroll ref to the existing passive placement
hook. Only when a real logical-end gap fits the card does it use that measured
gutter; it observes that scroll owner's resize as opening review reserves space.
A scoped document-direction observer also remeasures when the locale changes
logical sides without changing scroll width. The card remains inside its measured
canvas, uses the existing anchored vertical
position, and keeps the bounded narrow overlay fallback when no gutter fits.
LTR/RTL use the actual scroll direction. Comments omit the optional scroll ref
and retain their existing placement path. Neither source nor model/native
selection is changed by measurement.

The original header containment assertion failed before the portal correction.
The three original gutter/scroll-observation cases failed before the hook change.
Source component cases retain French/Arabic Escape, focus return, icon reopen
and inline-proposal click behavior; geometry cases cover both directions,
inside-canvas/nonoverlap, reserved-scroll resize and the narrow fallback.
An isolated Chrome check used header HTML captured from the actual mounted
source component plus its actual compiled BoardUI stylesheet: all 12 combinations
of English/French/Arabic, 390/1440 widths and Light/Dark fit the existing row,
with a 32px trigger above the following heading. Representative French Light
and Arabic Dark captures were personally viewed. Private receipt:
`/tmp/document-review-header-proof/proof.json`. That is a source-header layout
check, not packaged full-editor acceptance. New immutable-pair Light/Dark,
wide/narrow card geometry and keyboard acceptance remain required; 136 is
unchanged.

Final author checks: 92 cases across four component/placement files passed;
the five geometry cases passed again after correcting only the fixture's
CSSProperties typing. Web and full-workspace types, guard, frozen install and
diff check exited 0. The initial test-only custom-properties style type failure
is retained separately. Logs use `/tmp/document-review-header-*` and
`/tmp/document-review-placement-*`. No app build, runtime overlay, preview change
or publication was used.
