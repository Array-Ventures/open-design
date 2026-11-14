# Document print geometry and authored sizes

The canonical browser print view is the authority for this unpublished source
checkpoint. Its styles are unchanged. Earlier Word defaults independently chose
Arial/Georgia, 11pt body text, approximately 1.079 line spacing and implicit page
margins. Actual browser PDF used 15pt body text and 54pt margins, with DejaVu font
fallbacks in the contained renderer. Both comparison rasters were 100DPI Letter;
the size mismatch was not caused by screenshot scaling.

## Shared profile and native ownership

A single internal print profile now supplies browser print constants, Word
reference defaults, page dimensions and owned divider geometry. Native Word uses
Letter 612×792pt and 54pt page margins. The current contained renderer's generic
sans/serif defaults resolve to DejaVu Sans/Serif; Word names those same installed
faces instead of requesting different fonts. Fonts are referenced, not embedded.
A Word application without those fonts may substitute; that application has not
been qualified here.

Word defaults use 15pt body text, a minimum 22.5pt line box and 15pt paragraph
spacing after. `atLeast` line spacing permits larger authored runs to grow rather
than clipping them. Default heading sizes/spacing follow the existing print CSS.
Stock reference-only heading colors/italics are removed; authored run formatting
is retained. Native properties are inserted in sequence order. Only the single
final converter-owned section receives page geometry; ambiguous/multiple sections
refuse rather than rewriting arbitrary section layouts. Existing unrelated
section properties remain intact. Divider paragraphs use a 0.75pt line box and
18pt margins rather than inheriting a text-sized empty line.

Physical profile points are converted to supported browser API units: the PDF
margin is still `0.75in`. An early author attempt to pass `54pt` was rejected by
the real PDF API and is retained in the failure evidence; native XML still uses
1080 twips for that same physical margin.

## Authored inline fonts

The existing neutral text IDs and exact native bookmark ownership now carry one
normalized **presentation** descriptor, not parallel color/font protocols.
Primary APIs use presentation names; older source-import names are aliases.
This private worker/IIFE payload must be built as a matched pair; old `colors`
objects are not accepted as an alternative descriptor.

Only the editor's existing inline font-size syntax (px/pt/em/rem/percent) is
admitted. One pure pattern is shared with the editor. Actual browser measurement
provides point size and minimum line height, with authored provenance. Word
measurement installs the same unchanged trusted print CSS before resolving
relative units. Consequently `2em` at the print body is 40px, while `2rem` still
uses the 16px HTML root and is 32px. No new stylesheet is trusted.

Each font descriptor requires finite positive size ≤1638.5pt, finite positive
line height ≤3277pt, and the exact authored provenance. Wrong kinds, incomplete
pairs, unknown fields and unavailable/`normal` measurements refuse. Line minimum
includes the actual source block's strut, so a smaller span cannot shrink its
parent's default line. Native projection retains bold, italics, hyperlinks,
shading, language and superscripts; it sets `sz` and `szCs` only in the exact
owned runs, then takes the maximum measured minimum for each paragraph. Other
paragraph properties and margins survive. Traversal order cannot let a later
small owner overwrite an earlier large minimum.

Font-only owners remain nonempty throughout normalization, AST and native output.
If a code/whitespace owner disappears, export refuses instead of discarding its
formatting. Source HTML and its IDs remain unchanged.

Computed CSS serialization can turn exact 16pt into `21.3333px` and hence
15.999975pt. Only values within 0.0001pt of a native half-point are normalized to
that exact half-point; quarter points and other precision are not broadly
rounded. Non-near values use lossless decimal numeric serialization, including
tiny finite positive values; scientific notation and accidental `0pt` output
are not emitted. Both threshold sides are tested. This is an explicit measurement
tolerance, not an exact-match claim for arbitrary decimal source fonts.

## Actual evidence and remaining limits

Independent review caught a WIP heading-policy regression before this checkpoint:
the shared-profile generator used 1.25 for h2/h3 instead of the established
1.3/1.4. The genuine exact-CSS regression failed, then passed after restoring
those ratios and native line minima to 585/525 twips. Actual contained DOM
measurement under the original CSS also verified h4–h6 sizes, lines and margins.
The initial mixed-heading source proof is retained as pre-correction evidence;
its heading appearance is not authoritative. The affected Word/PDF mixed lane
was rerun under corrected source; the other six conversions do not use h2/h3.
The corrected lane receipt is `/tmp/document-font-corrected-heading-proof/qualification.json`.

The real original mixed-font conversion dropped the authored 40px `LARGE` run
size entirely. The corrected exact-owner projection preserves it as 60 native
half-points. Actual fixtures also verify 2em→60, 2rem→48, 150%→45, nested
outer/inner/tail→60/30/60, linked size→45, and exact 16pt→32. The pre-tolerance
15.999975pt native output remains in `/tmp/document-font-source-proof-rounding`.

Source worker/IIFE overlays on immutable renderer53 (not a new immutable
pair) initially passed eight Word/PDF conversions across four owned fixtures: ordinary
rules, mixed headings/large text/lists/tables/Unicode, swapped font categories,
and authored relative/point sizes. Independent native XML checks retain source
text, formatting, page sizes, font sizes, line minima and links; all source SHA
values remained unchanged. Isolated LibreOffice converted all four unchanged
DOCX files. The actual 16pt PDF font command and glyph-height ratio close the
precision regression. Word and browser PDF ordinary block spacing now both
measure 59.25pt, compared with the earlier 43.3pt versus 59.25pt. Receipts are in
`/tmp/document-font-geometry-source-proof-final/{qualification,office-qualification}.json`.

Native explicit point measures retain fractional default heading sizes in valid
Office 2010+ XML. The primary Open XML SDK [schema metadata](https://raw.githubusercontent.com/dotnet/Open-XML-SDK/main/data/schemas/schemas_openxmlformats_org_wordprocessingml_2006_main.json)
permits that unit form; Office 2007 numeric-only compatibility is not claimed.
Actual LibreOffice 24.2 rendered an 18.75pt native declaration as 18.5pt. Its
consumer quantization is still open, and Microsoft Word has not been tested.
Residual glyph-baseline/kerning differences remain even for the same font; the
scratch ordinary-text probe showed about 2.5pt glyph-top offset and 0.1pt left
placement difference. These are not presented as pixel parity.

Specialized SourceCode/VerbatimChar typography remains the next bounded slice:
stock Word still gives inline and block code the same 11pt character style while
canonical HTML gives them context-dependent sizes. Table padding, list indents,
page furniture and arbitrary authored font families are not qualified by these
default/size proofs. Content preservation is distinct from complete rich-block
layout parity. All proof containers and isolated office processes exited normally.
No image build, application runtime, production, publication or installer pin was
changed by this source qualification.


The later [source-owned first-heading correction](document-first-heading.md)
addresses an additional 18pt first-heading context margin that the ordinary-body
baseline measurement did not cover. It records the corrected text lanes and an
open image-only paint-position failure; neither checkpoint claims complete
heading/image/rich-block parity.
