# Preserve visible frontmatter-like Markdown

The document browser uses micromark with the GFM extension, without YAML
frontmatter. Its only document metadata contract is the validated
`<!-- eve-document:... -->` directive. No YAML font/title metadata contract was
found in the source or document documentation.

Pandoc's default GFM reader enables `yaml_metadata_block`. Before this fix the
committed `document-visible-frontmatter.md` fixture exported only `After.`,
silently losing its visible title text. The document preparation reader now
explicitly disables that extension; no generated divider or Markdown body is
rewritten. The same fixture becomes a horizontal rule, a setext heading containing
`title: Visible paragraph`, and the following paragraph, matching the actual
browser parser's semantic tags and text. Blank-separated dividers still produce
two rules with the visible title paragraph between them.

## Evidence and limits

A real network-disabled container using immutable renderer53
`sha256:0a7bced276c8e1b435481e778b8e1ea202badb65855e290eb99ba82173fdc6fb`
ran its bundled `/usr/local/bin/pandoc` with `--sandbox --to=html --wrap=none
--fail-if-warnings`. The original `--from=gfm+raw_html` failed the visible-content
assertion. Changing only that argument to
`--from=gfm+raw_html-yaml_metadata_block` passed the independent HTML-parser
comparison with actual micromark/GFM, plus the two-divider control. Containers
exited normally and were removed. Scratch receipts are in
`/tmp/gfm-visible-frontmatter-proof/{before,after,browser,divider-after}.html`
and `qualification.json`.

This is actual converter evidence for the argument change, not qualification of
a newly built immutable worker or a full Word/PDF export. The new daemon unit
regression separately verifies the fixture reaches the converter unchanged and
that document preparation selects the explicit reader; its converter output is
mocked and is not presented as fidelity evidence. Both affected daemon test
files pass (five tests), as do full workspace types and guard. No runtime,
production, publication, pins or shared preview changed.
