# Source-owned Word code-block spacing

Actual immutable126 code fonts were correct, but canonical PRE padding and
margins were absent from its editable SourceCode paragraph. For the canonical
fixture, browser PDF placed BLOCK_CODE at (66.00,105.00)pt and the following text
at y160.08pt; the downloaded Word document rendered through LibreOffice at
(54.10,95.01)pt and y143.08pt. The original source and outputs remain under
`/tmp/document-code126-ui` and `/tmp/document-code-block-geometry-proof`.

This correction measures an optional code-block receipt in the existing physical
672px print pass, after the existing stylesheet ownership check. The original
1280px font/color measurement and browser PDF remain unchanged. Only a direct
PRE in the sole unstyled canonical MAIN/BODY, with fitting preformatted text,
known paragraph/heading/PRE neighbors and first-page geometry, receives a
receipt. It records actual padding, collapsed neighboring margins and line count.
Unknown containers, inline PRE layout, classes, overflow, pagination, tabs and
other unqualified contexts retain their previous export behavior. This is not
full arbitrary code-layout support.

The same source attribute binds the actual Pandoc CodeBlock. A generated native
bookmark range must enclose exactly one direct body SourceCode paragraph. Native
text and line count must match the bound AST exactly, including pinned Pandoc's
soft-hyphen representation. The projector sets only that paragraph's schema-ordered
left/right indents and before/after spacing; it retains fonts, run paint,
paragraph line minimums and unrelated bookmarks/properties. Conflicting native
indent/alignment, missing/crossed/outside owners, extra paragraphs, drawings and
page breaks refuse. No source bytes, global Word styles or visible struts change.

## Author qualification

The initial protocol regressions failed before implementation. Some malformed
native cases initially failed while constructing the unsupported receipt; they
are final refusal guards, not evidence that old code accepted those inputs.
An actual pinned converter probe exposed U+00AD becoming w:softHyphen; the new
strict native text reader genuinely refused it before its positive correction.
Logs are `document-code-block-geometry-{red,soft-hyphen-red}.log` under `/tmp`.

Four owned canonical cases (ordinary, first, adjacent and terminal PRE) passed
actual Word and PDF conversion with read-only worker/helper source overlays on
immutable126/69. Independent ZIP checks proved owned indents (12pt), margin
projection, SourceCode/VerbatimChar, 10.5pt code, unchanged source SHA and removal
of temporary markers. Four unchanged DOCX copies were rendered through one
isolated LibreOffice profile. Ordered code/following-text glyph bounds passed
the unchanged five-pixel-at-100DPI oracle against browser PDF. Both adjacent
pages were personally inspected:
[browser PDF](images/document-code-geometry/browser-pdf.png) and
[LibreOffice from editable DOCX](images/document-code-geometry/libreoffice-docx.png).

For the ordinary case the corrected Word code starts at (66.10,107.01)pt and
following text at y162.58pt. The residual approximately 2–2.5pt vertical offset
also exists in surrounding body text. Actual Linux PDF and LibreOffice both use
DejaVu Sans/DejaVu Sans Mono; a font-face explanation has not been established.
Page headers/footers, pagination and Microsoft Word appearance remain unqualified.

Receipts, exact bounds and original diagnostics are in
`/tmp/document-code-block-geometry-proof/producer-consumer-bounds.json` and
`producer/*/qualification.json`. Final-source ordinary conversion produced
byte-identical parts to the personally viewed editable package
(`final-native-equivalence.json`). These are source-overlay proofs, not a new
immutable pair, UI qualification or a change to runtime128/71.

All containers used network none, read-only inputs and bounded CPU/memory, then
exited/removed normally. LibreOffice used a unique owned profile and exited;
DOCX inputs remained unchanged. No image/application build, runtime, publication
or installer pin changed.

Final focused author checks passed 102 daemon cases across six files and 79
shared cases across seven files; full workspace types and guard also passed.
The larger 16pt child-CODE paint control still exports red/yellow and 16pt native
runs, but receives no geometry receipt because its expanded browser line box is
not represented by the simple measured-line contract. An initial scratch oracle
incorrectly expected new indents for that unqualified control and failed; its
native result demonstrates preserved prior behavior, not placement parity.
A second default-sized red/yellow CODE control passed actual final-source Word
and PDF conversion with the new native indents/margins and paint intact
(`final-producer/paint14/qualification.json`). Its consumer appearance is not
separately qualified; the four plain-code consumers above establish the bounded
spacing claim, and the preceding paint checkpoint establishes glyph shading.
