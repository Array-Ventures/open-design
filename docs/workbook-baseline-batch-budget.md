# Selected baseline allocation bound

The synchronous baseline batch now counts the actual UTF-8 JSON bytes of each
raw selected candidate before cloning or Zod parsing it. Array brackets and
commas are included. The aggregate selected batch alone cannot exceed the same
existing128MiB recovery byte cap. That constant now lives in a pure module;
`draft-store` reexports it, preserving existing imports and behavior.

This guards transient allocation when many small retained removal records refer
to one large frozen target sheet. It is not a quota reservation or proof that a
full checkpoint fits: the existing prospective checkpoint encoder still owns
exact total admission before SDK execution. Schema/source checks remain intact;
an over-cap failure returns no partial results and changes no source/ACK data.
No protected root is pruned to make conversion fit.

An actual-cap RED previously returned129 selections with1MiB preserved metadata
each. Final ASCII and Unicode overflow cases refuse; the Unicode case stays
below the cap in UTF-16 character count but exceeds it in UTF-8 bytes. Existing
below-cap independent-copy, single-capture equivalence and complete source guard
cases remain green. 41 affected cases across five files, full repository
typecheck and guard passed. No model calls, runtime, image or publication changed.
