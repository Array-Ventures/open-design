# Shared canonical Magic Move candidates

Source `12dd8150283d9d33d3d157cfffdc0432189c0777` extracts the existing browser candidate
collector into the pure `@open-design/contracts/runtime/deck-morph` entry.
`DeckMorphTree` supplies ordered actual element children, tag/attributes and
textContent-compatible text; inert template contents stay outside that tree.
The self-contained compiled collector is embedded into the existing artifact
transition runtime. There is no second matching algorithm or private converter
traversal. The existing transition lifecycle and temporary style restoration
remain unchanged.

Candidate selection and identity preserve the old rules exactly: explicit
Morph ID first; otherwise tag plus aria-label, raw image source or trimmed text,
then data-od-id/id fallbacks. Empty explicit markers fall back. Bare ids on
otherwise unselected tags do not select a candidate. Hidden nodes remain eligible,
Unicode and image URLs are not normalized, and text takes priority over
`data-od-id`. Cross-tag explicit matches remain allowed in the browser. Duplicate
keys remain null, including a third occurrence, at their original insertion
position. The slide root is excluded. The adapter walk is iterative to avoid
introducing a recursive stack limit into the old selector behavior.

Author qualification passes 22 contract cases/4 files (including the built package
surface), 34 actual serialized browser-runtime cases/2 files, and 15 source/capture
cases/2 files. Six source cases compare actual Cheerio collection against the
pre-extraction DOM selector projection; 12 new browser cases exercise actual
injected transitions, expected pairs and style restoration. Nine new pure cases
cover exact keys/order/ambiguity, unchanged input and a 20,000-level adapter tree.
Frozen offline install, dependency build, full workspace/scripts types and guard
exit 0. These are scoped suites, not full daemon/web runs or a new immutable pair.

The [evidence](deck-morph-candidates-evidence.json) retains all source hashes and
logs. The initial nonexistent extra selector ran only six source cases in one
file; final corrected selection runs 15 in two. Two authoring type failures in
test fixtures are retained separately, followed by a complete passing types run.
No assertion, source policy or production type boundary was loosened.

This seam provides presentation identity, not source/edit authority. It does not
prove that saved-source and live-DOM parsing agree for every malformed document,
or authorize facts from an arbitrary adapter. Future export must validate an
admitted source vector against settled prepared DOM and actual native objects.
Browser cross-type matches, split text and raster/composite layers still require
explicit handling/refusal in that mapping. PowerPoint Morph remains unsupported
and unadvertised; actual mapping, complete unmatched-object classification and
PowerPoint playback are later gates. No source files, vendor bundle, preview,
renderer pin or qualified pair was mutated by a runtime invocation here.
