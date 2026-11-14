# Structured document dividers

The authorized reference document exposes Divider in its More insertion menu.
The import sanitizer already admitted `hr`, but the full document admission gate
kept such files in their original read-only viewer. The editor itself did not
register a rule node and its direct component path dropped imported rules.
There was no insertion action. The initial three component cases failed against
that source. The actual 109 browser check showed the original static rule and
neighboring text, with no editable textbox; it is a feature-availability RED,
not evidence that the guarded application lost source content. Three admission
cases also failed before the bounded rule admission was added.
A further authored-presentation case failed against the first plain SDK
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

Admission adds rules, stable IDs and supported width/color/background only;
unknown styles, contextual colors, important declarations and unsupported rule
attributes retain the read-only fallback. Source acceptance covers imported
HTML and Markdown rules, unrelated edits,
stable identities after save/reopen, real SDK insertion/Undo/Redo, and supported
authored width/color/background through both formats. The insertion test checks
the SDK's deliberate following empty paragraph and unchanged neighboring text
and identities. Its initial assumption that the document had no outer `main`
wrapper was corrected; the stricter final assertion checks the real content
container and all inserted block contents.

The initial source checkpoint passed 41 document/import/Markdown cases
(including six divider cases). After adding bounded admission, 130 affected
editor/import/Markdown/admission cases passed, along with full workspace types
and repository guard.
The initial script invocation put a filter after an extra `--`; it was stopped
with exit 143 and is not counted as qualification. All recorded focused results
use the explicit `vitest run ... tests/...` invocation instead.

Review also checked two apparent compatibility concerns rather than changing
source on assumption. Real Chromium normalizes uppercase CSS property names;
the preceding importer canonicalizes them before this node. jsdom's CSSOM drops
uppercase declarations, so the component fixtures retain normalized styles and
the packaged browser fixture uses authored `WIDTH:40%` for actual acceptance.
That browser fixture has not passed against the new candidate yet.

The exact existing renderer52 Pandoc command preserved both rules and visible
text for the serializer's blank-separated leading-rule layout. Its extension
inventory enables YAML metadata, but the generated blank-separated shape did
not become metadata. A separate tight, externally authored front-matter-shaped
input did lose the visible title/rules through that converter. This existing
GFM/UI/export parity gap remains a separate follow-up; it is not a reason to
claim this serializer reproduced that failure or silently change its syntax.

This is an implementation checkpoint, not completed feature qualification.
Actual packaged browser interactions, both-theme/wide/narrow visual checks,
conditional-write conflicts, native Word/Markdown/PDF downloads and independent
export inspection remain required. No renderer image, preview activation,
installer pin, archive publication or production update is included here.
