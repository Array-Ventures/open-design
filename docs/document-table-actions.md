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

The focused suite passed 48 cases across the new actions and existing document
editor/HTML tests; plain web TypeScript and the repository guard passed.
Browser visual checks in both themes, narrow viewports, touch scrolling and
post-edit exports are still required. The supplied Claude reference captures
showed ordinary document/presentation panels, not an open table context menu;
this work does not claim observed right-click parity or completed visual
qualification. Presentation-object and slide-structure actions remain separate.
