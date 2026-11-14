# Editable Word code typography

This source checkpoint fixes context-dependent code **size**, not general Word/PDF
visual parity. Canonical HTML gives PRE its own 14px font; minimal marked HTML
inherits the 20px print body. Ordinary inline CODE inherits its surrounding size.
The previous Word output used the same 11pt VerbatimChar size for both contexts.

The existing contained DOM measurement now returns an explicit `code-context`
font receipt for the original PRE or non-PRE CODE element. Computed sizes include
already-supported authored inline sizes. These receipts use the existing bounded
font-size and line-height validators; the source adapter checks their original
code-element identity. No stylesheet or editor admission is broadened.

PRE text, BRs and regenerated white-space:pre-wrap spans can be normalized into
PRE/CODE **after** DOM measurement, in the conversion-only copy. Rich authored
spans are not stripped. Native Code/CodeBlock attributes bind exact generated
bookmark owners; CodeBlock retains its native SourceCode paragraph, language,
text and indentation. Projection changes only owned native size and minimum-line
properties. VerbatimChar, foreground/shading and unrelated runs remain intact.
Code-context receipts must also retain native Code/CodeBlock identity. Missing/duplicated owners still refuse rather than silently discarding styling.
No global VerbatimChar size can represent both source contexts.

## Author evidence

The initial three source/AST regressions failed before the fix:
`/tmp/document-code-typography-red.log`. The actual pinned converter separately
confirmed that PRE/CODE retains PRE attributes in CodeBlock while discarding
inner text-wrapper attributes. The new protocol therefore owns the block itself.

Four initial contained conversions under `/tmp/document-code-typography-proof` compare
unchanged immutable118/61 with the current read-only worker/IIFE source overlays
on that same image. This is **not** immutable candidate qualification. Independent
DOCX XML/style inspection records:

| Source | Previous effective sizes | Corrected native sizes |
| --- | --- | --- |
| Canonical documentHtml | inline 11pt; block 11pt | inline 15pt; block 10.5pt |
| Minimal marked HTML | inline 11pt; block 11pt | inline 15pt; block 15pt |
| Explicit inline CODE 16pt/red | 16pt/red | 16pt/red |

The qualification retains native editable code styles, breaks, indentation,
source hashes and generated-owner absence. Four additional corrected conversions verified the strict Code/CodeBlock identity guard and final empty-code compatibility branch. All eight conversions exited normally;
network was disabled, inputs/overlays were read-only, and containers were removed.
Receipts and independent assertions are `receipts.json`, `qualification.json` and
`check-final2.py` in that scratch directory. Old immutable outputs remain alongside the
corrected outputs, including both genuine baseline size mismatches.

Actual packaged Word/PDF comparison, consumer typography/monospace-face matching,
Microsoft Word, complex styled code, arbitrary code layouts and full rich-block
fidelity remain unqualified. This checkpoint does not change the application
runtime, build an image, publish anything or update installer pins.

Author checks: 81 focused daemon cases in five files, 54 shared cases in six
files, full workspace types and guard passed. No full app suite was run.

The later immutable126 check found a uniform child-CODE color-loss regression
introduced by this size owner. The [paint correction](document-code-block-paint.md)
retains that failure and the separate source-only correction; code-size evidence
must not be treated as complete foreground/background or layout qualification.
