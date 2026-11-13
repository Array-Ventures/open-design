# Evebot embedded Studio

## Workbook recovery development — November 11

The editor now connects the account/artifact/editor-scoped IndexedDB journal to
its save controller. Each draft branch has an exclusive Web Lock; restore,
download and deletion refuse branches still edited elsewhere. Closing a branch
drains both the remote callback and queued journal writes before releasing it.
Fresh authorized preview loading precedes recovery reads. Continue opens a new
editor branch and preserves other drafts. A validated recovery JSON download is
explicitly named `.recovery.json`, not presented as an Excel export.

Native navigation must pair with the new `studio:discard-workbook` /
`studio:workbook-discarded` handshake. Deletion acknowledges only after storage
commits; failures retain the dirty editor. An uncertain save blocks discard;
only a checked durable terminal receipt or a verified permanent candidate-removal
fence can clear that pending intent. Generic transport failures retain it. Expired
preparations rotate only after durable candidate removal and a second absent
save receipt, preserving the operation identity and frozen plan.

Focused integration tests pass 92 cases across thirteen files. Full web/workspace
typechecks and the guard are recorded separately by the integration owner.
This is development source, not active preview or release provenance. Actual
browser crash/reload, multiple-tab and permission-revocation acceptance,
download inspection and light/dark visual checks remain required. The existing
owned preview and first-release companion candidate are unchanged by this work.

Manual acceptance against clean development package
`dbcb9c9dc76a1b43b60fa18b92036971ab94bf193e1e12f2bffa9635f5237ef6`
verified reload/restore of an unsaved scalar edit, acknowledged navigation
discard followed by reopening the unchanged file, and refusal to restore/delete
another tab's active draft. Continue opened the original file in a new branch
without replacing the other tab's unsaved value. Light and dark screenshots
were inspected. This pass found further defects rather than clearing release
acceptance: missing Normal-style inheritance made a plain edit create a new
style, recovery-list default indentation was wrong, dark zoom icons lacked
contrast, and the canvas covered the error/download overlay. The adapter and
chrome fixes are now in source and must be checked in the next clean package.
Download inspection, actual crash and revoked-access scenarios remain open.

The next clean package,
`a1532bc3ca09bfeeb3ece700cb58653c598a847b88be40c58f980fc454edc6a2`,
passes manual scalar editing/save with Normal-style inheritance; a value of
13,579 produces the expected saved formula result of 7,579. Intentional bold
formatting still blocks saving instead of being silently discarded. The fixed
overlay accepts a real download click, and the downloaded recovery JSON passes
the draft decoder. Dark recovery-card download and visible zoom icons were
also checked. A deliberate renderer crash (`chrome://crash`, followed by the
browser controller reporting a wedged target) retained an unsaved value of
24,680; a new tab restored it after the crashed renderer released its lock.
This proves renderer-crash recovery, not whole-browser/profile-loss recovery.

Saving the restored value exposed a remount failure: the pinned worksheet
`getRange(IRange)` overload leaves missing or stale scope identities unchanged,
so `setActiveRange` rejects the saved selection. The new adapter binds valid
geometry using the numeric overload and skips out-of-bounds old selections.
Three actual pinned-API regressions pass; all workbook-area tests now pass 106
cases across eighteen files. The saved XLSX was independently reopened: the
latest value 26,000, `B2-C2` formula/result 20,000 and width 20 were retained even
when the old UI failed to remount. Package `fd4f780ad97c9477bf4a72414134a21e69a5742e5803e93ace406ad7d5bd2964`
then passed restore/save/remount in the real browser: 28,000 remained visible,
the independently reopened file retained `B2-C2` with result 22,000, and the
selection survived. Narrow 390px recovery cards were inspected in both themes.
Deleting the final draft reopened the current workbook without an extra empty
recovery screen. Native model/access state was not reset for these checks.

That package also exposed a failed-preparation dead end: entering `SEQUENCE(3)`
in G2 failed calculation without changing the working file, but retained an
uncertain pending intent that refused Discard. The writer now accepts the
transport's identity-bound, permanently removed preparation proof, clears only
that pending intent, journals the remaining edits and permits explicit retry or
discard. A mismatched candidate or ordinary network error still retains the
fence. This follow-up needs packaged browser acceptance; general cancellation
of a genuinely uncertain pending save remains separate unfinished work.

The Evebot integration uses Open Design’s actual visual file workspace while Evebot owns bots, chat, approvals, workspace access, providers, exports and publication. Studio has no separate agent conversation or runner in this mode.

## Runtime boundary

`daemon-startup.ts` selects `embedded-server.ts` when `OD_EMBEDDED_STUDIO=1`. The dedicated entry point never imports standalone `server.ts`. Direct calls to the standalone entry point reject embedded mode, preventing an accidental fallback to its agent/routine runner, connector refresh, cloud publishing or diagnostics startup.

The embedded server reuses upstream file, preview, version-history, upload and comment handlers. Preview-scope management and SSE transport are shared modules, not parallel implementations. Local file watchers serve active Studio clients and close with their subscriptions. The ordinary standalone entry point and its capabilities remain available with embedded mode disabled.

The host supplies an explicit loopback port, private companion state directory, private persistent workspace root and server-only service credential. See the [daemon data directory contract](../AGENTS.md#daemon-data-directory-contract) for general path rules. Embedded state is Linux-only because file containment and process identities use pinned descriptors and kernel process start identities.

`installEmbeddedStudioBoundary` authenticates every operation except basic health and admits only the selected local file-workspace surface. There is no generic agent, terminal, import, provider-settings or cloud-deployment API. Evebot performs the current human/bot workspace-access check before proxying a request; the service credential is never passed to the browser. Registered project identities bind only to host-selected private, group or team project directories. Files and uploads retain the descriptor-based containment checks even when a sandbox changes directory entries concurrently.

`GET /api/health` identifies the `embedded-studio` profile. Supervised operation additionally exposes an authenticated runtime nonce/build/PID attestation. Evebot checks both before admitting the generation. Maintenance and runtime-control endpoints are excluded from human/bot project gateways.

## Web workspace and creative capabilities

The embedded web entry renders the visual file workspace instead of the standalone application’s chat/agent shell. Authoring prompts and comments return to Evebot’s existing conversation. Evebot bots use their own direct tools and adapted guidance; Studio does not gain provider credentials or start an independent agent.

Image generation, retained exports, editable PowerPoint, local media/HyperFrames rendering, dashboards and internal publication are host-owned capabilities. Their authority, durable jobs, cancellation and approval rules belong in Evebot. Embedded Studio must not restart the upstream cloud counterparts as a substitute.

Creative catalogue guidance and asset manifests are served through the embedded catalogue boundary. Evebot retains reviewed project guidance and stages selected assets in the corresponding sandbox. Resource/asset licence review remains required before shipping a paired fork package. The final Evebot BoardUI adaptation is separate from this runtime boundary.

## Paired package

```sh
corepack pnpm exec tsx scripts/build-embedded-companion.ts --out "$STUDIO_BUILD_DIR"
```

The builder requires a clean pinned fork commit and a fresh output directory. `--allow-dirty` is for isolated development fixtures only. The receipt records source/build identity and the complete relocated application inventory, including file checksums and contained dependency links. A paired host must verify the expected digest before execution; it must not discover or silently replace a live upstream version.

Legacy pnpm deployment may hard-link generated dependencies back to the
checkout. The builder now materializes independent regular files before native
addon changes and before final inventory; symlinks remain subject to the
existing containment checks. Never bypass a checksum mismatch after another
workspace build. Run `corepack pnpm exec tsx scripts/test-package-hardlinks.ts`
for actual alias-mutation, executable-mode and symlink regressions, and qualify
each packaged candidate again after rebuilding workspace dependencies.

The standalone web server renders embedded project pages at request time so they do not write per-project cache files into the verified application package. Writable home, runtime state and workspace files are supplied separately by the host.

## Recovery

The companion keeps SQLite and its managed version storage. `embedded-files/state-snapshot.ts` captures verified standalone SQLite plus those files under an operation/build receipt, then verifies the complete inventory before publication. Its restore prepares a fresh destination and requires the matching companion build before migration.

Snapshot APIs require a host-provided offline assertion before and after copying. An HTTP maintenance lease alone cannot prove filesystem quiescence: the host must stop every supervised writer, verify recorded PID/UID/start identities have exited, and hold its exclusive lifecycle lock. Evebot also coordinates its own Postgres, workspace and retained-artifact members. No cross-store atomicity is implied by the companion snapshot API.

## Focused verification

```sh
corepack pnpm --filter @open-design/daemon exec vitest run tests/embedded-server.test.ts tests/daemon-startup.test.ts tests/routes/embedded-studio.test.ts tests/sse-response.test.ts tests/project-preview-containment.test.ts tests/server-bootstrap-regression.test.ts
corepack pnpm --filter @open-design/daemon typecheck
corepack pnpm guard
```

The embedded boot test makes standalone `server.ts` unavailable, then exercises real file/preview/history operations, multipart uploads, comment identity, tabs and streamed bot filesystem changes. It also checks containment and structured error responses. Paired-host verification must additionally exercise the relocated package, supervisor death, interrupted restore, current access checks and the actual desktop/mobile Studio UI. Real install-unit checks belong to the owner; the focused fork fixtures do not operate them or call paid providers.

Follow the repository’s focused-test policy; do not run the full daemon/web suites for this change.

## Embedded surface audit

The dedicated composition root registers the following surface. The service
credential authenticates the host; Evebot must still authorize the current
actor/project on every forwarded request.

| Surface | Owning boundary |
| --- | --- |
| Project registration/read | Host-selected private/group/team directory shape; no generic directory import or scope move |
| File/folder listing, reads, writes, rename and deletion | Embedded branches in `projects.ts` and `embedded-files/pinned-project.ts`; directory descriptors, no-follow opens, ordinary single-link files and entry/path limits |
| Multipart upload | `embedded-files/upload-storage.ts`; bounded streaming, exclusive temporary files and no-overwrite commit |
| Raw/preview/text/document reads | `project-file-access.ts` opens the pinned file; preview scopes/opaque documents and actual decompression limits remain separate controls |
| File history and comment identity | Managed private companion storage, version locks and contained source reads/writes; not a second project workspace |
| Tabs, comments and change streams | SQLite/project-bound identities; bounded pinned watcher and subscription cleanup; no messages or agent runs |
| Resource details, including legacy skill/template aliases | One catalogue handler, supplied repository/asset notices, digest and restriction checks; no alternate raw guidance handler |
| Rendering/export/publication | Host-owned durable APIs; no standalone cloud deployment or generic execution endpoint |

File/folder inventory charges a total 10,000 visited entries before recursive
descent, including empty directories and ignored entries. A per-directory
bound alone does not limit a wide tree. The descriptor path helper additionally
limits path depth to 64 segments. Watchers and recursive deletion have their own
entry/depth budgets; do not replace them with path-string recursion.

The embedded JSON parser admits at most 64 MiB. Multipart requests admit at
most 12 files of 200 MiB each. Project byte reads are bounded separately, and
text preview reads at most 512 KiB. Document archives use actual inflated-byte
limits rather than trusting ZIP sizes. These are admission/read limits, not a
total persistent-workspace disk quota. Existing bots can write their persistent
workspace directly; Studio does not claim to cap that storage or automatically
delete source/history. Host retained exports/publications have their own shared
storage quota and explicit removal/recovery policy. Operators must account for
persistent source and companion history in disk capacity and backups.

Catalogue resources belong to the verified companion package, outside the
bot-writable workspace mounts. Their path/integrity checks do not authorize an
arbitrary bot-provided resource root. A catalogue restriction heuristic is not
a legal certification of every upstream asset or provider term.


## Structured document checkpoint

An embedded document project can opt a semantic HTML file into rich editing with `data-eve-document="1"` on its HTML element. The initial editor supports headings, paragraphs, emphasis, lists, tables, font family, undo/redo and serialized saves. Stable `data-od-id` block identities survive supported imports/exports; pasted copies receive new identities. Files containing media or form nodes that cannot yet round-trip remain in their existing viewer. Legacy applications are never silently converted into a document.

Manual HTML saves may supply `expectedContentSha256`. Under the existing managed file-version lock the daemon compares actual bytes, rejects a conflicting base with `FILE_CONTENT_CHANGED`, and admits identical-content retries after a lost response. This lock coordinates managed writes; it does not claim an atomic compare-and-swap against arbitrary external filesystem writes. The editor serializes saves against each acknowledged base and retains edits after errors. Its dirty-state host bridge is source/origin/project checked by Evebot, which owns navigation confirmation. In-flight writes and failed unknown-commit attempts remain dirty; retries reconcile an uncertain attempted body before draining newer edits. Hosted editors wait for the viewer identity and reset across actor changes. Clean external revisions remount the editor; own-save acknowledgements preserve its caret/undo instance. Dirty external reads remain pending. Manual reload rechecks draft/save revisions after confirmation and after the read. Transport refresh failures retain the current editor, while explicit denied/missing reads withdraw it.

This is a partial document implementation, not full reference parity: Markdown editing, media nodes, document comments, suggestions, richer tables and genuine DOCX/PDF exports still need implementation and fidelity checks. The embedded source continues to own no model chat or cloud publishing.


Document typography now follows the inspected continuous-writing layout: larger writing type, a constrained writing column and separate Headings/Text font choices. Canonical files carry `data-eve-document-font` and `data-eve-document-heading-font` (`sans` or `serif`). Files without the new heading attribute retain their existing whole-document choice. The editor and standalone output use the same explicit font-family mapping across all six supported heading levels. Save errors now expose a confirmed Load latest action without depending on SSE; unknown initial dashboard authority still blocks its normal path, while known-empty dashboard polling no longer adds unrelated warning chrome.

### Markdown document editing

Markdown (`.md` and `.markdown`) uses the same content-first document surface and conditional file-version path as marked HTML. The saved working file remains Markdown: standard headings, lists, task lists, fenced code and GFM tables serialize as Markdown; formatting not expressible in Markdown uses inline/block HTML. A validated `eve-document` HTML comment stores independent font choices and block identities. Identities are restored only when the exact body digest matches; external edits invalidate that receipt rather than guessing annotation anchors. History snapshots preserve the actual Markdown bytes.

A focused editor roundtrip covers text edits, table cells, task state, fenced code and identity restoration; file-boundary coverage checks exact UTF-8/BOM digests, genuine Markdown saves and deterministic retries. Conditional route tests cover immutable history and stale-save rejection. This is not a claim of full document fidelity: images, richer authored styles, document comments, history UI and genuine DOCX/PDF export remain incomplete. Direct filesystem writers still do not participate in the daemon write lock. The new Markdown surface still requires manual verification in the packaged host before acceptance.

The bottom insertion chrome follows the inspected reference: Checklist has a compact direct action; bulleted/numbered lists, Quote and Code block live in More. BoardUI owns the toolbar/menu primitives and theme tokens; Lexical owns editable document semantics.

Targeted independent review found and verified fixes for embedded backtick fences/spans, literal Markdown/HTML text, entity-looking link URLs/titles, relative links, hard line breaks and GFM column alignment. The current serializer preserves those through real mounted unrelated-edit/save/reopen regressions. Unsupported link protocols stay in the existing viewer instead of entering a destructive editing path. Focused document tests pass 51 cases across eight files, and three daemon history/route suites pass 33 cases. The reviewer ran no tests or browser actions; these counts come from the implementation agent's local runs. Manual packaged Markdown acceptance remains pending.

The first packaged Markdown browser pass (build 74) rendered real Markdown in the rich editor, autosaved typed text, toggled a task through keyboard focus and Space, and reopened it after a full reload. Authorized raw reads confirmed Markdown bytes, both task states, fenced code and the relative link; history listed three immutable versions. Visual comparison with the reference exposed a tiny checkbox glyph whose negative offset missed Lexical's pointer hit area. The follow-up uses a 16px rounded box inside the list item's hit region, checked-text styling and keyboard focus indication. Code insertion now adds a block at the cursor instead of converting the existing paragraph, matching the observed reference; block spacing is explicit. These visual/pointer follow-ups still require packaged manual acceptance.

### Document export implementation checkpoint

The contained renderer now prepares Markdown as a semantic document, and adds `docx` and `markdown` outputs. Word uses a checksum-pinned Pandoc 3.13 binary with embedded data, its reader/writer sandbox and a timeout/heap bound; the renderer container retains no network or credentials. Local images/styles use the existing standalone bundler before conversion, and unresolved remote dependencies refuse Word conversion. Interactive content is not flattened into a document. Word contains editable paragraphs, runs, tables and embedded local images. Plain Markdown omits the validated internal identity/font receipt.

Document metadata/font choices and standalone styling now live in the pure shared contract module, consumed by editing and rendering. The authorized disposable reference's downloaded PDF and Word files were inspected directly. PDF uses Letter paper, three-quarter-inch margins, a title header and page footer; Word uses compact body/heading sizes and one-inch document margins. The current implementation preserves the editor's independent font choices while following those export geometries. The PDF layout changes still require a rebuilt worker's visual acceptance.

The full contained export matrix passed against the development worker before the final PDF/Word typography adjustment, including genuine DOCX structure, local images, exact Markdown bytes, active/remote input refusal and existing media/deck/dashboard exports. Native UI exposure and dirty-document protection are being paired separately in the host. This checkpoint is not release provenance or completion of the full artifact goal; the source is still under development, and the owned preview has not yet loaded these export changes.

The final development worker matrix passes after the print changes, including all new document cases and the existing media/deck/dashboard cases. Its PDF was rendered to a page image and viewed next to the downloaded reference: Letter dimensions, inset writing area, title header and page footer are now present. Font files differ: the reference embeds its own print fonts; this renderer uses its existing free system fonts, so this is not proof of identical glyph metrics. The latest focused source suites pass 51 web and 13 admission/style/header-safety cases. Packaged host export/download acceptance remains pending.

### Explicit worksheet CSV export

XLSX CSV export requires `sheetId` and `workbookSourceSha256` from the active
acknowledged grid. Both are frozen in the host's ordinary render job. Only CSV
exports from XLSX accept these fields; edit plans, restore and capture options
cannot be combined with this export. The worker validates the digest and visible
worksheet membership inside the snapshot, without interpreting sheet identity as
a filename. Source files remain read-only.

Output is UTF-8 (no BOM), comma-separated, CRLF terminated and RFC4180 quoted.
It exports raw stored values through the last nonblank cell, including hidden
rows/columns. Booleans use TRUE/FALSE; date numbers remain Excel serial values;
rich strings use their full text. Formula caches are exported exactly as saved,
without recalculation; a formula without a cache refuses output. An empty sheet
produces empty bytes. The limits are one million output fields and 50 MiB.
The export dialog names the selected sheet and states the saved-cache policy.
CSV-from-CSV retains its existing exact-source/edit-plan behavior. Browser and
paired-package acceptance are still required; these are source-qualified changes.

## Single-save continuation after a cancelled preparation

A matching `WorkbookSavePreparationCancelledError` is a durable no-future-write
proof, not an ordinary HTTP error. The writer can continue one explicit Save
through reconciliation and one fresh preparation after the cleared pending
identity is journaled successfully. The replacement snapshots the latest desired
edits, including typing during that checkpoint. A second cancellation in the same
flush stops with retained edits instead of retrying indefinitely.

Different operation/preparation/render proofs keep their pending fence. Device
storage failures and a closed writer cannot launch a replacement. Conflicts,
uncertain transport errors and failed preparation errors retain their existing
semantics. Three new behavioral tests first reproduced the two-click defect;
all 54 focused writer/save/discard tests now pass, along with guard and workspace
typecheck. Packaged/native browser qualification is a separate following gate.

## First-cell worksheet navigation

The pinned grid has no Ctrl+Home binding. A native browser check reproduces that
selection remains on the formula cell rather than returning to A1. The embedded
grid now registers a view operation and shortcut through the pinned command/UI
services. It uses the engine's focused, non-activated sheet-editor precondition
and the grid's current/readiness guard. It selects A1 through the scoped facade
and scrolls it into view; it never creates a cell mutation or save intent.
Registration belongs to the view layer and is disposed when that layer retires.
The already lazy-loaded kernel supplies UI services, avoiding an eager UI import.
Guard and workspace types pass; packaged browser focus/editing/chat checks remain
the acceptance gate for this change.

### View-resource ownership correction before activation

Source review found that adding navigation through a second `layer.own()` call
would replace the existing kernel/worker cleanup. The first navigation package
was not activated. Ownership registrations now compose in reverse order, release
earlier resources even if a later disposer throws, and immediately release a
resource registered after its layer retired. Four focused browser-DOM resource
regressions first fail on the old replacement semantics, then pass; the combined
layer/selection/format suite passes eight cases. Initial test attempts lacked a
DOM environment and are not counted as behavioral reproduction. Guard and full
workspace typecheck pass. A new clean package must still pass paired-browser
acceptance before this navigation change is considered active.

### Programmatic selection metadata

Package39 manual inspection showed the canvas returning to A1 while the native
format controls retained the prior formula-cell state. The keyboard focus wait
alone did not resolve it. In this pin, the facade's programmatic selection emits
selectionSet, whereas onSelectionChange observes move-end (and supplies an
immediate initial value). A real pinned-runtime regression verifies that the
completed SetSelectionsOperation contains the new scoped range without a new
pointer callback. The grid now republishes formatting and export metadata after
that completed view operation, without creating an edit checkpoint. Nine focused
selection/format/resource tests, guard and workspace types pass. A fresh paired
package remains the browser acceptance gate.

## Workbook package ownership boundary

The current reader admits the canonical `xl/workbook.xml` root, canonical
`xl/sharedStrings.xml` and `xl/styles.xml` owners when present, and worksheet
relationships selecting `xl/worksheets/sheetN.xml`. Relocated or ambiguous
importer parts, canonical shared-string/style files without their owning
relationship, and multiple theme owners return `WORKBOOK_UNSUPPORTED` before
importing values.
This prevents combining relationship-selected cells with a different part’s
strings or formatting. Refusal leaves the original input bytes untouched.
General relocated OPC support remains unfinished: it needs an import-only
normalized view and relationship-derived ownership in every source writer;
reserializing the original workbook through the importer is not a substitute.

## Build source provenance

Companion and renderer packaging share a source identity captured before build
work and checked again before the receipt is written. The identity includes
HEAD, clean/dirty state and authored-tree SHA256, including untracked source in
explicitly allowed development companion builds. Production renderer packaging
requires clean source and a fresh output directory; its provenance records the
pinned tree digest and includes CSV in the supported formats. A changed commit
or source tree fails packaging rather than attributing existing output to the
new source. Next’s generated type-reference file is excluded from the tree
digest and companion builds restore it before checking the final identity.
Authored source symlinks are unsupported, including symlinked parent directories
and the generated type-reference path; both initial capture and final checking
reject them, even in dirty development builds. Dependency links under ignored
`node_modules` are outside this authored-tree identity. Package inventories and
pinned dependency installation remain separate build/distribution gates.

Focused source-identity regressions: `pnpm exec tsx scripts/test-build-source.ts`.
Workbook admission regressions: `pnpm --filter @open-design/daemon exec vitest run
tests/artifacts/workbook-reader.test.ts`. These commands are validation gates,
not a claim that the current snapshot has passed them.

## Mention defaults for comment chat staging

The embedded generic and structured-document root composers use the same **Add
to chat** checkbox. A complete host-provided bot name in an actively edited root
comment checks it by default, including when editing a saved root. Emails,
unknown names and partial handles do not. A person's explicit checkbox choice
wins through further typing, more mentions and temporary permission loss. Each
new target starts a new choice; merely opening an existing saved thread does
not stage anything.

The checkbox only controls the existing explicit save-and-stage action. Mentions
never send a message or invoke a bot by themselves. Permissions still gate both
editing and staging, and failed handoffs retain their existing retry flow.
Replies keep their existing separate save/reply and chat-staging controls; they
do not gain an implicit mention-triggered handoff.

## Worksheet visibility slice

Ordinary XLSX worksheets support hide/unhide through the host header's scoped
visibility bridge and the existing sparse edit plan. `veryHidden` worksheets
remain source-owned and are omitted from actionable controls. Signed or
macro-bearing files, workbook protection, custom workbook views, unknown or
duplicate sheet IDs and hiding the last visible worksheet are refused. Names,
order, geometry, cell formulas and relationships cannot change through this
slice. A newly qualified `worksheetVisibilityEditable` preview flag controls
availability; absent metadata does not grant permission.

The contained renderer patches workbook sheet state and reconciles affected
active/first tabs and worksheet selection flags. A visibility-only save retains
formula caches and every unrelated OOXML part rather than recalculating or
reserializing the workbook. Combined cell saves calculate first and apply
visibility to that private candidate. Saves retain the existing preparation,
CAS, receipt, protected draft and binary-history/restore boundaries. Header
messages require parent origin/source, controller and acknowledged source digest;
controls are unavailable during startup, saving, discard or blocked history.

Row/column insertion, sheet rename/reorder/create/delete and editing very hidden
worksheets remain unsupported. Source and regression changes in this slice need
central qualification and paired-package visual acceptance before availability
can be claimed; this section does not report tests or publication.

### Source-owned slide background identity

Slide background edits use a unique source path stamped before authored scripts
execute, together with the exact srcdoc transport generation. Runtime slide
indexes are navigation state, not source ownership: same-count DOM reordering
retains a slide's stamped identity. Duplicated/cloned paths, missing identity,
stale document generations and source changes refuse source editing. Legacy
runtimes can keep reporting count/index without gaining this editing capability.

The source lookup applies the same nonvisual speaker-notes removal as the preview
before resolving element-only paths. The actual write still changes only the
selected slide's raw opening-tag style attribute; notes and unrelated source
bytes remain untouched. Runtime-reordered speaker-note arrays and export order
remain separate fidelity requirements; background ownership does not qualify
those broader cases.

### Source-preserving workbook row and column actions

Structural projections remove the derived Excel calculation chain together
with its relationship and content-type override. This also applies when no
scalar cell edit exists: moving a constant formula keeps its spelling but
invalidates the chain's old coordinate. The existing cell-content writer shares
the same cleanup; empty structural plans and unrelated ZIP parts are preserved.

The candidate exposes compact BoardUI insert/delete actions only when the source,
current editor, calculation worker and permissions all advertise the qualified
capability. Read-only, unsupported, saving, retired and recovery-blocked editors
keep these actions unavailable. The structural helpers establish source ownership
before enabling these menus. `grid-structure-identity.ts` stamps editor-only row/column identities in
Univer's supported custom metadata. Actual pinned SDK tests prove sparse blank
axes retain identity through insert, delete, save, undo and redo, including a
restored cell, row height and unrelated custom metadata. Aggregate axis metadata
is bounded at 100,000 entries; it is not allocated for a million-row workbook.

`workbook-structure.ts` validates a monotone partial source→current mapping;
inserted axes are null, deleted source axes are absent, and reorder/duplicate
ownership is rejected. Inserted axes receive stable editor-generation birth IDs
before the SDK records redo parameters, so the next save can map relative to an
acknowledged inserted axis without rewriting or losing pending cell edits. `structure-formulas.ts` uses the pinned lexer and range
parser for actual references, absolute flags, quoted sheet names and whole-axis
ranges. It leaves quoted strings unchanged, shrinks surviving ranges and emits
`#REF!` when a referenced range is completely deleted. It does not regex-replace
A1-looking text throughout a formula. The lexer also labels bare defined names
and table prefixes as functions; admission distinguishes real calls and refuses
those unsupported references.

The source-only `structure-patch.ts` preservation primitive moves retained cell
XML with its style/shared-string identities, row/column dimension metadata and
supported merged ranges, updates selection/scroll references, and leaves unrelated
ZIP members byte-identical. Column ranges split around inserted columns rather
than giving those columns an unintended source style or hidden state. Formula
caches are removed before the existing contained calculation/CAS path may admit
an output. The strict structural plan now reaches the contained preparation/calculation
path and the existing conditional save protocol; the primitive itself still
cannot persist a live workbook.

Initial exclusions are explicit: named/table/external/3-D references; arrays and
shared formula groups; macros/signatures; charts/drawings/comments/pivots;
frozen/split panes; protected or unknown coordinate-bearing metadata; deleting
a surviving merged range's anchor; and reference growth outside Excel limits.
These need qualified owners or an action-level refusal before any SDK mutation.

The reader advertises structural capability only after independent source/part
inspection and a bounded metadata budget. Plans include the acknowledged SDK
window sizes as well as origin maps: a blank 100-row reader window may represent
a 101-row inserted or 99-row deleted SDK grid after saving. The source worker
requires those declared sizes to cover all retained content/dimensions/merges,
and shifts valid Excel coordinates beyond that window as a virtual tail. It
never trusts a large authored dimension or injects a proprietary file extension
just to preserve an editor window. Repeated blank-window insertion/deletion and
out-of-window formula-reference regressions cover this distinction.

The local package 94 candidate passed both light/dark browser cases with actual
row/column insertion and deletion, SDK undo/redo, keyboard-only Shift+F10 and
Escape, immediate post-acknowledgement menus and independent saved-XLSX checks.
Bounded mutation/identity checks, conditional save/recovery and contained source
qualification are covered separately. This is local qualification, not an
installer pin or publication. Manual menu checks passed light/dark at wide and 390-pixel widths, including
padding and bounded edge flipping. An intermittent blank initial client bootstrap
remains under investigation; the native
`docs/workbook-structure.md` records the exact package identities and failures.
Unsupported SDK menus remain disabled.

Structural save qualification now forces content recalculation before ordinary
dimension/style/visibility owners, which normally skip unnecessary recalculation.
A regression combines structural-only insertion with inherited height, bold and
a hidden summary sheet and independently reopens correct formula caches.

The scalar admission boundary reuses the existing qualified execution-kernel
set. Bounded ranges are accepted only inside qualified scalar reductions;
whole-axis formulas, unknown kernels, broadcasting, text concatenation, spills
and array literals remain unsupported. The geometry formatter can transform
whole-axis reference syntax, but that is not a calculation-fidelity claim.
Finite qualified references may enlarge the logical preview within existing
area/axis/work budgets; authored dimension XML is still not trusted. Unsupported
source caches remain untouched, and the source worker repeats this qualification
before returning any candidate bytes. Independent source/worker review and
packaged interaction qualification do not expand that admission matrix.

Reduction admission also refuses operators on raw range arguments (for example
`SUM(A1:A2*B1:B2)` and `SUM((A1:A2)+1)`), including grouped/unary forms. Ordinary
scalar arithmetic outside a completed reduction remains supported. The source
worker independently rejects iterative/display-rounded calculation metadata.

Acknowledged structural drafts can retain blank SDK axes beyond the fresh XML
reader's materialized window. A clean acknowledged window is not a new edit.
When a later style or dimension edit needs one of those validated coordinates,
the plan carries an identity structural projection instead of another insertion.
The contained writer retains that projection's bounded window only through its
calculation/formatting reparses; the real requested XML style or dimension then
materializes the coordinate. Returned geometry comes from the final bytes, not
the temporary floor. No placeholder cells or free-form window authority are
introduced, and ordinary plans without qualified axis ownership keep their
existing source bounds.

### Scalar worker completion ownership

The pinned engine legitimately finishes an unrelated literal edit with
`NOT_EXECUTED` and no scalar-result mutation. A typed no-result terminal ends
the existing liveness deadline only after the matching dependency graph arrives.
It does not promote stored formula caches into calculated values. Structural
changes with surviving formulas instead require a fresh forced scalar pass;
removing the last formula ends liveness without manufacturing a result.

Every authored input mutation carries an explicit monotonic host input epoch
through the pinned RPC execution options. Worker graph, scalar and no-result
proofs echo that epoch as well as the exact input digest and worker generation.
This rejects delayed never-settled results even after inputs change A→B→A.
The maintained RPC patch snapshots options at queue admission, since compound
callers may reuse the mutable execution-options object. Refreshing that pin
requires the production-RPC shared-options regression: without the patch,
the actual transport sent repeated epoch 3 and the worker refused the stale
stamp; with it, the authored wire sequence is 1,2,3.

Controller regressions cover out-of-order graph/terminal delivery, invalid or
stale terminals failing to evict a current candidate, monotonic graph ownership,
and the structural scalar requirement. The production-RPC cases separately
exercise genuine engine no-result completion and cold structural recalculation.
### Structured document table actions

The bounded Lexical table context menu and its ownership/persistence guarantees
are documented in [document-table-actions.md](document-table-actions.md).
It reuses the free embedded BoardUI menu adapter while preserving the workbook
keyboard capture and source-reset behavior. Its browser/visual qualification remains a separate gate.


### Markdown code export ownership

[document-markdown-code.md](document-markdown-code.md) records the native fenced
code normalization, whole-code HTML fallbacks, actual contained Pandoc evidence
and the remaining inline-code whitespace import limitation.


## Sheet actions: source foundation only

`workbookSheetProjectionSchema` and the daemon's `sheet-patch.ts` /
`calculateWorkbookSheetEdits` provide a standalone, source-preserving foundation
for ordinary scalar worksheet rename, blank append and deletion. The optional `sheets` field is accepted by `workbookEditPlanSchema` and dispatched
by the real contained render consumer; it does not advertise a preview capability
or enable SDK UI actions. CSV explicitly refuses sheet, visibility and axis
structure owners. Existing plans without `sheets` keep their original path.

The final ordered projection preserves imported numeric IDs, admits new bounded
numeric births only above the source maximum, and refuses survivor reorder or
insertion before survivors. The importer qualification caps IDs at 65,535, below
the XML unsigned limit, and fails closed on exhaustion. Names use the pinned
SDK's UTF-16 length bound and locale-independent lowercase conflict comparison;
invalid XML controls and lone surrogates are additionally refused. New sheets
are blank and visible unless a combined final visibility edit changes that.
At least one final worksheet must remain visible.

The source owner rewrites parsed qualified references, not formula text
substrings; deleted references become real calculated `#REF!` errors. It owns
workbook membership, checked relationships, content types, view indices and the
ordinary extended-properties Worksheets title/count vectors. Unsupported title
vectors, custom property parts, very-hidden sheets and reference-bearing
features outside the current scalar structural admission are refused. Surviving
IDs/parts/styles/shared strings remain owned by the source package; a no-op
projection preserves all package-member bytes and stored caches. Formula-bearing
changes clear derived caches and use the existing source calculator,
not blanket workbook serialization.

Remaining before UI exposure: qualify the actual packaged contained process
and expose a source capability only after extending SDK identity/diff extraction, actual command/RPC
admission, input epochs and scalar completion; preserve birth identity through
undo/redo, protected checkpoints, ACK/rebase, draft recovery and history; connect
conditional UI; then run actual export/crash and manual visual qualification.
The source tests do not establish those unimplemented delivery/UI properties.


### Sheet plan carrier boundary

`workbookEditPlanSchema.sheets` is a strict final projection, and every accompanying
cell/axis/style/dimension/visibility edit must target a final sheet ID. The actual
`embedded-render/workbooks.ts` consumer validates the source SHA before dispatching
it to `calculateWorkbookSheetEdits`; no sheet projection is parsed and ignored.
Renderer source tests produce and reopen actual XLSX output, exercise real
`#REF!` calculation in preview output, and refuse replay against changed source
bytes. These tests invoke the render entry directly, not a running container.

The companion save/preparation and cancellation transports retain the complete
plan. Native contracts intentionally keep its JSON opaque: the host/API bridge
carries the original string; `inlineWorkbookPlan` freezes exact UTF-8 bytes and a
manifest SHA, and the existing render input digest fences changed-plan replay.
The native carrier regression uses the real private-database admission machinery
with a fake render container, proving transport/hash/replay and pending-save
idempotency only. It does not prove workbook calculation, delivered CAS cuts or
sheet-aware crash recovery. The conditional receipt/history owner still commits
prepared binary bytes; its protocol is unchanged.

Protected UI checkpoints remain stricter than schema acceptance: their pending
plan must equal the independently derived snapshot plan. Until real sheet birth
identity and SDK derivation land, a pending sheet projection is refused without
replacing the prior protected draft. No UI producer or sheet-action capability
is enabled by this carrier step. Positive multi-ACK/rebase/protected draft/history
and actual packaged crash qualification remain mandatory in the next slices.
