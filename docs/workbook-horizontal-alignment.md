# Sparse horizontal alignment

`WorkbookStyleEdit.horizontalAlignment` optionally carries the source model’s
eight values: `general`, `left`, `center`, `right`, `fill`, `justify`,
`centerContinuous` or `distributed`. The public user-command schema remains
limited to General, Left, Center and Right. Omission retains the source owner;
null and genuinely invalid alignment values refuse. General explicitly writes OOXML `horizontal="general"`
for automatic scalar display. It does not coerce the cell's value or number
format. This additive field does not authorize arbitrary style-index assignment.

The existing style adapter clones the effective cell, custom-row, column or
Normal XF, then changes only its alignment's horizontal attribute and
`applyAlignment`. Font, number format, borders, fill, protection, vertical
alignment, wrapping, rotation, indentation, shrink behavior and unknown retained
XML remain source-owned. Alignment stays before protection/extensions in the XF.
Existing style records and unrelated package parts are immutable; bounded
structural interning deduplicates equal outputs and repeated identical saves.

The pinned ExcelJS reader ignores named-style alignment and application flags.
A shared raw-XF resolver now supplies its private import view and the writer:
explicit false uses the declared parent alignment; an absent local alignment
inherits the parent; an existing local alignment with an omitted flag retains
its established local semantics. Horizontal editing materializes the complete
effective alignment before overriding horizontal, so dormant local properties
cannot suddenly replace parent vertical/wrap/rotation settings. Original package
bytes are retained separately from this importer view. Missing parent references,
ambiguous alignment/table entries, invalid flags and parent counts refuse.
Other font/number-format inheritance policies are unchanged.

Actual XLSX tests first failed because the accepted field was ignored (three
failures, two unchanged controls). Separate named-style cases exposed the pinned
reader's missing inheritance before the shared correction. Tests open emitted
XLSX through ExcelJS independently and inspect raw XF/worksheet XML, retained
original style records, formula caches, rich strings, sibling cells and unrelated
parts. Combined scalar edits still calculate through the existing adapter; a
forged scalar style guard still refuses. Repeated saves do not append styles.

These are source/adapter checks. Native SDK formatting Undo/Redo, actual browser
rendering and packaged qualification belong to the paired grid integration.
Restoring an earlier alignment may reuse or append an equivalent XF; no claim is
made that native Undo restores the entire ZIP byte-for-byte.

## Author checks

The affected reader/style/calculation group passed 64 cases across five files.
The final row-inheritance control was then added; the exact final alignment and
renderer-plan group passed 23 cases across two files. The schema case passed
separately. Full workspace types, repository guard and frozen install exited 0.
Logs are under `/tmp/workbook-alignment-*`. Initial type failures (the private
import view's readonly Map type, then a test's unnarrowed cell union) remain
recorded; the corrections use an explicit private Map and an explicit numeric
fixture kind without weakening an assertion. A setup command from the wrong
working directory did not edit source; genuine failing test logs are separate.

The original source reader/writer tests retain their existing assertions.
Named-style fixtures inspect the unchanged sibling's original raw style owner,
parent and dormant local records as well as the emitted effective alignment.
OOXML vertical `center` continues to normalize to the pinned reader's `middle`;
that test expectation was corrected to the existing public model vocabulary.
No permission, current-source SHA, scalar style guard or package limit changed.


## Restoring a source alignment after Save

The initial four-value internal schema was too restrictive: saving General over
an original Fill, Justify, Center Across Selection or Distributed alignment then
Undoing must restore that exact source value. The sparse plan now reuses the
same eight-value schema as the source model. This is a preservation capability,
not a new user-facing command. The separate four-choice command schema is
unchanged and explicitly tested to refuse the other four values.

Four actual XLSX restoration cases failed against the initial schema while its
12 existing controls passed. Each now saves General, reopens that saved result,
then restores the original alignment through the same calculation/save adapter.
They independently read the emitted alignment, compare the complete original XF,
require retained original style records, reuse the existing original XF without
another append, and preserve unrelated package parts. This models source
restoration; live native Undo ownership remains the grid integration’s task.

The earlier schema/render tests called Justify and Distributed invalid. Those
expectations are replaced with genuinely invalid `diagonal`/`centre`, plus the
stronger real-source restoration cases and explicit UI-only four-choice
refusals. Unknown properties, null, empty edits and source-SHA/style guards still
refuse; no assertion is removed merely to accept an unsupported mutation.

This source-complete follow-up passed 80 affected daemon cases across six files,
both schema cases, full workspace types and repository guard. The four-case
failure log and final checks are retained as
`/tmp/workbook-alignment-source-{restore-red,final-focused,types,guard}.log`.
No browser, native Undo, new package or runtime qualification is implied.

## Native grid commands and live source provenance

The grid now accepts the four-choice horizontal-alignment action and emits an
optional four-choice-or-null state. Automatic uses the pinned public
`SetHorizontalTextAlignCommand` with `HorizontalAlign.UNSPECIFIED` (0), rather
than forcing Left. Mixed or unrepresentable ranges report null. Selection,
parent/origin, controller, editable/saving, rich-cell and existing 100,000-cell
bounds still apply. A proven unchanged choice preserves native Redo; an
unrepresented source alignment is not treated as a no-op.

The pinned facade maps several unsupported alignments to General. A private
kernel registry instead binds each initial source style ID to the exact SDK
style object and source horizontal property. State and sparse planning share
that registry and compose current raw default/row/column/cell owners. The
rendered SheetSkeleton's configured row priority is captured once; its default
is column precedence (default → row → column → cell), whereas a Node-only
Worksheet initially uses row precedence. Actual SDK overlap tests explicitly
set both configurations and compare the real composed result. Derived theme or
interceptor horizontal overrides cannot establish authored no-op provenance.
Unknown or changed objects stay unknown. Moved cells retain their style IDs;
new reader/ACK style ordinals never rename a live SDK origin.

The registry travels privately from Grid readiness to the exact installed
Writer and its planning contexts. A hook-local WeakMap retains it for that
Writer's qualified clean-resume handoff; rejected/stale readiness calls cannot
replace the current Writer's registry. It is never serialized into checkpoints
or files and retires with the kernel. A recovered/new kernel without proof
cannot reconstruct old style authority. An unprovable alignment removal blocks
Save and retains the draft instead of silently writing General.

The original SDK/state/delta cases genuinely failed before implementation.
Additional retained failures exposed partial-row inheritance, false General
for Fill/Center Across Selection, and a rejected-ready handoff race. The latter
regression fails against the intermediate ambient-ref implementation and passes
with exact Writer-keyed ownership. The final affected group passed 108 cases
across seven files, including real SDK commands/native Undo/Redo, row insertion,
both composition priorities, the full selection bound, Writer acknowledgements
with re-compacted reader ordinals, hook handoff, and retained unknown drafts.
The Writer acknowledgement fixtures use explicit legacy receipts; they do not
qualify historical receipt or HTTP authority. Earlier mock API/type/setup
failures remain separately recorded in `/tmp/workbook-alignment-*` logs.

A separate source-integration harness exercised actual SDK commands and native
history against actual XLSX reader/calculation/save adapters: original Right,
Fill and Center Across Selection each changed to General, saved, restored the
original through native Undo and saved, then Redid General and saved. Fresh
ExcelJS readback and independent XML checks verify all nine alignments plus
vertical alignment, wrap, shrink, rotation and indent. Font/number format,
untouched cells and unrelated ZIP parts remain unchanged. Receipts are
`/tmp/workbook-alignment-provenance-{right,fill,centerContinuous}-receipt.json`
and `/tmp/workbook-alignment-provenance-independent-xml.json`. These are actual
source-adapter proofs, not packaged worker, browser, HTTP, lease or transport
qualification. The paired native controls and General → Save → Undo → Save →
Redo lifecycle still require a matching immutable pair and actual UI checks.

Final full workspace types (serial workspace scheduling plus scripts types) and
repository guard exited 0. No app/image build, runtime activation, pin change
or publication was performed for this source checkpoint.
