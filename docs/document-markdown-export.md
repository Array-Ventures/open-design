# Structured document Markdown export

The export adapter normalizes a copy of marked document HTML before Pandoc;
the saved source and conditional write owner remain unchanged. Ordinary editor
`white-space: pre-wrap` spans with no other attributes and no sensitive whitespace
are removed. A rectangular, unmerged table whose first row contains only TH
cells gains a semantic THEAD in the export input. This prevents Pandoc from
inventing an empty Markdown header above the actual column titles.

Other attributed spans retain their original HTML through Pandoc's native JSON
AST `RawInline` nodes. Temporary conversion identities must each appear exactly
once; missing or duplicate owners refuse conversion. This preserves downloaded
HTML fragments, including repeated spaces, tabs, newlines and authored styles,
instead of silently collapsing their text in Pandoc's HTML reader. Nested
protected spans remain inside their original parent fragment.

Two normalization regressions failed before the fix. Eleven focused adapter
tests pass, covering semantic headers, retained complex tables, attributed and
whitespace-sensitive spans, missing/duplicate owners and existing document
exports. Actual Pandoc in the existing isolated renderer image converted the
owned saved document to clean tables and paragraphs; a separate styled-text
probe retained its exact repeated spaces/newline and leaked no temporary IDs.
Daemon types and repository guards are checked separately.

This source change needs a new renderer build and complete UI export checks.
The styled-fragment proof concerns downloaded Markdown bytes. Pandoc's existing
GFM-to-HTML import can still collapse whitespace inside inline raw HTML on
reimport; that round-trip limitation remains open and is not covered by the
export proof. Full document/type/theme/export parity is not established here.
