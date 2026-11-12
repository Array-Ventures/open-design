# Workbook formatting preservation

The sparse edit plan supports cell bold, italic, font color and solid fill color.
Its optional `styles` array carries coordinates and only properties a person
changed. Omitted properties retain source ownership; color values are eight-digit
ARGB, and null restores automatic font color or no fill. The header's Format
popover applies bounded real Univer range commands, including normal undo; it
never exports the grid snapshot as XLSX. Automatic text color and No fill
commands use distinct valid renderer representations of black/transparent paint,
which the sparse plan maps to OOXML automatic color / patternType=none. This
also distinguishes no fill from an authored white fill. Rich-text selections, alignment, number
formats, borders, font family/size, row/column styles and structural formatting
remain unsupported edits and block saving rather than partially dropping them.

The writer clones the effective source cell XF (explicit cell, custom row,
column, then Normal) and just the changed font/fill components. All other XF
attributes, borders, alignment, number format, protection and extension nodes
remain retained. Source rows/cells/column ranges and structural component signatures are indexed
once before editing; malformed indices/counts and ambiguous component tables
are refused. New styled cells invalidate stale dimension/spans hints.
Existing styles are immutable; structurally equal components
are interned with bounded tables, and repeated identical saves reuse them.
Normal style zero is imported using the pinned ExcelJS style reader, because
its cell reconciler skips style zero; deduplication retains Normal at model zero.
Source row/column and sheet defaults are not rewritten by formatting edits.

Formatting-only transactions do not invoke calculation, remove formula caches,
expand shared formulas or change the calculation chain. Formula, rich string,
external-link and drawing/chart parts stay source-owned. A combined scalar edit
still uses the existing calculation admission policy before formatting; external
or array calculation limitations continue to reject that combined transaction.
Signed workbooks and protected sheets reject formatting. Conflicting inherited
row/column styles without an explicit cell XF, explicitly disabled inherited
font application, and implicit source coordinates also need their own adapter
and reject the edit. Source digest checking,
conditional commit/history and durable pending identity remain the existing save
boundary. The native Format popover requires matching project/controller and
selection identities; stale/blocked requests cannot target another selection.

Focused evidence is in `workbook-style-patch.test.ts`, including an independent
ExcelJS reopen, retained cached external formula result, untouched rich strings
and opaque package parts, idempotent repeated patches and inherited column font.
`workbook-grid-edits.test.ts` and `workbook-editor-style-inheritance.test.ts`
verify sparse deltas, typed edits and source defaults, rejection of unsupported
formatting, and genuine pinned-editor style interning. This is constrained basic
formatting support, not full Excel style or rendering fidelity.
