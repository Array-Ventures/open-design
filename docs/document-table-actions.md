# Structured document table actions

In Editing mode, a table cell offers a compact BoardUI context menu: insert a
row above/below, insert a column left/right, delete the selected row/column, or
delete the table. Right-click targets the actual cell under the pointer;
Shift+F10/Context Menu uses the Lexical selection and anchors at that cell. A
stationary long touch opens the same menu. Actions target the captured cell
(and disclose a merged cell’s extent); bulk multi-cell commands are not added. Normal document text and Viewing
mode retain the browser context menu.

The source remains a Lexical document. Actions use the pinned public merge-aware
`@lexical/table` selection helpers, normal history and the existing conditional
HTML/Markdown writer. They do not edit a rendered DOM table behind Lexical or
introduce another save mechanism. One Undo restores each action. Deleting the
final row/column removes its table and leaves an editable paragraph if the
document would otherwise be empty.

A merged cell can cover several rows or columns. The menu explicitly names that
extent (`Delete 2 rows`, for example), matching Lexical's deletion semantics.
Opening captures the cell/table keys and spans; execution checks attachment,
parentage, spans and current editability before restoring the cell selection.
A stale menu cannot silently act on the old caret or a replacement table.

The free BoardUI context-menu adapter is shared through the existing embedded
component boundary. Its optional target/keyboard callbacks do not contain
workbook commands or grant source authority. Existing zero-argument opening
checks remain compatible.

## Qualification boundary

Real DocumentEditor/Lexical tests cover pointer-versus-adjacent-caret targeting,
all actions and Undo, stale/read-only targets, keyboard/Escape/touch opening,
merged insertion/deletion and neighbour retention, final-dimension removal,
HTML identities and Markdown serialization/reimport. Markdown tables that no
longer fit the simple pipe-table form use the existing HTML fallback.

The integration passed 58 focused cases across the table actions, existing
document editor/HTML tests and shared workbook menu tests. The latter retain
native keyboard capture, zero-argument admission checks and source-reset
dismissal; a combined regression also checks selected-cell anchoring and actual
gesture targets after reset. Plain web TypeScript and the repository guard
passed.
Browser visual checks in both themes, narrow viewports, touch scrolling and
post-edit exports are still required. The supplied Claude reference captures
showed ordinary document/presentation panels, not an open table context menu;
this work does not claim observed right-click parity or completed visual
qualification. Presentation-object and slide-structure actions remain separate.

## Chromium border-default roundtrip

The owned browser save/reopen check on companion 95 exposed a real admission
mismatch: Chromium expands Lexical's canonical cell `border: 1px solid black`
into side declarations and five `border-image-*` longhands whose values are
`initial`. The admission rule now accepts only those exact five initial defaults
on canonical-border table cells. Noncanonical or mixed borders, custom images,
nondefault values, important declarations and unknown styles remain refused;
a later initial value cannot hide an earlier authored image declaration.

The regression includes the actual saved fixture verbatim and explicit expanded
declarations so the policy is exercised under jsdom as well as Chromium's
implicit expansion. Five per-longhand admission assertions failed before the
fix; the final focused suite passed 111 cases across admission, table actions,
existing editor and HTML serialization. Web types and guard passed. A new
companion build must still qualify actual Chromium save/reopen; this source
change does not claim that later browser result.

The declaration-level guard also checks the authored `border-image` shorthand
before CSSOM normalization: only the existing `none` default is eligible; URL
or other authored shorthand values are refused even when a later canonical
border would reset them. The additional URL/override negatives already passed
in pinned jsdom before this guard, so they are not claimed as a reproduced
Chromium failure. Actual browser CSSOM evidence motivated the stricter raw
declaration check; new-build Chromium qualification remains necessary.
A separate public-admission regression explicitly supplies a normalized `none`
CSSOM reading while retaining the raw image shorthand. That policy test failed
with the raw shorthand guard removed and passed with it restored; it simulates
the normalization seam rather than asserting jsdom is Chromium. Final focused
qualification passed 115 cases across the four files, plus web types and guard.
