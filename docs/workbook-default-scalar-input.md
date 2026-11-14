# Default editor runs must retain scalar input semantics

Actual immutable candidate 130 accepted and saved the preceding font/layout
corrections, but ordinary numeric typing still had the wrong meaning. On an
owned new TEAM fixture, trusted direct keyboard entry of **28** into blank A1
and F2 entry of **28** into blank B1 both saved as inline strings. Actual GUI
formulas SUM(A1), SUM(B1) and SUM(A1:B1) saved caches **0/0/0**, rather than
28/28/56. The safe artifact-only screenshot and standard-library ZIP/XML receipt
remain at `/tmp/workbook-numeric130-ui/saved-artifact-only.png` and
`qualification.json`. Full host captures remain private scratch.

The pinned SDK considers any styled partial run rich, even when its effective
style is identical to the cell default. The observed first-character color run
and second-character composed font run therefore entered its rich branch. The
existing AFTER_CELL_EDIT preservation adapter then kept them as text. Visible
28 and a successful Save were not proof of numeric input.

## Bounded producer and consumer correction

Existing BEFORE_CELL_EDIT is an open-time cell interceptor; AFTER_CELL_EDIT is
after parsing. The facade BeforeSheetEditEnd event supports cancellation but
is not a supported replacement for the detached submission. The maintained SDK
patch adds one generic **BEFORE_CELL_INPUT_PARSE** key using the existing
interceptor manager. All three maintained runtime entries and public declarations
match. No-handler behavior is unchanged; the actual SDK parser remains responsible
for scalar types, formula spelling, locale normalization, explicit text formats
and apostrophes. No numeric parser or private prototype replacement was added.

The live consumer requires its exact current workbook, actual worksheet,
coordinate and editor. An existing rich cell keeps its original ownership path.
The existing renderer-default guard first checks document layout. Only a plain,
unstructured paragraph whose every explicit run font field equals the current
composed cell font can shed redundant runs in the detached copy. Unknown document
properties, annotations, drawings, paragraph formatting, malformed/overlapping
UTF-16 intervals and nonfinite values keep the original guarded path. Failed
normalization passes the original snapshot; it does not drop the edit. Real mixed
styles and prior rich content remain rich, and the live editor buffer is unchanged.

## Source qualification

Actual CJS/ES/compat EditingRenderController producer regressions each failed
before dispatch existed (three REDs), then passed the hook, numeric command,
original-buffer and no-handler/disposed-registration checks. An exact default-font
consumer regression failed on the previous source before normalization. The
fixture was strengthened to include the actual source default black font; that
source-accurate old-source RED is retained separately.

A production Node Worker test uses real SDK editor submission for both 28 inputs
and all three formulas, then waits for actual cache application. It proves numeric
28/28, no rich documents on those cells, caches 28/28/56 and a healthy owner. Its
first cold run failed before mutation at the unchanged five-second Worker startup
bound. The warm attempt then found a fixture import ordering error: importing the
UI facade before the existing Worker-only FUniver initialized required a browser
render manager. Loading that UI facade after the owner initialized corrected the
fixture; the actual scenario passed without changing deadlines or assertions.
Both failed logs remain, and neither is called a product semantic RED.

Further SDK cases cover apostrophe-preserved 0028, explicit text format, formula
entry, the pinned CJK full-width input normalization, mixed runs, existing rich
text, foreign/current-owner withdrawal and disposal. A first original-rich fixture
incorrectly used the blank-cell producer on its raw rich source; the actual editor's
existing-cell producer deep-clones that source. The corrected fixture asserts the
original documentStyle stays empty before editing, and retains the failure log.
The rich lifecycle test now requires exactly two disposed interceptors, rather
than the former one. No functional assertion was loosened.

Logs under `/tmp` retain `workbook-input-parser-producer-{red,green}.log`,
`workbook-default-scalar-accurate-source-red.log`,
`workbook-default-input-rpc-{first,warm,corrected-fixture}.log` and
`workbook-default-input-source-final.log`. These are source/actual SDK/Worker
proofs, not packaged browser acceptance. A fresh immutable pair must still prove
normal typing, numeric/formula Save and recovery/restore/Save. Candidate 130 and
its failure evidence are not relabeled. Runtime, configuration, publication and
release pins were not changed by this source work.

Final source checks passed **48 cases in six worker-free files**, then the
separate **one actual production-Worker case** passed on the exact final source
(`workbook-default-input-final-focused.log` and
`workbook-default-input-rpc-final.log`). Full workspace types and guard passed;
frozen install passed with the updated patch hash; final web types and guard
also passed. The first type run caught a nullable SDK return-type extraction in
the shared renderer helper; using its public parameter interface corrected the
type without changing admission. That failed log remains.

Plain `git diff --check` interprets added unified-patch context lines (a leading
patch space followed by the SDK's existing tab) as source indentation errors.
Strict checking of non-patch files and patch-aware checking with those context
warnings disabled both pass. The frozen install and actual three-entry tests
validate the patch application; no whitespace rule or repository configuration
was changed.
