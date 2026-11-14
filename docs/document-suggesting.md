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
