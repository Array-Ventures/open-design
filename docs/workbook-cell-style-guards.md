# Workbook cell style preservation guards

`WorkbookCell.style` in a scalar edit is a preservation guard, not an authored
formatting change or raw OOXML XF index. The reader interns normalized styles
into a compact table. Deleting a worksheet or axis can remove the first use of
a style and change these ordinals even though every retained raw XF is unchanged.
Historical templates can also share unchanged raw style resources while the
current reader's compact ordinals refer to different styles.

The prepared source still accepts its exact style guard as before. A different
original guard is rebound only when the exact original cell and validated row/
column projection identify the prepared cell, both reader-normalized styles are
identical, and the qualified current stylesheet remains byte-identical through
membership/axis preparation. Historical templates first qualify their raw
global-resource prefix against the current source. Guard context retains only
the selected sheet, normalized styles and shared current stylesheet, not a full
historical ZIP for every restored ID.

New/blank coordinates cannot borrow a neighboring cell's style. Unknown indices,
non-equivalent original styles and changed raw resource owners still refuse.
The existing strict cell patch guard is unchanged; only an internal cloned
annotation receives the prepared ordinal. The caller's serialized plan/hash and
the raw worksheet style attributes remain untouched. Intentional font/fill/color
changes continue through the separate formatting adapter.

Actual source regressions cover restored scalar edits after unrelated survivor
formatting, styled survivor edits after sheet deletion, ordinary structural
reparse, restored axis projection, exact prepared-preview guards and separate
formatting. Negative cases cover wrong/unknown guards, absent or inserted source
coordinates and incompatible historical resource prefixes. This source fix does
not enable automatic SDK worksheet Undo or change its remaining ownership gates.

The restored-plus-survivor positive case also opens the emitted XLSX through
ExcelJS independently to check values and historical Arial/bold/11-point ink.
Pinned ExcelJS truncates font sizes through its integer reader, so an independent
Python ZIP/XML check follows the emitted survivor cell's XF/font index and
requires the exact `22.25` size. This avoids treating that reader limitation as
proof of fractional-size loss or allowing it to hide a source-writer regression.

## Main integration qualification

The source branch merged fork main `8dac5a69` without conflicts. The original
style-guard implementation and independent readback test are unchanged from
`085806ca`; this refresh incorporates the reviewed document/readiness baseline,
not a new style policy. On that integrated tree, ten distinct daemon suites
passed 96 cases: restored style ownership, sheet templates, sheet asset rendering,
style patches, workbook rendering, structural patches, sheet patches, resource
continuity, structural calculation chains and calculation proof. Full workspace
root typecheck (including daemon) and repository guard passed after a frozen
install. These are author source/worker checks; no new immutable renderer,
contained pair, runtime activation or publication was performed.
