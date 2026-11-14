# Divider export ownership

The divider editor source admits stable block IDs and bounded width/color/
background-color presentation. The earlier shared color qualifier refused every
HR attribute. Simply admitting those attributes would lose presentation: actual
Pandoc HTML→JSON drops them, and its default Word output contains only an
unstyled native VML horizontal-rule rectangle.

## Bounded conversion

The shared qualifier now permits HR identity and only width, color and
background-color. Unknown classes, layout declarations, variables and image
backgrounds remain refused. The divider color request is separate from text:
it reads the actual computed rule ink without a text-contrast heuristic,
retains authored/inherited provenance, and uses the existing effective-background
and alpha-compositing helpers to produce opaque export colors. Source bytes do
not change.

Only after original DOM measurement does Word preparation wrap each HR in a
collision-checked temporary Div. Actual Pandoc emits its generated bookmarks
around the native HR paragraph. The projector requires a unique matching pair,
same parent, exactly one intervening native HR paragraph/rectangle and no text,
foreign content or nested bookmarks. Missing/duplicate/crossing/ambiguous owners
refuse export. It removes only its own bookmarks, preserving other source IDs,
paragraph properties and surrounding content; it never matches text or global
rectangle positions.

Percent width uses native `o:hrpct`; pixel width becomes points at 0.75pt/px.
Native percentage precision beyond 0.1% explicitly refuses instead of silently
rounding. The native paragraph receives centered justification in proper
property order, in addition to the converter's horizontal-rule alignment.
The border-only rule uses zero height and a 0.75pt stroke, matching the editor's
1px border; authored background remains native fill metadata without introducing
a visible filled box. This remains editable native Word/VML content, not an
image or HTML embedded in a DOCX.

Styled HTML rules use the existing strict RawBlock Markdown owner protocol;
unstyled rules retain native Markdown syntax. PDF adds its border/currentColor/
24px-margin print rule only after the original document passes the shared policy.
It uses the existing owned-print-style seam. Unknown authored layouts remain
untouched, and canonical source styles/allowlists are unchanged.

The same checkpoint includes the independently observed dark-editor contrast
repair and compact toolbar icon: the divider uses the existing semantic border
button token, and its menu row now follows the other icon rows. Actual packaged
light/dark acceptance remains a separate gate.

## Actual source qualification and remaining gaps

The original immutable renderer53 refused the owned styled-rule fixture through
the real browser normalizer. Its real converter independently demonstrated the
attribute loss. Current source worker/IIFE overlays on that immutable base then
passed complete Word, PDF and Markdown conversion for percent/pixel/default/
alpha rules. Independent Word XML checks verify native widths, stroke/fill,
centered paragraphs, default gray and alpha results; generated owner markers are
absent. Styled Markdown retains the original declarations. Source SHA remained
unchanged and containers exited normally. Receipts are under
`/tmp/document-divider-export-probe/`, including `v3-qualification.json`.
These overlays are source evidence, not a newly qualified immutable pair.

The first VML probe retained the converter's centered alignment attribute but
LibreOffice rendered the rule at the left. Native paragraph justification fixed
that observed offset. The first PDF probe exposed gray UA borders despite
explicit red/blue CSS ink; the qualified print rule fixed that actual loss.
The first native rectangle also painted a filled interior absent from the
border-only editor; the zero-height projection removed it.

LibreOffice and browser PDF both show centered, visible colored rules. They are
not pixel-identical: in the owned 850px-wide raster, the 40% rule is 261px wide
in Word/LibreOffice and 280px in browser PDF because their usable page widths
differ; the authored 240px rule is 251px versus 250px after raster scaling.
The red→blue vertical separation is 60px in Word versus 83px in PDF. Native
paragraph spacing remains tighter and needs a separate measured fidelity fix;
this checkpoint does not claim full layout parity. Microsoft Word application
appearance has not been tested. The source fixture and generated images contain
only made-up test content. No shared preview, production, publication or pins
changed.
