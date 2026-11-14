# Document comment selection checkpoint

This is a bounded interaction fix, not full Claude workflow or markup parity.
Production and shared development services were untouched. No comment was sent
to a chat during the manual acceptance checks.

## Reference-guided workflow follow-up (candidate 107 qualified)

The candidate105 evidence below remains historical. A later direct inspection of
our disposable Claude document showed that Comment without a selection opens the
comments list; an explicit Comment action on selected text opens a compact,
autofocused composer. Selecting text alone does not open it. A recipient mention
alone leaves Send disabled and Escape closes without discard confirmation.

The follow-up source implements that distinction: only a completed editor pointer
or keyboard gesture owns a retained selection across host-header blur. Saved
thread navigation does not restore Lexical selection. An exact CSS Custom
Highlight marks its range without changing editor state, native selection or
source. Unsupported Highlight API environments keep the thread available without
that visual mark. Highlight registry/style ownership is cleaned up on close,
range changes and editor teardown. The list leaves editing controls available.

The compact composer exposes the exact quote as an accessible description rather
than a repeated visible quote block. It retains existing comment authority,
conditional saves, reply drafts and discard confirmation. Known host bot mentions
alone are not substantive comment text; unknown handles, emails and mixed text
remain content. No automatic bot choice is introduced for multi-bot conversations.

Candidate107 passed the paired six-case browser suite and the bounded manual
checks below. This establishes the functional selection/comment checkpoint,
not full reference parity or cross-type feedback acceptance.

### Candidate106 rapid-input failures and source follow-up

Candidate106's first paired browser run passed selection ownership, explicit
header composer, passive highlight, accessible quote and mention-only validation,
then lost a letter during immediate typing after a mention. Three diagnostic
runs reproduced the loss. A transparent pass-through value observer showed the
browser had inserted the letter, then React committed the previous controlled
value during native input capture, before the authoritative change handler.
The element remained connected and editable, with no focus loss. The follow-up
moves menu/caret input bookkeeping into the bubble batch with that change handler.
It does not change typing speed or use forced synchronous updates.

A separate hydrated-document scratch browser also exposed reordered typing from
the old mention caret animation frame. A focused regression reproduced this
independently: after a mention and newer native input, the pending frame moved
the caret from 13 back to 7. Mention insertion now owns a receipt consumed only in
the layout commit accepting that exact value on the original textarea; newer
input, selection, pointer, keyboard or blur events invalidate it. No delayed
focus/caret write remains. The scratch browser is a bounded component proof,
not acceptance of the full candidate. At that source checkpoint, both fixes were pending the next paired native
browser run. Candidate 107 below qualifies them with unchanged rapid typing
assertions.

### Frozen candidate 107 provenance and acceptance

The qualified companion 107 / renderer 50 pair was built from clean source
`b25bd1726d0a3103e0e1fc78e17adcea49e446cb`. This later evidence-only commit does
not relabel that build.

- Source tree: `69da7e3506eb207ad1262da26e2455162d347fa80e615aa9c7f307b9c6bc9b27`.
- Companion: `0188ef0b1046ddacf82754bde7d8bb6c11d77fe5fc91a4031b1610a3329fab6e`.
- Renderer: `sha256:bd64ce6b4e535b782d0eb875edeec31b649ed95d009871ae8b862cebff9a90c6`.
- Worker: `03cfef8d890e7f1780a9bb1706e7a9f34335684bee64b6f1830fc32dad76ec9c`.
- Document-color helper: `a8935e725e3ddf66620ec72c356d7c270514c13977969a31c055eda29e7fed8c`.
- Native preview: `35595d371ee8fa7f3c3382c0bb29e3b8024d8b18`.

Strict companion inventory, clean source pairing, local immutable-image identity,
platform and entrypoint checks passed. The actual image worker/helper hashes
match candidate 106 / renderer 49. Owned preview shutdown and startup both exited 0;
login returned 200. Production, installer pins and publication were untouched.

Source validation passed 69 focused tests, full workspace typecheck, separate web
typecheck and guard. The unchanged six-case native browser suite passed in one
sequence on 107: four saved-comment cases at 1440/390 in light/dark, plus two
fresh-selection workflow cases at 1440/light and 390/dark. Exact rapid typing after
mention selection now passes; the 106 failures above remain part of the record.
The cases also assert passive ranges, accessible quotes, mention-only disabled
submission, source bytes, reload anchors, no stale thread selection and draft
retention. No delays, forced input or production DOM overrides were added.

Manual captures cover dark/light desktop lists, a light desktop composer, and
dark/light 390-wide saved threads. On light desktop, no-selection Comment opened
the list with Editing/insertion still available; a real full-paragraph drag
followed by inline Comment opened an autofocused composer, with an exact passive
range and empty native selection. Keep editing retained the draft; explicit
Discard removed composer/highlight. Fullscreen and restore kept the same iframe,
document and input while preserving unsent comment and chat drafts.

On the dark 390-wide mobile flow, Show chat/Return to artifact retained the same
document and reply node with its unsent reply. Separately, on light desktop,
list navigation hid the reply with zero rectangles and returned the same DOM
node and unsent text. The light mobile thread was also personally viewed. These actions were not all repeated
in every theme/viewport combination.

The fake manual artifact remained 328 bytes with SHA256
`66a16a21de900756016c1bfbb2db80fd143e488e4abefc0914fe4d131513a7b3`.
Its one saved comment resolved the generated block identity and exact offsets 0–31
for “Select this complete paragraph.” There were zero saved replies; temporary
reply/chat drafts were cleared. No chat handoff or external message was sent.

![Light compact composer on the fake manual artifact](images/document-comment-workflow/light-composer.png)

![Dark 390-wide saved thread with a retained unsent reply](images/document-comment-workflow/dark-phone-thread.png)

### Composer surface follow-up (candidates 108 and 109 qualified)

A fresh scoped reference inspection measured a transparent, borderless focused
comment editor with no inner shadow. Candidate 107's real textarea was already
transparent, but its enclosing field supplied an opaque fill, two-pixel inset
ring, eight-pixel padding and a fixed three-row input in both themes.

The separate follow-up keeps the existing BoardUI textarea and removes that
nested surface for document root composers only. It grows from one to five rows,
then scrolls; keyboard-visible focus is indicated on the outer comment card.
List placement, saved replies and mention batching/caret ownership are unchanged.

The integration sizing test fails against the old three-row source and passes
the actual component sizing path with explicit jsdom layout measurements. All 80
focused checks pass, including the unchanged 69 functional checks and existing
BoardUI controls. A separate real-Chromium hydrated component fixture with
compiled Tailwind rules verified native 20→60→100→20-pixel grow/cap/shrink, exact
text retention, transparent/no-inner-ring presentation, and keyboard Tab focus
showing the outer ring and removing it after focus leaves. This is bounded
component evidence, not a new immutable companion or full product visual proof.
Those checks preceded packaged acceptance. Candidate 108, built from clean
`86cad09225d6114f302475e806967effbad67264`, then passed actual light/dark
1440/390-wide manual empty/grow/cap/shrink checks and the unchanged six-case native
browser suite in one sequence. Header and inline entry points were exercised in
the documented manual flow; exact draft text and keyboard focus were retained.
The fake 275-byte source stayed unchanged through a plain comment save, list
navigation and reload, with its exact generated anchor and zero replies. The
placeholder was still absent in 108, as the retained screenshots show.

A separate source commit adds the reference-observed “Add a comment” placeholder,
without changing the accessible name, quote description, controlled value or
styling. A source regression verifies that placeholder text never enables Save;
a bounded real-Chromium component check confirms :placeholder-shown for empty,
hidden while actual text is typed, and shown again after native deletion. Candidate 109 then passed the paired manual and unchanged six-case browser
qualification below.

### Frozen candidate109 provenance and acceptance

The final placeholder/style pair was built from clean
`09e5bb09f535fd7bff719e0a115b2ed67293dc20`; later evidence commits do not
relabel those bytes.

- Source tree: `97edf1a55e099696d76da0804e521e943d733948752aa3272d0b18f7b041bf91`.
- Companion 109 clean rebuild: `0459255f8baf45df2f6b4743eb75e08c513095dce29d710d5ce17e0edf8365a6`.
- Renderer 52: `sha256:615544690ace7333dedc44ba99b0a8e6c6a4c6c10e850a1737d8a012b3056c18`.
- Worker: `03cfef8d890e7f1780a9bb1706e7a9f34335684bee64b6f1830fc32dad76ec9c`.
- Color helper: `a8935e725e3ddf66620ec72c356d7c270514c13977969a31c055eda29e7fed8c`.
- Native: `66437246f84b16b527fdacfe39e51e620918c055` (merged acceptance PR68).

The first companion attempt printed a completed build but returned 143. Although
its inventory verified, that did not establish clean builder completion. It was
never activated. A separately labeled rebuild completed with exit 0, followed by
sequential renderer packaging with exit 0. Full strict inventory, clean source
pair, local image platform/entrypoint and actual worker/helper hash checks passed.
Worker/helper bytes match renderer 51. The owned preview was changed only after
those checks; shutdown/startup exited 0 and login returned 200. The unexplained
first SIGTERM remains recorded rather than being called a successful build.

Final source qualification passed 81 focused checks, full workspace types,
separate web types and guard. On 109 the unchanged native six-case browser suite
passed in one sequence (1.2 min), preserving its exact rapid typing, saved quote,
source, draft and selection assertions. Earlier 108 also passed the same six cases
and its full four-combination sizing manual checks; those are historical 86-source
evidence, not relabeled 109 runs.

Manual 109 checks personally inspected the empty placeholder in light/dark at
1440/390 viewport widths. In all four combinations, trusted typing produced only
“A real note” as the value and hid the placeholder; native Select all/Backspace
restored an empty value and the visible placeholder. The one-row field, focus and
unchecked Add to chat remained intact. Empty submission stayed disabled in the
observed guard checks. These short 109 checks did not repeat 108's multiline cap
matrix or all earlier fullscreen/chat actions.

One own plain comment was saved on dark phone with Add to chat unchecked, then
opened through the list. Its generated heading anchor was exactly 0–21 for
“Compact comment style”, matching the passive highlight. The fake source remained
281 bytes with SHA256
`3e7fb3c71f1d54177d778ff94a562504ae775c3732cd28176445556654b82cac`.
There was one comment, zero replies, no root composer or unsent reply at cleanup.
The named browser closed normally. No chat handoff, external message, production
update, installer pin change or publication occurred.

After this runtime qualification, the source branch normally merged workbook
foundation main `496dff0e1c07001a8ccbfcf897bc9aab4c9d7e18` without comment-code
conflicts. Patched dependencies were refreshed; the 81 focused comment/control
checks, full workspace types, web types and guard passed on the integrated
source. That integration check does not relabel or rebuild the frozen 109 pair,
and does not claim its older worker now includes the newly merged foundation.

![Light desktop artifact pane with the 109 placeholder](images/document-comment-style/light-desktop-placeholder.png)

![Dark 390-wide artifact with the 109 placeholder](images/document-comment-style/dark-phone-placeholder.png)

![Historical 108 dark phone five-row cap; placeholder was absent in 108](images/document-comment-style/dark-phone-capped-108.png)

### Remaining reference and visual differences

Candidate107 had a nested gray textarea fill/focus ring, visibly heavier
than the reference's single-card treatment; candidate108 removes that nested
surface, as the separate acceptance above records. The list fallback at a 640-wide
artifact pane overlaps the heading; narrow-reference comparison and placement
policy remain follow-up work. These observations are not claims of full visual
acceptance. Markup, cross-type anchoring and broader feedback refinements remain
outside this document-only checkpoint.

A fresh reference check also showed Escape discarding an unsaved substantive
comment body without confirmation. Evebot intentionally retains its protected
unsent-draft confirmation. No automatic recipient is chosen for multi-bot
conversations; only an explicitly entered known mention defaults Add to chat.
Host Show all versus in-card list navigation draft-confirmation consistency
remains a separate follow-up, without weakening existing draft protection.

## Candidate105 problems and resulting behavior

Opening Comment before selecting text previously left the selection prompt
unbound. The editor now waits for a completed pointer gesture or keyboard range
extension, then resolves the exact block identities, offsets and quote without
moving focus into the composer. Intermediate drag ranges do not become targets.
Existing drafts and saved threads retain their original target.

Manual inspection then found that the prompt itself could intercept a drag:
the native range ended in its hint text and highlighted the remaining document
and card. The unbound card is now pointer-transparent and nonselectable, with
its buttons and resize control still usable. The existing cross-root selection
refusal remains intact. The prompt can still visually occlude content; its
placement is a separate polish gap.

A retained thread also kept a `flex` display utility while its `hidden`
attribute was set, leaking a duplicate quote and chat button into the list. Its
container now uses explicit hidden/flex states. The thread stays mounted so
returning to it preserves the same reply textarea and unsent draft.

## Frozen candidate and evidence

Candidate 105 was built from clean `891c55c2ca43ca120f431af1c23a79a236503bc2`,
including the separately reviewed workbook style-guard merge. Later changes to
this PR contain tests, documentation and evidence only.

- Source tree: `b71611da8aaccfaae447ed48b26d4507cf9a45e3fa105a42e1751971a24e945b`.
- Companion: `c5ab8941abf875ae281280c3f16e19ef062a3cc1a9b94e6f4b95d96077f1c9ff`.
- Renderer: `sha256:4108ab99df0bc36ff0b0f51375d7d1fb63da4429da9a1e428d6de7c4b16a0cb0`.
- Worker: `03cfef8d890e7f1780a9bb1706e7a9f34335684bee64b6f1830fc32dad76ec9c`.
- Document-color helper: `a8935e725e3ddf66620ec72c356d7c270514c13977969a31c055eda29e7fed8c`.

The focused editor/anchor checks passed 33 cases. They cover completed pointer
and Shift ranges, collapsed selection refusal, authored/generated identities,
retained draft/thread targets, list withdrawal, source preservation and reply
state. Full workspace typechecking and guard passed for the implementation.
The passing class-name-only prompt test was removed: it mirrored utility names
rather than protecting hit-testing. Real browser acceptance owns that boundary;
all anchor, draft and source assertions remain.

Two real-browser cases passed at 1440/light and 390/dark. Each proved that the
physical pointer endpoint was inside the hint before release, no input appeared
mid-drag, and the completed quote appeared without focus theft. They also
checked real list visibility, the same reply DOM/draft after returning, generated
identities after reload and exact working-source bytes. The prior candidate's
1440 case failed at the expected missing-input assertion before this correction.
The complete six-case document-comments suite subsequently passed in one minute,
including the existing theme/size lifecycle cases. Its first attempt hit a
visually hidden native checkbox input; using the real visible label corrected
that driver target while retaining the same checked/unchecked assertions and
explicitly unchecked state before saving. No forced click or DOM setter was used.

Manual inspection additionally repeated the exact previously obstructed
paragraph in dark mode: the endpoint (1369,187) was inside the hint bounds
(1097–1415,162–194), but hit-testing reached the editor. Both native range
endpoints stayed in the paragraph, and release opened its entire quote. Light
390px inspection verified a complete wrapped quote and a clean list. Returning
restored the same reply node and exact draft; the draft was then cleared without
saving. The original generated document remained 321 bytes with SHA256
`cffe54d8c0ef295388223e206bb38fb366733728d9d66a10ba7a9c90bd96bab4`
and one preexisting comment. These checks do not establish universal browser,
reference UI or cross-type acceptance.

Local evidence is retained in `/tmp/comment-first105-green.log`,
`/tmp/document-feedback105-pair-receipt.json`, and the artifact-only screenshots
below. The source-independent archive and other renderer acceptance gates have
separate owners; this record does not claim publication or installer admission.

### Before: the prompt intercepted the paragraph selection

![The old prompt became part of the native selection](images/document-comment-selection/before-prompt-interference.png)

### After: only the complete paragraph becomes the target

![The complete paragraph is bound after release in dark mode](images/document-comment-selection/after-paragraph-dark.png)

### After: the phone-width list contains only its list rows

![The light phone-width list hides the retained thread](images/document-comment-selection/after-list-light-phone.png)

## Next reference-guided slice

A separate manual reference observation found that Comment without selected
text opens the comments list, rather than an unbound selection prompt. That
workflow needs a deliberate type-specific adaptation. An older Lexical selection
can also be reused after reply focus even when the current DOM range is empty;
that remains an explicit gap. Document markup, suggestions and broader comment
placement/interaction parity remain unfinished. This checkpoint does not silently
redefine those requirements as complete.
