# Embedded BoardUI source

The button, checkbox, input, label, hint text, `cx`, directional-icon helper, theme and typography sources here are
adapted from the installed free BoardUI components and styles in Evebot's
`apps/web`. They are kept in this explicit embedded boundary, separate from
Open Design's standalone component styling. No Pro source is included.

The adaptations are React 18 `forwardRef` compatibility, the semantic
`text-on-accent` name, scoped theme selectors, the bundled Inter families,
opaque icon children required by existing workspace actions, and disabling
press scaling. `controls.tsx` maps upstream button variants and sizes through
the React-only `ButtonRendererProvider` seam. It preserves caller handlers,
refs, accessibility attributes, form type and disabled state. Portal controls
inherit the same React provider. Ordinary upstream buttons have no override.

`styles.css` imports Tailwind's theme and utilities without preflight, then the
actual BoardUI theme/type ramp. Utilities are important so upstream unlayered
primitive CSS cannot silently replace their semantic styles. Do not add a
second lookalike button or rewrite each upstream action to implement a theme.

Changes here need focused provider/embedded tests, typechecks, stylesheet
compilation, and packaged light/dark visual testing. Authored document styles
remain independent inside their preview documents. The final complete visual pass remains separate from focused adapter coverage;
changes to raw workspace controls also require inspection.

The React-only `InputRendererProvider` maps supported shared text inputs to the
installed BoardUI `InputBase`, keeping native change events, labels, refs and
constraints. File, hidden and other specialized input types return null to
retain the original native renderer. The shell receives the existing layout
class. The value-select adapters below cover the inspector choices; specialized raw
controls retain native semantics and require visual review when changed.

The three workspace feedback/comment/speaker-note textarea call sites now use
the shared `Textarea` with `unstyled` fallback. Without a host provider this
retains their existing native classes and DOM attributes. Embedded rendering
uses the actual BoardUI `TextareaBase`, adapted for React 18 refs and native
explicit-height preservation. Change events and multiline values retain their
original API. Textarea sizing tests include an explicit caller height, which
upstream previously cleared even with autosizing off. These adapters have passed packaged multiline-comment and authored-style browser checks.

The two inspector choices now use `ValueSelect` and `ValueSelectRendererProvider`.
This is an explicit string-value API, so the embedded BoardUI Select can report
selection changes without fabricating DOM events or pretending to retain a
native select ref. Outside the provider it renders the existing label/native
select pair. The inspector keeps its original `setVal` callbacks. Keyboard-open
and option-selection tests cover the embedded implementation. Select/menu/icon
helpers are retained from the same installed free BoardUI source.

The live manual editor’s DropdownRow and FontRow also use the value-select
seam. Empty/inherited and custom options, focus callbacks and disabled state
are retained. Its native standalone chevron is preserved and hidden only in
the embedded body, where BoardUI supplies the arrow. The older InspectPanel
was not the only choice UI; manual-editor regression coverage is required.

The manual editor footer uses shared Buttons with `unstyled` standalone
fallback, preserving the upstream DOM classes while the embedded provider
supplies the actual BoardUI button. Paired fields put labels above values,
and footer history/draft actions occupy separate rows. These embedded-only
layout rules and field color aliases live in EmbeddedStudio.module.css; they
use the installed BoardUI type ramp and semantic colors, including dark mode.

The host palette keeps its original bounded 20-color shape and accepts an
optional complete six-color `accentRamp` extension. Together they supply all
11 accent shades used by the installed BoardUI hover, pressed and dark-state
styles. Older hosts may omit it; applying an older palette clears previous
inline ramp values. Supplied extensions reject extra/missing keys, unsupported
colors and CSS declarations through the same validation boundary.

PPTX/image/template dialog footer actions use the same shared Button adapter
with unstyled standalone fallback. Embedded dialog headings use the installed
host title ramp; source/export callbacks and native radio semantics remain in
the upstream dialog.

Dashboard overflow actions use the installed free BoardUI Dropdown source,
with relative imports and React 18 RefObject compatibility. Embedded icon
controls use the small size and center opaque upstream icon children.

The file-category tabs use the installed free BoardUI underline Tabs source.
The embedded copy omits the unused React 19 ref prop API for React 18, reads
React Aria's locale directly, and uses semantic inactive count surfaces. The
Tab/TabPanel association and arrow-key navigation remain owned by React Aria.
