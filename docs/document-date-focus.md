# Keyboard focus after document controls disappear

Actual Date testing on the first Date/workbook pair found two defects. Undo
removed a focused Date chip, and accepting/rejecting the last proposal removed
its focused Review button. Both left the iframe BODY focused; immediate keyboard
history stopped reaching the editor until it was clicked. History itself was
intact. Calendar month buttons also had accessible labels but zero-width SVGs.

Source `ed417056` returns focus only from a removed, previously focused control
to the same still-connected, editable editor, while its document remains focused
and BODY owns focus. It cannot take focus from another input. Public Lexical
Undo/Redo hooks only observe the operation; native history remains authoritative.
Root replacement, editability withdrawal and disposal retire pending ownership.
Review uses its existing post-render lifecycle. The month buttons explicitly
clear inherited padding and retain 16px nonshrinking glyphs inside 32px targets;
the shared calendar files are explicit Tailwind sources.

The mounted Date regression first failed with eleven controls passing. Two
Review regressions also failed before that correction. jsdom reports an inactive
window when its last focused DOM node disappears, unlike the measured browser
(both documents still focused, parent active element the iframe). The new tests
model an active window and separately require refusal to steal focus from an
inactive window or another input. The final 153 cases in ten affected document,
suggestion, history and Surface files passed. Frozen install, full serial
workspace and scripts types, repository guard and an independent source read
also passed. Earlier fixture/model failures remain recorded.

The supported builders produced a new local immutable pair from exact clean
`ed417056`: companion `c4a95f5fbe05e17c0803ae0cf4ebf5ab34bc3f91cfb945cf2228dcd6f9ffeba6`,
image `sha256:d71cc1f319163a8eee669ae41db7a09d680afd5f562e0288ace935eea1a4f03a`.
All three children and strict inventory/source/image verification exited 0.
All five renderer payloads and normalized inputs are byte-identical to the
preceding Date pair: these fixes change the companion editor, not conversion.
The verifier's initial obsolete prior-checkout HEAD assertion failed; its
correction proves the intervening changes are documentation-only and validates
the original package provenance. This was not a product failure or a rebuild.
Actual fixed-pair focus/glyph acceptance remains a separate gate.

## Actual conversion checkpoint and remaining defect

On the preceding Date630 pair, normal native Word/PDF/Markdown actions produced
real downloads. Independent DOCX ZIP/XML inspection retained both Date labels;
LibreOffice opened it and produced a PDF containing them. The native PDF also
retained both labels. Markdown retained both exact semantic TIME atoms, ISO,
locale and labels. An imported pending proposal clearly refused all three
formats until review. Both fixtures' source hashes stayed unchanged.

These are not complete export passes: personally inspected Word and native PDF
pages concatenate adjacent Date labels and prose because the editor's chip
margins are absent. That presentation defect needs a separate correction.
The first capture attempt missed the download link; its dependent input was
missing, and LibreOffice misleadingly exited 0 while reporting that error.
Only the later run with verified DOCX bytes, an actual generated PDF and inspected
content is consumer evidence. No output filename alone is treated as success.

The [hashed record](document-date-focus-evidence.json) separates source tests,
builds, real earlier-pair consumers and outstanding acceptance. This work changes
no installer pins, publication, production or shared-dev state.
