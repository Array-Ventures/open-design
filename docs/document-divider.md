# Structured document dividers

The authorized reference document exposes Divider in its More insertion menu.
Evebot previously admitted `hr` through sanitization but did not register a
Lexical rule node: an unrelated edit could drop an imported rule, and there was
no insertion action. The initial three component cases failed against that
source. A further authored-presentation case failed against the first plain SDK
node implementation because it lost the rule's supported width and colors.

This implementation registers the SDK horizontal-rule plugin and extends its
node to retain declarations already admitted by the document sanitizer. It
reuses SDK insertion, selection and Undo/Redo rather than adding a separate
history. The default line and selection ring use semantic theme tokens. The
existing More menu gains one Divider entry.

Rules participate in the same block identity ownership as other document nodes.
Plain rules serialize as Markdown `---`; authored supported presentation uses
an HTML `hr` inside Markdown. The bounded metadata schema gains an optional
`document-divider` identity group. Body receipts still control identity restore.
An older editor cannot be assumed to preserve these new nodes or metadata; the
matching companion and renderer must be qualified together before distribution.

New divider IDs use a separate deterministic numbering space for unchanged
source imports. The initial naive registration renumbered later paragraphs;
its regression failed before this correction. Existing paragraph IDs and an
exact pre-support comment anchor after the rule now remain resolvable without
rewriting the source. Later inserted rules use the ordinary new-block owner.

Source acceptance covers imported HTML and Markdown rules, unrelated edits,
stable identities after save/reopen, real SDK insertion/Undo/Redo, and supported
authored width/color/background through both formats. The insertion test checks
the SDK's deliberate following empty paragraph and unchanged neighboring text
and identities. Its initial assumption that the document had no outer `main`
wrapper was corrected; the stricter final assertion checks the real content
container and all inserted block contents.

Focused validation passed 41 document/import/Markdown cases (including six
divider cases), separate web types, full workspace types and repository guard.
The initial script invocation put a filter after an extra `--`; it was stopped
with exit 143 and is not counted as qualification. All recorded focused results
use the explicit `vitest run ... tests/...` invocation instead.

This is an implementation checkpoint, not completed feature qualification.
Actual packaged browser interactions, both-theme/wide/narrow visual checks,
conditional-write conflicts, native Word/Markdown/PDF downloads and independent
export inspection remain required. No renderer image, preview activation,
installer pin, archive publication or production update is included here.
