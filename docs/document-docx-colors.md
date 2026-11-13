# Editable Word authored-color projection

The Word export pipeline resolves conversion-only source owners through the
contained browser's shared color adapter, then retains native Pandoc JSON and
editable OOXML. It never matches cells or runs by their text. Temporary data
attributes leave authored IDs intact; Pandoc's normalized attribute is removed
before Word conversion. Generated native bookmark pairs identify the exact
cell/run owner and disappear only after verified projection.

Every requested source ID requires a normalized descriptor, including an
explicit empty descriptor. Every nonempty color owner must survive uniquely in
the AST and OOXML. Ordinary CODE/PRE parsing may discard a neutral wrapper with
an empty descriptor while keeping native code semantics. An otherwise identical
colored owner that disappears is refused; unsupported colors must not become
empty descriptors to avoid that refusal.

Cell shading retains exact rowspan/colspan ownership, including verified native
vertical-merge continuations. Single-row owners refuse unexpected merge state.
Inline foreground and background use native run properties, preserving nested
precedence, bold/italic content, hyperlink relationships and unrelated bookmarks.
Only explicitly introduced marker-only paragraphs can be removed. Existing
empty paragraphs survive and cells retain their required terminal paragraph.

## Qualification

The helper tests cover mixed runs/hyperlinks, nested precedence, unknown or
missing owners, crossing/duplicate markers, unrelated bookmarks, authored empty
paragraphs/cells, and native merge continuation geometry. A recorded fixture
comes from the pinned converter's actual JSON-to-DOCX output before projection.

Actual contained converter probes established that the unprojected output had
no authored shading/foreground, and the projected editable package retained the
expected cell/inline fills, red bold and hyperlink runs, native merge geometry,
and empty-cell structure. A separate source-annotation probe retained authored
IDs and ordinary code while removing temporary source attributes.

These core probes do not yet qualify the complete browser-normalizer/export
integration, real UI downloads or rendered Word appearance. Those remain gates
before reporting the authored-color export fix complete. Source documents are
not rewritten by this conversion-only projection.
