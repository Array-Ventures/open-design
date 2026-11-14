# Source-owned image-only heading lines

This checkpoint corrects the native Word placement of a single small baseline image in a qualified heading. It is an incremental export fidelity improvement, not general image-layout parity.

## Cause and ownership

The previous first-heading proof retained a real pixel failure: at 100 DPI the native Word image occupied `[88,78,111,103]`, while browser PDF occupied `[75,90,99,115]`. Complete ZIP copy probes isolated two independent defaults:

- Explicit zero DrawingML inline distances correct the horizontal offset.
- The existing `atLeast` paragraph line rule places an image-only heading higher than the browser's fixed heading strut. Keeping the same measured line height with `exact` corrects the vertical offset. Explicit inherited run/paragraph fonts, text alignment and top distance did not correct it. An added zero-width text strut was investigated but is not shipped.

The source annotator binds the actual `IMG` to its existing heading owner with a collision-checked temporary attribute. The contained DOM adapter qualifies only one baseline image, no substantive text, a single measured line, matching inherited font context, no repositioning and an image that fits the line and physical print content width. The physical bound comes from the existing Letter/margin export profile; the normalizer's viewport and source CSS remain unchanged. One Chromium layout quantum (1/64 CSS px) is allowed when comparing its box and computed line height.

The Header AST must contain exactly that generated image identity. The native bookmark must delimit exactly one heading paragraph, with one embedded DrawingML picture and matching original dimensions. Only that image receives zero distances, and only that paragraph receives the measured exact line. First-heading `before=0` is a separate receipt; later heading margins and unrelated properties are retained. There are no source-added text struts, image raster substitutions or global drawing changes.

Tall/overflowing images, mixed text, multiple images, non-baseline alignment, no-wrap and changed inline font contexts do not receive this projection. Their previous behavior remains; their visual fidelity is not claimed. Paragraph images and mixed text/image lines remain next work, alongside the separately observed divider block-placement gap.

## Evidence and limits

The genuine shared-adapter RED expected the missing measured image receipt. Final focused checks cover eligibility, one-quantum bounds, wide responsive images, wrong image IDs, partial metadata, changed native dimensions, text, multiple/floating drawings and preserved native properties. Source-owned first-heading tests remain intact.

Actual contained source-worker proofs used local fake documents, original valid PNG bytes, network-disabled read-only containers and normal cleanup. These were **source worker/IIFE overlays on immutable renderer 53**, not a newly packaged image:

- Eighteen Word/PDF conversions covered fitting H1–H6 images, a neutral nested span, tall images and mixed text. Fitting cases use exact lines; tall and text cases retain their inherited `atLeast` rule. Source hashes and embedded image bytes were unchanged.
- Two additional conversions exercised the final stricter native picture/blip ownership checks.
- Seven independent LibreOffice 24.2 conversions covered H1–H6 and the nested case. Every original image-position oracle remained **less than five pixels on all four bounds**. H1 and the nested case produced Word `[75,91,99,116]` versus browser `[75,90,99,115]` at 100 DPI. DOCX hashes were unchanged by LibreOffice.

![Native Word rendered by LibreOffice](images/document-heading-images/word-libreoffice.png)
![Browser PDF](images/document-heading-images/browser-pdf.png)

Scratch evidence: `/tmp/document-image-context-probes`, `/tmp/document-image-context-qualified-proof/{qualification.json,office/qualification.json}` and `/tmp/document-image-context-final-guard/qualification.json`. Earlier failed evidence remains: the original image pixel RED; incomplete initial scratch ZIP copies (invalid consumer evidence); an initial harness assumption that required a local line rule rather than resolving the inherited Heading style; and the conservative H5 eligibility miss before accounting for Chromium's layout quantum. No assertion threshold was relaxed.

Microsoft Word itself and a newly packaged companion/renderer pair remain unverified. The screenshots show the owned fixture only. This does not qualify arbitrary image positioning, all typography, tables, links, lists or page furniture.

Author checks: 38 shared document-style tests, 74 focused daemon tests, full workspace typecheck, final daemon/test typecheck and repository guard passed. There was no runtime restart, packaged image build, publication or production change.
