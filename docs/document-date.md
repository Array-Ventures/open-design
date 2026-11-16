# Atomic document dates

This source checkpoint adds an inline Date atom to the document editor. It is
not yet an immutable packaged or manually qualified feature. Preview, release
pins, publication and production remain unchanged.

The reversible, authorized document-reference audit established an immediate
calendar after Date insertion, browser-local today, a noneditable date chip,
independent date-change Undo/Redo, Date omission in a table, and one Add proposal
whose day can change before review. The reference had Editing and Suggesting;
no Viewing mode was observed. Our Viewing mode remains read-only. Appending a
paragraph when no editor selection exists is our explicit insertion policy, not
a claim about the reference.

## Source and display

A Date is a Lexical inline DecoratorNode. Its text content is its persisted label,
so Review cards and copied document text retain the visible date. A canonical
source atom is:

```html
<time data-eve-document-date="1" datetime="2024-02-29" data-eve-date-locale="en-US">Feb 29, 2024</time>
```

The shared contract validates exact Gregorian ISO dates, canonical locale tags,
and bounded safe Unicode labels. Admission validates the entire TIME atom before
sanitizing; unknown attributes, element children, invalid dates and code/root
contexts refuse rich editing. HTML and Markdown retain the semantic atom, ISO,
locale and label. Merely viewing or changing the UI locale does not regenerate
the label. A user-initiated day change formats a new label in the current locale
and local calendar time zone. Local today uses that time zone, including when
its day differs from UTC. The calendar bounds match years 0001 through 9999.

The real free BoardUI Date Calendar and shared month/day primitives are adapted
inside the existing embedded BoardUI boundary, with attribution in its NOTICE.
React Aria owns day navigation, localization and calendar keyboard semantics.
The surface uses semantic tokens, a 320 px floating card and 32 px day/navigation
targets. No Pro calendar or reference implementation code is used.

## Editing and ownership

Date is an existing More action. Table selections omit it. Suggesting exposes
Date without enabling the other unsupported structural formatting actions.
Text-range replacement must stay inside one ordinary block; cross-block input
is rejected before deleting selected source. Date insertion and day changes
flush pending normalization through public editor.read and use distinct native
history transactions.

Suggesting insertion is one Add, or one retained-text Replace. Changing its day
uses that same proposal only while this live Date controller owns the atom and
proposal identity. Changing a committed Date in Suggesting retains the original
atom in a paired Replace. Imported/unowned pending proposals and deletion
branches show a protected notice rather than becoming silently editable.
Accept/Reject use existing review commands and dirty the proposal children so
Decorator-only changes enter native history. There is no SDK patch, separate
history stack or blanket history-tag bypass.

The calendar binds its editor, exact node key, mode, private open generation,
source-owned value and connected target. Dismissal, deletion, mode/read-only
withdrawal, actual editor-root replacement, opening another Date and disposal
retire callbacks. Outside dismissal leaves the newly focused input/caret alone;
Escape and an actual day commit can return focus only to the still-owned Date.
Existing conditional writer and source CAS protections remain authoritative.

## Conversion boundary

The later [readable export-boundary correction](document-date-export-spacing.md)
records real adjacent-Date Word/PDF consumer failures and the bounded
presentation-only fix. The initial bare-label projection below was insufficient
for chip separation; semantic Markdown and original source remain unchanged.

A genuine adapter regression showed that the existing strict Word normalizer
refuses TIME. The conversion copy therefore projects only a fully validated Date
to its persisted visible label in a neutral span before existing presentation
ownership runs. Original source remains TIME. Word conversion input contains ordinary visible text,
not a native date field or editable date control. PDF print preparation retains
the semantic TIME and visible label. HTML-to-Markdown uses the existing RawInline
owner mechanism to preserve the exact TIME, including when an outer styled span
already owns it. Unmarked legacy HTML TIME retains its previous converter path;
reserved Date markers remain strictly validated. Pending suggestions continue to refuse conversion through the
existing review gate.

Preparation and adapter tests are source-level evidence. Actual Word/PDF/Markdown
consumer readback and packaged Light/Dark wide/narrow calendar, editing,
review/history, save/reopen and stale-owner visual acceptance remain required
on the next immutable pair.

## Author checks

The initial source tests genuinely failed on the unchanged editor: canonical
TIME admission and actual Lexical HTML/Markdown reopen failed (2 failed, 5
passed). The separate converter tests then genuinely failed at the owning Word
qualifier and absent Markdown raw owner (2 failed). Their corrections are
covered by the final Date suites. A local-day test also caught an initial label
time-zone mismatch; formatting now uses the same explicit local zone as the
calendar value.

Final source checks:

- 182 web cases in 10 files: Date source, mounted calendar and conditional writer,
  private ownership/lifecycle, local calendar day, existing Review, suggestion
  input, ordinary font history, admission and Markdown.
- 25 shared contract cases in 1 file, including Gregorian century/leap bounds,
  Unicode labels, invalid locale/date forms and copied immutable data.
- 51 daemon cases in 5 files for Date preparation/adapters, existing Markdown,
  Word source owners and unresolved-review refusal. The final Date adapter
  subset is 10 cases in 2 files; these overlap the 51 rather than adding to them.
- Frozen dependency install, full workspace types, guard and i18n checks passed.
  A final web typecheck covers the last authored Enter-command test, and an
  affected daemon typecheck covers the legacy TIME compatibility control.

The mounted tests use the real Lexical editor/history, conditional writer and
React Aria calendar. They cover immediate no-focus insertion, real keyboard day
selection, same-proposal day changes, loaded first Accept/Reject Undo/Redo,
retained Date/text Replace, read-only/imported-proposal refusal, table omission,
outside-input focus, actual editor-root retirement, saved source reopen, and
UI-locale changes without source mutation. They are functional jsdom evidence,
not trusted-browser or visual qualification.

Scratch logs are `/tmp/document-date-source-red.log`,
`/tmp/document-date-conversion-red.log`, `/tmp/document-date-final-web2.log`,
`/tmp/document-date-final-contracts2.log`, `/tmp/document-date-final-daemon2.log`,
`/tmp/document-date-final-date-adapters.log` (the earlier 9-case subset),
`/tmp/document-date-final-daemontypes.log`, `/tmp/document-date-final-types4.log`,
`/tmp/document-date-final-webtypes.log`, `/tmp/document-date-final-guard3.log`,
`/tmp/document-date-final-i18n.log` and `/tmp/document-date-final-install.log`.
Earlier development type/harness failures remain separate; they are not claimed
as product regressions. No application stack, renderer image, immutable pair,
preview activation, hosted CI or browser visual run was started for this source
checkpoint.

## Formatted-ancestor admission correction

The first Date checkpoint admitted a valid TIME inside bold, italic, ink and
font-size wrappers, but the Decorator has no TextNode presentation payload.
Actual Lexical import/export dropped those wrappers; an unrelated mounted
conditional-writer Save also dropped the Date's bold ancestor. The genuine
baseline is five failed cases in `/tmp/document-date-formatting-red.log`.

This correction keeps the Date model bounded rather than silently claiming
arbitrary rich Date formatting. Editable admission, Date DOM conversion and the
pre-sanitizer import check refuse semantic text-format ancestors, inherited
authored text/font presentation and non-retained ancestor classes. Original
HTML/Markdown remains in its existing viewer, with no rich editor or source
rewrite. The existing general admission already refused text/font styles on
paragraphs, DIVs and headings; the Date preflight now refuses those contexts too.
Unknown global CSS remains outside the existing canonical admission boundary.

Semantic headings, retained block alignment/indent, table-cell background,
plain links and regenerated checklist-state classes remain supported by actual
import/export controls. Plain Dates, imported plain proposals, review/history
and calendar ownership retain their existing paths. This limitation is an
editor admission rule: conversion-only Word projection and Markdown raw owners
still preserve valid formatted ancestors independently. Native consumer output
and packaged presentation remain pending; no blanket TIME/style allowance,
Date formatting model or source sanitizer expansion is introduced.

The formatted-context follow-up passed 94 web cases across six files (including
actual Surface fallback and the existing Date source/calendar/review/lifecycle
cases), 11 Date adapter cases across two files, web types and repository guard.
The new worktree's frozen install also passed. Logs are
`/tmp/document-date-formatting-{red,final-web,daemon,webtypes,guard,install}.log`.
These checks do not add packaged, native-consumer or manual visual claims.
