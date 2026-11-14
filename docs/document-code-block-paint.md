# Uniform code-block paint preservation

The code-size change exposed a preservation regression. Actual immutable125
refused a PRE containing CODE with red foreground, yellow background and a 16pt
font because a nonempty inner presentation owner vanished. Immutable126 exported
that same input with the correct native size but **silently lost both colors**.
The source itself was unchanged. Original results and native XML remain in
`/tmp/document-code-block-color-audit/{old,new}` and `new.xml`.

The corrective source uses the same effective-background, compositing, explicit
foreground and contrast helpers as other text owners. A PRE can use its direct
CODE context only when it contains exactly that CODE, whose children are text
or attribute-free BR nodes. Outside text, including nonempty whitespace, multiple
CODE children and rich nested descendants refuse instead of assigning one
child's paint to the entire block. The source PRE still binds the exact existing
native CodeBlock owner; fonts, text and native editability are retained.

Child CODE inline declarations are limited to the already-supported font size
and color/background properties. Unowned bold, decoration, whitespace and width
changes refuse. The existing document policy separately requires color-only
background shorthand and exact owned stylesheets: URLs, gradients and authored
stylesheet decoration are not admitted. The guard reads authored property names;
CSSOM-generated default longhands from `background:yellow` are not additional
source intent. Explicit authored ink wins, even at poor contrast. Automatic
white ink is derived only when inherited ink on the measured dark backdrop
requires it.

## Author evidence

Qualified unit regressions produced 4 failures/54 passes before the owner fix;
three initially trivial negative tests were corrected to supply valid measured
sizes **before** changing production. A further four genuine refusal regressions
failed before the child-style guard. A positive shorthand regression caught its
initial CSSOM false-refusal. These runs remain respectively in
`/tmp/document-code-block-colors-red-qualified.log`,
`/tmp/document-code-block-colors-style-red.log` and
`/tmp/document-code-block-colors-shorthand-red.log`.

Source qualification uses immutable126/69 with **only a read-only corrected
browser-helper overlay**, not a new immutable candidate or app activation.
Native XML checks retain authored red/yellow, derived white on dark, 16pt code,
SourceCode/VerbatimChar, original source hashes and absence of temporary owners.
Mixed input, gradients, unknown inline styling and an unowned stylesheet refuse.
Receipts and final guarded outputs are under
`/tmp/document-code-block-color-fixed-proof/{qualification.json,final}`.

Two unchanged native DOCX files were converted through a fresh isolated
LibreOffice profile. Their single/multiline highlight extents match browser PDF
within two pixels at 100DPI. The native shading covers the glyph-line fragments,
not the whole paragraph. Both pages were personally inspected:
[browser PDF](images/document-code-paint/browser-pdf.png) and
[LibreOffice from editable DOCX](images/document-code-paint/libreoffice-docx.png).
`paint-coverage.json` retains exact extents and byte-equal DOCX copy checks.
Block positioning, default margins and page furniture still differ; these images
are **not** placement parity or a Microsoft Word test.

All conversion containers used network none, read-only inputs and bounded
resources, then exited/removed normally. LibreOffice exited normally without
using the default profile. No image/application build, runtime configuration,
publication or installer pin changed. This source correction is not installed in
immutable126/127. Code-block padding/margins and broader rich-code fidelity remain
separate work.

Final checks passed 69 document-style cases across six files, full workspace
`pnpm typecheck` and `pnpm guard`. The final raw-declaration guard also passed
actual native conversions for background-color and equivalent color shorthand.
Every native package part matched the personally viewed positive output exactly,
so no second LibreOffice rendering was needed; `final-source-equivalence.json`
retains that comparison. Final source/guard outputs are in `final2`, with helper
SHA256 `497a4acbc82d711f77f9cdf829b6f4e9582d9966a47b216cdf790a58baedae68`.
