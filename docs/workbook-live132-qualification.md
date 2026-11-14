# Experimental worksheet candidate 132/75

This checkpoint records bounded actual browser acceptance of corrections to the
failures observed at 131. It is not full worksheet, history, permission, recovery
or release acceptance. PR #39 remains draft pending the remaining review and
qualification gates. Installer pins remain 89/35.

## Immutable pair and source

The local pair was built from clean fork
`83316f1e878d11e46758b7fe5e994b7d27773ae6`; the native preview source is
`72f8c5902eec0274c57154460a35b4b62e883ba6`. The PR preparation normally merges
that reviewed source and fork main. Every non-documentation blob in the prepared
PR matches the candidate exactly; retained PR documentation does not relabel the
build. Companion build `e54e41ebfe86e3d3c467dc8bcdb84b4fe6e4e3046419bf2cf63f70f261c7417f`
and renderer image
`sha256:84196a0327eb7157ea26f7624968b52622f81c3d5eb5236721eba3b6a2844885`
passed author and independent root inventory/source/image checks. The worker
bytes changed from 131 only through the maintained core input; the four other
renderer helpers remained exact. Receipts are `/tmp/artifact132-pair-receipt.json`
and `/tmp/artifact132-root-pair-receipt.json`. No live source overlay, release,
pin or production change is implied.

The joined source passed 163 focused cases in 16 files, 31 actual RPC cases in
three files, workspace types and guard before the immutable build. These are
author results, not tests rerun during this review.

## Rich append preserves original runs

On a new owned TEAM workbook, the manual sequence cancelled an edit, reopened
the visible editor and appended text through real pointer/keyboard input. Save
retained the original **Blue ** run's bold flag and theme-color index 4, and the
**Unicode 零 😀 controls** run's italic flag and exact green color. Independent
XML inspection found the full intended text and the styled prefix. Only the
edited worksheet and workbook metadata parts changed; unrelated parts remained
byte-identical. This qualifies the actual clear/cancel-to-rehydration path that
candidate 131 lost, not arbitrary rich-document editing.

## Unused-sheet Rename and live scalar display

Actual Add of an unused **Unused Roundtrip** worksheet followed by Save, Rename to
**Unused Ready** and Save remained healthy. Native Ctrl+Z followed by Save
restored the prior Add state; Ctrl+Y and Save restored the Rename state. Every
OOXML part after Undo matched the prior Add, and every part after Redo matched
the prior Rename. ZIP archive bytes differ, so no whole-archive equality is
claimed. No formula values or receipts were injected.

New SUM(A1) formulas visibly displayed 28 before Save, without zoom or reload,
in the inspected Dark and Light views. Raw saved XLSX independently retained
numeric 28 and formula caches 28. This closes the bounded stale/blank display
cases exercised here; it does not qualify every formula or layout combination.

## Original raw Markdown fixture

The exact original 227-byte Markdown source that failed structured admission at
131 opened the real structured editor at 132. Actual paragraph edit, autosave,
Undo and whole reload retained exact code text, language `ts`, block ID and
red/yellow 14px paint in personally inspected Light and Dark desktop views.
Normal UI Word export retained native red/yellow code properties and 10.5-point
size. Source bytes stayed unchanged by export.

Undo produced canonical 493-byte Markdown rather than restoring the original
227-byte serialization. The exact authored newline was checked in raw Markdown;
DOCX literal newline-byte preservation and a new Word-app/LibreOffice visual
matrix are not claimed. The serializer-shaped 131 positive remains separate
from this original raw-source acceptance.

## Worker fault, protected recovery and source persistence

After the numeric/formula Save, exactly one owned calculation Worker was
terminated and a trusted edit changed original B2 from 12 to 13. Source stayed
at SHA `9ab8aa272486f923da2566e94b0fb5646b2743f192c8c63ad5c06f2cc84577a8`
through the fault. The downloaded protected copy survived whole reload and
Restore. Normal Save produced 7,222 bytes at SHA
`37a02a0e04dd77eece8da23ee14445d4fc97685409cf59f963f750dda7f53a22`.

Independent XML checks found B2=13, local C3 SUM cache=13 and the cross-sheet
formula cache=13. The born sheet retained A1/C1/G1 values 28 and its entire
worksheet part stayed byte-identical. Only the original edited/dependent
worksheet parts changed. Immediately after Restore, C3 still displayed stored
12; after actual Save the personally inspected canvas and XML both showed 13.
This does not qualify complete initial/live restore recalculation. The grid
initially disables automatic calculation and retains original source caches
until a qualified result or checked source rebase exists; a stored-results
notice is distinct from a freshly computed display result.

## Pending boundaries and evidence

The root browser closed normally (CLI exit 0) after restoring Dark, first sheet
and 100% zoom. JSON signout returned 200 and the subsequent session request 401.
The separate CDP observer ended with exit 13 when browser closure disconnected
its socket while a top-level await still waited for SIGINT; this is not an
observer exit-0 or intentional Ctrl+C result. No live observer/browser remained.
Read-only exact-ID audits found all four captured root sessions and all eleven
rich-fixture helper sessions absent in the asserted owned preview database. The
one browser session was reused for the rich fixture, not counted as a new login.
Only requested ledger IDs were queried, with no deletions or global cleanup claim.
Audit receipts remain beside each qualification record. Broader pending-save
Undo/Redo, repeated history/ownership withdrawal, large-source,
viewport/chat/fullscreen and export matrices remain open. A source review also
identified late correlated readiness probes being dropped after the
visibility-listener handoff; its correction and qualification are separate from
this immutable pair's successful observed timing.

Scratch evidence: `/tmp/artifact132-rich-ui/qualification.json` retains original
and saved XLSX, rich-run XML, each Add/Rename/Undo/Redo readback and the fault/
recovery oracles. An earlier separate rich tester sequence that replaced text
rather than appending is retained separately and does not qualify the successful
cancel-to-rehydrate path. Raw Markdown evidence is in
`/tmp/document-code-paint132-ui/qualification.json`, including native Word
properties and scope limits. Its two captured test sessions were independently
queried by exact ID and captured user in the asserted owned preview database;
both were absent. No session was deleted or global auth cleanup inferred.
