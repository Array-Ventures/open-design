# Source-owned first heading margins

The canonical document CSS sets `main > :first-child` top margin to zero.
A global Word Heading1 style cannot represent that source context: the measured
mixed fixture inherited 360 twips (18pt) before its first heading. Its Word glyph
top was 74.56pt versus 55.403318pt in browser PDF. That 19.156682pt gap was not
explained by the smaller ordinary-text baseline offset in the earlier geometry
checkpoint.

## Exact source heading ownership

Original H1–H6 elements receive conversion-only IDs before measurement, without
adding layout wrappers. The private presentation request has a `heading` kind.
Only the direct first element of the sole canonical `BODY > MAIN`, with actual
computed `marginTop:0px` under the existing qualified styles, receives the paired
level/zero-before/canonical-first-block descriptor. Later headings and unknown
wrappers remain empty. No additional stylesheet or source margin is admitted.

The Header AST's attributes carry that same generated ID. Its exact native
bookmark range must belong to one matching `HeadingN` paragraph; AST/native level
mismatch, missing/duplicate/crossing ownership or paragraph ambiguity refuses.
Only that paragraph's before spacing becomes zero. Global heading styles,
after spacing, line minima, formatting, native images and unrelated paragraphs
remain intact. This is not a first-native-paragraph heuristic.

Geometry belongs to the heading, not every child text span. Leading/trailing
collapsed whitespace remains an empty text descriptor that can be unwrapped;
image-only headings have an independent block owner even without text runs.
Source HTML/IDs are unchanged. Worker and IIFE must remain a matched private
presentation implementation.

## Evidence and remaining image gap

Four genuine shared-policy cases failed against the prior implementation, then
passed. Focused qualification passes 33 shared tests and 109 affected daemon
tests, full workspace types and guard. Tests include plain/nested-whitespace/
image-only heading ownership, wrong kind/level/provenance, AST/native level
mismatch, crossing paragraph boundaries and preserved unrelated/later paragraphs.
An initial invocation before dependencies were installed is retained separately
as a harness failure, not counted as the genuine RED.

Actual source worker/IIFE overlays on immutable renderer53 passed ten Word/PDF
conversions across plain, nested italic whitespace, image-only, later-heading and
mixed fixtures. Native XML verifies only the owned first margin is zero while
global Heading1 before remains 360. The valid PNG's original bytes and native
DrawingML survive. Source SHA values are unchanged and containers exited normally.
These are source proofs, not a newly qualified immutable pair.

Isolated LibreOffice consumers pass the plain/nested/later/mixed margin lanes.
Word-minus-PDF first-heading glyph-top differences are now 1.156682pt (plain and
mixed) and 0.392043pt (nested italic). The known 18pt extra source-context margin
is removed; font-engine baseline/kerning differences remain. Microsoft Word has
not been tested.

The image-only **visual position oracle remains FAILED**, not skipped or changed:
new Word blue bounds are `[88,78,111,103]` versus PDF `[75,90,99,115]` at 100DPI.
A baseline with the frozen font checkpoint's worker gives `[88,103,111,128]`:
the zero-margin correction removes exactly 25px (18pt), exposing an existing
native image alignment difference rather than creating a new paint offset.
Native XML contains no preceding text/whitespace, indentation, justification or
run baseline shift, and effect extents are zero. A scratch copy with explicit
inline image distances set to zero fixes horizontal placement to `[75,78,99,103]`
but leaves the vertical difference. No production image patch was made from that
probe. Exact image-context fidelity is the next bounded slice; native image
preservation is distinct from paint parity.

Receipts: `/tmp/document-first-heading-source-proof/qualification.json`,
`office-summary.json`, `image-visual-failure.json`; baseline/probe files are in
`/tmp/document-heading-image-baseline43` and
`/tmp/document-heading-image-distance-probe`. All containers and isolated office
processes exited normally. No application runtime, image build, production,
publication or pins changed. Table/header paints, link decoration and broader
rich-block fidelity remain explicitly outside this margin correction.

The later [image-only heading checkpoint](document-heading-images.md) isolates and corrects a bounded subset of the retained image paint gap. The original failed oracle above remains evidence for this checkpoint; the later source/LibreOffice proof is separate and does not claim general image fidelity or a new packaged pair.
