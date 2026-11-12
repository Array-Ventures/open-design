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

## Font fallback without changing authored fonts

`WorkbookFont.family` optionally retains the source OOXML family number, including
Normal and rich-run fonts. The grid quotes the authored name and appends a generic
family from that metadata: Roman → serif, Swiss → sans-serif, Modern → monospace,
Script → cursive, Decorative → fantasy. Missing/unknown classification uses a
neutral sans-serif fallback; names never determine classification. This follows
[the OOXML/Office family definition](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-oi29500/2b2b6126-7574-49f8-bbcf-6335bb1f7026).

This is a presentation list, not an authored font edit. The source XML retains
its exact font name and classification through scalar and supported style edits.
The pinned renderer itself normalizes canvas font strings and naively splits at
commas. Comma/quote/escape-bearing names and CSS generic/reserved names therefore
use the declared generic and report `font-families` as a display gap; the adapter
does not let those names inject extra families or claim their installed-font lookup
is faithful. This does not provide an exact substitute for an unavailable font's
metrics or appearance.

`workbook-font-canvas.test.ts` exercises the actual pinned renderer and native
Chromium canvas without starting application services. It verifies Swiss/Roman/
Modern fallback metrics and a locally loaded bundled face winning over its generic
fallback. The reader/writer font tests independently reopen XLSX output; pinned
editor inheritance tests ensure display font lists do not create authored changes.

CSV row heights and column widths are open-view preferences. Acknowledged saves
and fresh source reads retain those sizes within the mounted, viewer-scoped
project/file grid. Only finite positive sizes within the new source grid bounds
carry forward; cells, styles, formulas and hidden state remain source-owned.
These preferences never enter CSV save plans or exported bytes and are not
persisted across closing/reopening the surface or a full page reload.

CSV deliberately stores numeric-looking entries as literal text. Its pinned
number-format plugin disables the optional text-number warning triangle and
conversion prompt through `disableTextFormatMark`/`disableTextFormatAlert`.
XLSX keeps the plugin defaults; actual CSV input refusals still use the scoped
header notice rather than changing or converting valid literal values.

## Retained canvas during acknowledged refresh

A source acknowledgement can replace the disposable spreadsheet kernel. Keep
its last rendered layer inert and read-only while the replacement initializes;
stop retired calculation workers and event listeners immediately. Swap layers
only after the pinned public Rendered lifecycle and its two-frame workbench
skeleton release have completed, then dispose the old kernel. Artifact identity
changes and whole-surface unmounts withdraw old content immediately. View capture
runs before kernel disposal. This retains the actual canvas, not a screenshot,
and does not carry old cell content into the new authoritative source.

Focused component regressions cover delayed renderer readiness, disposal once,
read-only retirement, immediate cross-artifact withdrawal, the existing dirty
worker-fallback handoff and CSV dimensions across acknowledged writer refresh.
Actual packaged transition recording remains required before claiming the
skeleton flash fixed in the product preview.

The pinned browser/runtime suppresses text `beforeinput` when the incoming
editor is initialized inside `inert`, even after that attribute is removed.
An independent real-browser comparison reproduced this with fresh kernels:
hidden-only initialization types correctly; hidden plus inert does not. Incoming
layers therefore initialize hidden, with write permissions, input activation,
formatting and export selection held until the rendered handoff. Only retired
layers become inert. The app regression types through the actual canvas after
Save, then Undo verifies that only the first acknowledged edit changed source.
Its broken-package baseline reaches the replacement and fails on that second
keyboard mutation; packaged green qualification is still required.

## Rich cell runs

The sparse cell contract can carry `kind: string`, exact `value`, and ordered
`runs` with their own fonts. Rich text is not reduced to an unformatted string.
The shared schema checks joined text, XML-valid Unicode in each run/font name,
UTF-16 text limits, run count and aggregate edit text. Formula caches cannot own
submitted rich runs.

Edited rich strings are written inline as `r/rPr/t` in their original worksheet
cell. Shared-string entries, aliases, style indices and unrelated package parts
are immutable. Each text node preserves whitespace; literal OOXML escape-shaped
strings and carriage returns are encoded separately from XML escaping. The run
writer supports font name/family, size, explicit bold/italic/strike booleans,
underline type, superscript/subscript, and RGB/alpha, theme, indexed, tinted or
automatic colors. Direct source run-property recovery compensates for the pin's
rich-font reader losing indexed tints and misreading explicit false booleans.
The preview's additive `richTextMetadata: verified` identifies that source
normalization; older cached previews/journals cannot authorize existing-rich-cell
edits merely because their old font projection looks plausible.

Exact-font same-run text changes retain complete source run XML, including opaque
font extensions. Changed runs with unrepresented or ambiguous source properties,
phonetic annotations and other unsupported rich structures refuse the whole edit.
Normal fonts and inherited cell styles remain separate owners; this does not
promise font installation or rendering fidelity beyond the documented grid gaps.
Source digest checking, protected-sheet/signature restrictions, conditional
binary history and operation receipts remain the existing save boundary.
