# Preserve source-owned code paint in the structured editor

Actual immutable129 exports retained red/yellow CODE paint and canonical code
spacing, while the live editor displayed neutral code. No edit was made in that
qualification; its unchanged source is not proof that an unrelated save would
retain the authored paint. The original screenshot/evidence remains under
`/tmp/document-code-geometry129-ui`.

The importer unconditionally removed a direct CODE wrapper inside PRE to avoid
creating a second multiline CodeNode. That also discarded its admitted inline
styles. The Markdown serializer then always emitted a language fence, which
cannot express painted code. Both paths needed preservation, not a theme override.

The correction carries already-admitted direct CODE presentation through a
conversion-only neutral span into existing Lexical TextNode styles. Pinned
Lexical applies inherited forChild styles only to the last item of an array
returned by its text importer. Splitting PRE text boundaries at newlines/tabs
before conversion allows each real text item to receive the existing importer;
no characters, source attributes or whitespace are removed.

Only plain code whose text children have identical supported color/background/
font-size styles is exported as a direct styled CODE inside the existing PRE.
This keeps glyph highlighting separate from the block's neutral background.
The export removes only CodeNode's generated editor-theme class: standalone HTML
uses its canonical PRE stylesheet. Language, exact code text and the block ID
remain. Mixed runs retain normal styled DOM output and Markdown uses existing
raw-HTML export instead of flattening them into one uniform owner or a fence.
Ordinary unstyled code still uses native language fences.

The Markdown reader previously removed one actual final newline from source-owned
raw CODE too. Its syntax-newline normalization now applies only to the plain
fence-producer shape; styled/identified rich HTML retains its real text and
children. This is not a claim that arbitrary indistinguishable raw unstyled HTML
and Markdown fence syntax can be perfectly distinguished.

## Author evidence and boundaries

Real Lexical live-DOM, HTML and Markdown producer assertions genuinely failed
before the correction. The first neutral-span implementation painted only the
last line, exposing the pinned multiline importer behavior. A separate actual
styled Markdown save/readback assertion then genuinely failed on a final newline.
Those logs remain under `/tmp/document-code-editor-paint-{red,import-trace,
roundtrip}.log`. An added plain-code control initially omitted the real editor's
block-ID initialization and failed its metadata schema; the fixture now performs
the same initialization as DocumentEditor. That was not a product failure.

The source tests cover exact text/language/identity, live glyph styles, unrelated
edit and actual Lexical Undo, HTML save/reimport, styled Markdown finalization/
readback, tabs/Unicode, trailing newline, mixed red/blue runs and unchanged unsafe
CSS refusal. Unsafe backgrounds, positioning and CSS variables remain outside
supported editing admission. No stylesheet policy, persistent draft schema or
write authority changes. Rich mixed code Word export is not newly qualified;
the converter retains its strict unsupported-owner refusal.

An actual current-source Lexical producer imported the earlier canonical fixture,
made an unrelated paragraph edit and generated saved HTML/Markdown. Its HTML
converted through unchanged immutable renderer72 with **no overlays**. Independent
native checks retained editable SourceCode/VerbatimChar, exact code text, 10.5pt,
red/yellow glyph paint and the existing measured540/450twip margins/240twip
indents, without temporary owners. Evidence is under
`/tmp/document-code-editor-paint-proof/{producer.log,native-check.json}`.
This qualifies generated source and the converter seam, not a packaged updated
web editor, UI autosave, HTTP conflict handling or Microsoft Word appearance.
Fresh immutable-pair edit/save/reopen/Undo and visual qualification remain gates.
No runtime, image build, installer pin or publication changes in this source work.

The generated editable DOCX also rendered through one isolated, CPU-affined
LibreOffice profile. Its code and unchanged following-text prefix passed the
existing five-pixel-at-100DPI glyph-bounds comparison against the actual129 PDF
of the same canonical code; only the unrelated paragraph suffix differs. The
DOCX input stayed byte-identical and the consumer was personally inspected:
[saved editable Word consumer](images/document-code-editor-paint/saved-word.png).
Exact bounds and scope are in `consumer-bounds.json`; this comparison does not
cover the entire edited paragraph, new PDF export or Microsoft Word. The converter
container and LibreOffice exited normally and no owned process remains.

Final focused checks passed 53 cases across the new paint tests and existing
HTML, identity and DocumentEditor tests. Full workspace `pnpm typecheck` and
`pnpm guard` passed. Existing unrelated failures were not removed or rebaselined.
At that checkpoint, actual generated Markdown-to-Word conversion remained a
separate gate from the proved Markdown serialization/readback and generated
HTML-to-Word seam; the bounded followup below subsequently exercised it.

## Raw Markdown language followup

Independent review found that the new fence-only early return also skipped the
existing safe language promotion for raw identified/styled CODE. An actual
Markdown-readback→Lexical test with CODE class `language-ts`, red/yellow paint,
a source block ID and real trailing newline genuinely failed: language became
undefined. The correction promotes the same validated language for both source
shapes; only syntactic newline removal remains gated. The fence shape is captured
before adding PRE language metadata, preserving ordinary language-fence handling.
Exact language, text/newline, block ID and paint now survive that regression.

Frozen `ab78b917` is retained as the earlier checkpoint. This followup changes
only the web Markdown reader plus its test and this note. The earlier contained
Word/LibreOffice proof uses generated HTML and does not invoke that readback
branch, so it is not rerun or relabeled as new renderer/consumer qualification.
The new raw-language case is source/real-Lexical qualification, not packaged UI.

Followup checks passed 54 affected cases in four files, web typecheck and the
repository guard. No renderer, builder, browser or LibreOffice run was repeated
for this language-only parser correction.
## Generated Markdown native Word followup

The exact final630 producer regenerated byte-identical HTML and Markdown from
the earlier controlled Lexical fixture. The Markdown input was580bytes/SHA256
`6cc7ea5a1f5421476ccfd6015064e75509f3ca2ac22bf35a47af4fd13dd0f976`.
One normal, network-disabled, read-only immutable72 conversion, with no overlays,
completed successfully and left that source hash unchanged. The container exited
and was removed. Evidence: `/tmp/document-code-language-promotion-proof/qualification.json`.

Independent native checks retained exact `COLORED_BLOCK\nsecond line`, editable
SourceCode/VerbatimChar,10.5pt,red/yellowglyphpaint,540/450twipspacing,
240twipinsets and315twipatLeastlineheight, without generated owner markers.
The exact input had no authored language; this does not add a native Word
language-fidelity claim. The styled raw-language/trailing-newline correction is
separately proved through the real Markdown reader and Lexical producer test.

Fifteen of sixteen native file parts match the previously qualified HTML
Word document, including exact `word/document.xml`. The sole difference is
Heading1–6 fonts in `word/styles.xml`: the scratch HTML wrapper used its serif
heading default while the controlled Markdown root retained its sans default.
That producer harness omitted DocumentEditor's real root-font initialization.
There are no headings in this fixture. All actually referenced/default style
closures match, but full style-part/package equality is **not** claimed.
`word-part-equivalence.json` and `styles-diff.txt` preserve the distinction.

No extra LibreOffice run was performed: no current-content appearance concern
was identified, and the prior HTML consumer remains a distinct proof rather
than being relabeled as a new Markdown consumer. Updated packaged-web edit/save/
reopen, mixed rich code, complete font-profile/Word-app fidelity and broader
layout gates remain open. No runtime, build, publication or pin changes occurred.

### Raw Markdown language-class admission follow-up

Actual candidate131 manual qualification exposed a separate boundary gap: raw
styled `<pre><code class="language-ts">…</code></pre>` reached the generic viewer,
while the serializer-shaped fixture (PRE `data-language`, no CODE class) opened
in the structured editor. The earlier serializer/import proof did not exercise
`DocumentSurface`'s preceding `supportedDocument` gate.

The Markdown reader now moves a sole, validated `language-*` class into PRE
`data-language` and removes only that semantic class. Existing conflicting PRE
metadata, mixed/unknown classes and unsafe styles remain intact and unqualified.
The plain-fence shape is identified before normalization, so only its syntactic
terminating newline is removed; raw styled code retains its actual final newline.

The real reader → admission → Lexical import/export regression initially had
four failures and seven passing refusal controls. All eleven pass after the
reader-only correction, including exact text, language, block identity and paint.
This is source qualification, not a new packaged browser result. The failed raw
fixture and the separate passing serializer-shaped candidate131 fixture remain
distinct evidence in `/tmp/document-code-paint131-ui/qualification.json`; no
runtime or renderer change is claimed by this follow-up.
