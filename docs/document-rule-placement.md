# Editable divider block placement

This source checkpoint corrects the native Word divider's vertical placement in a bounded, qualified document container. It is not an immutable companion/renderer qualification or a claim of complete document fidelity.

## Problem and representation

The actual mixed document placed its native VML divider at approximately y316 instead of browser PDF y341 at 100 DPI. Changing paragraph spacing moved surrounding content or discarded intended spacing. A LibreOffice-resaved diagnostic identified an implicit paragraph-after wrap distance; copying that application's inline relative-size extension would not satisfy the native inline schema.

For a fitting, direct child of the canonical document's sole MAIN, conversion now emits an editable DrawingML line anchored relative to the actual rule line, with a half-stroke center. Existing paragraph spacing and all surrounding native text remain unchanged. Percentage widths remain margin-relative through `wp14:sizeRelH`; absolute widths stay physical. The exactly owned, projected VML remains the compatibility fallback. Generated drawing IDs are document-local; namespace bindings are local to the alternate-content wrapper. Only the native picture inside the exact paired source bookmark range may be replaced.

This qualification depends on the existing **preceding** `normalizeDocumentDocxPresentation` call in `documents.ts`. Its shared `documentColorLayoutQualified` accepts only the exact owned canonical stylesheet and trusted print profile, not an arbitrary document marker. A real extra `main{width:400px}` stylesheet was rejected before this producer on both main35fe and this candidate. Nested, oversized, inline-styled or hidden root/body/MAIN containers retain the prior VML path. This containment does not fix their existing layout fidelity.

## Source and consumer evidence

The source proof uses read-only worker/IIFE overlays on immutable renderer53 (`sha256:0a7bced276c8e1b435481e778b8e1ea202badb65855e290eb99ba82173fdc6fb`). It does **not** qualify a newly packaged pair.

- Twelve actual Word/PDF conversions: mixed large text, normal, adjacent, terminal/default-width, absolute240px and fractional33.3% rules. Source hashes stayed unchanged; independent ZIP checks verified anchors, unique IDs, legacy fallback and absence of generated bookmarks.
- Six LibreOffice24.2 conversions: every rule's four raster bounds stayed within the unchanged five-pixel threshold against browser PDF. Mixed Word bounds were x285–564/y340–341; PDF x285–564/y341 at100DPI. These are LibreOffice results, not Microsoft Word validation.
- Six independently constructed legacy-VML controls had exactly the same complete text bounding-box sequences as their modern counterparts. Two margin-edit controls changed40% width as expected while240px stayed physical. An independent differently colored Choice/Fallback probe proved the consumer used the modern drawing, not a coincidentally passing fallback.
- Actual container-boundary comparisons preserved the extra-stylesheet refusal. Hidden MAIN and HTMLinlinewidth were previously accepted by Word despite differing PDF layout; new guard regressions genuinely failed before correction. Three guarded Word conversions confirmed those containers now keep the old path, with no modern anchor.

Scratch evidence: `/tmp/document-rule-drawing-source-proof/{qualification.json,office/qualification.json,office/controls-qualification.json}`, `/tmp/document-rule-spacing-probes/choice-consumption.json`, `/tmp/document-rule-container-probe/results.json`, `/tmp/document-rule-container-guarded/results/results.json`. These are local author receipts, not distributed assets.

Focused source tests cover exact range refusal, native-container mismatch, source-container exclusions, namespace collisions, local IDs, absolute/percent/default width and explicit color preservation. Checks are recorded in the author handoff; integration must refresh current main and the separately reviewed image-owner checkpoint before packaging.

## Remaining fidelity and release gates

Actual matched immutable-pair conversion, packaged browser qualification and Microsoft Word behavior remain unverified for this checkpoint. Nested/oversized or otherwise unqualified source layouts remain on the old path. The reviewed image-owner slice is separate and must be integrated normally before any package is prepared.

The mixed pages still differ in glyph baselines, table borders/header weight, links, list details and page furniture. This correction preserves divider width, ink, editable percentage intent and qualified block placement; it does not establish complete typography or rich-block parity. Arbitrary stylesheet and hidden-container fidelity remain open rather than being silently relabeled supported.
