# Namespace aliases in workbook import

The pinned ExcelJS reader dispatches lexical XML names. A valid `ss:worksheet`
therefore failed even though the source preflight correctly recognized its
SpreadsheetML expanded name. The production reader now supplies a private,
bounded canonical import view of the relationship-selected workbook, worksheets,
styles and shared strings. The direct Normal-style importer uses that same view.

The original package map remains the source owner, including its namespace
prefixes, unrelated bytes and hash. Saves patch that original package; they never
serialize the ExcelJS workbook. The import view changes only supported
SpreadsheetML names and relationship attributes. Foreign elements retain explicit
prefixes, and foreign names colliding with the supported main vocabulary refuse
instead of becoming main content. Existing opaque rich-run properties remain
supported. Unresolved prefixes in known markup-compatibility QName attributes
refuse explicitly; this is not automatic repair of malformed compatibility data.

The actual ZIP regression first failed on a valid aliased workbook before the
fix. Its workbook, sheet, styles and shared strings have the same complete model,
including rich strings, shared formulas and a fractional font size, as the default
namespace source. A real edit/save preserves every unrelated part byte-for-byte;
independent Python ZIP/ElementTree readback verifies value 19, bold 22.25-point
font and the expanded shared follower expression. Foreign cell/style lookalikes
and unresolved compatibility bindings refuse. Foreign attributes receive fresh namespace prefixes before literal `r` is reserved
for real relationship attributes. Both attribute-order cases preserve the foreign
expanded name/value and the exact owning ID; known compatibility QName values
are resolved against the original bindings and rebound explicitly in the private
view, including `mc:Ignorable="r"` when original `r` belongs to a foreign namespace.

The original menu fixture also had an independent ElementTree artifact:
`mc:Ignorable="x14ac"` referenced an undeclared prefix after namespace declarations
were renamed. The valid regression retains that declaration and does not mistake
this malformed QName binding for evidence against namespace alias support.

This source checkpoint has no new UI, runtime activation, renderer build,
publication or pin change. Other ExcelJS importer constraints (including relocated
package paths and namespace aliases in OPC relationship/content-type parts)
retain their existing qualification and refusals. This is not general OPC alias
support.

Validation: 92 focused cases across six reader/package/cell/rich/font/array files
passed, including all eight namespace cases. Full workspace typecheck and guard
passed. The original valid-alias RED and both original attribute-collision REDs
are retained in local logs; no test assertion or source qualification was loosened.
An earlier author typecheck caught a test union lacking an explicit numeric kind;
the typed fixture was corrected before the final successful run.
