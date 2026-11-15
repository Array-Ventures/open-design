# Sparse horizontal alignment

`WorkbookStyleEdit.horizontalAlignment` optionally carries `general`, `left`,
`center` or `right`. Omission retains the source owner; null and all other
alignment values refuse. General explicitly writes OOXML `horizontal="general"`
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
