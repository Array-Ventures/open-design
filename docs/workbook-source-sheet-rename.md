# Standalone source worksheet rename plans

Plan derivation now consults the existing source-sheet projection even when there
are no deletion contexts. A rename alone therefore retains its source IDs and
emits the ordinary `sheets` projection plus actual SDK formula/scalar deltas.
Unchanged membership/names return to the original scalar/axis path without a
spurious sheet plan. No new authority, journal, mutation admission or UI is added.

Existing projection and cell guards remain authoritative: invalid/colliding
names, reordered or new IDs, changed style/axis ownership and unqualified sources
refuse. Defined names and tables remain unsupported. The pinned SDK rename
command itself can accept invalid names, so validation is not delegated to it.

The genuine pre-change test failed for standalone rename and repeated rename/Undo
with later edits because the old route fell through to the non-membership writer.
The app-owned actual SDK suite now passes with dependent formula rewrites,
repeated rename/Undo, unrelated edits, no-op and negative ownership checks. With
the existing deletion-context suite, 25 cases pass. Full workspace types, separate
web types and repository guard pass.

A bounded scratch integration also ran an actual SDK rename through the derived
plan and existing render worker function. Independent ExcelJS readback verified
the quoted new name, formula result 13, Arial/bold/11 styling; styles, shared
strings and core metadata ZIP members stayed byte-identical. Its qualified log
is `/tmp/source-sheet-rename-worker-corrected.log`; the final combined scratch run
is `/tmp/source-sheet-rename-final-tests.log`. The scratch cross-app harness is
not shipped: repository boundaries prohibit cross-app private imports. Existing
24 server sheet-patch cases passed separately. This is source-worker evidence,
not a new immutable renderer or live controller qualification.

Controls stay off. Real mutation admission, protected birth/restoration ownership,
ACK/Undo continuity and paired runtime qualification remain separate work.
