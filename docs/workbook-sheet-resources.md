# Historical worksheet resource compatibility

The standalone `assertWorkbookSheetResourceContinuity` helper qualifies selected
historical worksheet templates against actual current ZIP owners. It does not
infer ancestry, remap global resources, enable a source capability or accept a
new restoration wire field. It is a prerequisite for the later template owner.

Both packages must satisfy the bounded scalar sheet-source admission. Date
systems match. Shared strings and the relationship-selected theme retain exact
bytes/ownership. Style collection counts and retained component XML identities
are checked at their original indices, with namespace-aware signatures shared
with the existing style interner. Critical implicit-index owners must exist;
ambiguous/missing owners are refused. Appended style components are allowed only
when all old components remain in place. Custom number-format IDs, style names
and builtin-style IDs must be unambiguous throughout the **current** collection,
not just its historical prefix. Appending a duplicate format ID could otherwise
shadow an unchanged historical XF. Custom definitions overriding builtin number
format IDs are outside this bounded qualification.

The helper rechecks raw worksheet cell/row/column style and shared-string
indices, plus global XF dependencies. It does not substitute compacted reader
model style indices for source XML indices: removing a worksheet can compact the
model's used-style array even though the actual global style pool remains intact.
Unknown non-indexed global owner content must remain identical. External file
replacement or whole-file restore must still withdraw the old kernel's source
identity; compatible resources alone are not proof of that lifecycle continuity.

Actual source ZIP tests exercise the current qualified scalar/rich-cell,
calculation, style, dimension, visibility, row/column structure and sheet writers.
They demonstrate preserved shared strings/theme and retained style prefixes even
when unrelated later formatting appends components. Negative fixtures cover
actual font/string/theme/date replacement, forged used indices, and appended
format/name/builtin identities that shadow old owners. The helper refuses those
cases rather than interpreting old cells using changed current resources.

Template extraction, per-deletion source descriptors, authenticated historical
assets, writer ACK integration and positive protected recovery remain subsequent
work. These source tests do not establish post-ACK undo or UI support.
