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
build. No live source overlay, release, pin or production change is implied.

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

Actual Add of an unused **Roundtrip** worksheet followed by Save, Rename to
**UnusedReady** and Save remained healthy. Native Ctrl+Z followed by Save
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

## Pending boundaries and evidence

The root's final Worker-fault Restore/Save and immediate repaint check is still
being recorded. No final root browser/auth cleanup claim is made in this record
yet. Broader pending-save Undo/Redo, repeated history/ownership withdrawal,
large-source, viewport/chat/fullscreen and export matrices remain open. A source
review also identified late correlated readiness probes being dropped after the
visibility-listener handoff; its correction and qualification are separate from
this immutable pair's successful observed timing.

Scratch evidence: `/tmp/artifact132-rich-ui/` retains original and saved XLSX,
rich-run XML and each Add/Rename/Undo/Redo readback. Raw Markdown evidence is in
`/tmp/document-code-paint132-ui/qualification.json`, including native Word
properties and scope limits. Its two captured test sessions were independently
queried by exact ID and captured user in the asserted owned preview database;
both were absent. No session was deleted or global auth cleanup inferred.
