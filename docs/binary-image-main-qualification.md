# Image-only source on fork main

Source `fea282b5` is based directly on fork main `bd23b85d`. Only the four image
commits were cherry-picked; no context conflict occurred. The older worktree
and Date branch remain separate. There are no Date implementation paths in this
PR. Earlier image records retain their original source/overlay scope.

All production image files are byte-identical to reviewed image head `364121f4`.
The lockfile differs only by removing Date's unrelated three-line web importer;
the explicit pinned Sharp dependency is unchanged. The
[source proof and nine logs](binary-image-main-source-evidence.json) record every
changed path and hash. Two test-only harness changes enable immutable-image
testing and inspection; neither changes production conversion or packaging.

New-baseline author checks pass: 68 daemon cases/3 files, 33 contract cases/2
files, 15 host-capability cases/1 file, the copied native-runtime script, eight
actual Dockerfile architecture-guard controls, full workspace types and guard.
This is a scoped qualification, not full daemon/web suites.

The new immutable mode uses the image's normal entrypoint with only owned
source/job/output mounts. It never overlays a worker, browser helper, JavaScript
dependency, native library or provenance. Its gate covers seven raster
cases plus ordinary HTML capture, PDF readback and standalone HTML export.
The separate inspection script never starts its container: it extracts the
actual runtime and compares the full JavaScript/native/license inventory with
the official context, checks both declared native hashes and real ELF machines,
and normalizes Docker amd64 against Node/Sharp x64.

The source checkpoint above preceded these completed official local builds on
clean `35b46ad0c416a1e70578dc830abbdb906d79602d`. The companion contains 34,596
verified files, build `702041ebe6097ade217fbcb663dbe1d86396d352a07dfc41229b9de211b7bad9`.
The independently built renderer has the same clean source/tree identity. Its
local ARM64 image is
`sha256:6ea8ae567e7810bed59bd40195be2f6128efb106a69b887456904c3a730e3c9c`.
Native read-only package and exact-image preflights pass. These are new image-only
artifacts; they contain no unmerged Date implementation.

All ten immutable worker cases pass using the normal image entrypoint and only
source/job/output mounts: intrinsic PNG, oriented JPEG, ICC WebP, white-flattened
JPEG, three hostile/unsupported refusals, ordinary HTML capture, actual PDF
readback and standalone HTML export. The raster conversion path is not a browser
screenshot. Independent Pillow readback confirms literal PNG RGBA pixels,
EXIF-6 orientation with zero decoded RGB difference, the same 480-byte ICC
profile and all-white flattened JPEG pixels.

Inspection of the actual image matches all 586 runtime files against the
production context, including JavaScript dependencies, licenses, provenance,
`raster-platform` and both native libraries. Both native files have actual ARM64
ELF headers and match the declared SHA-256 values. A separate no-mount,
network-disabled diagnostic loads Sharp 0.35.3 and libvips 8.18.3 from those exact
image paths and completes a tiny PNG conversion. The diagnostic overrides the
entrypoint only to observe loaded libraries; the ten worker cases above do not.
This is ARM64 execution proof, not x86 codec qualification.

The [build evidence](binary-image-main-build-evidence.json) records exact native
hashes, full inventory and case receipts, source equality, output hashes,
independent readback and retained logs. An initial strict-package report formatter
failed after inspection because it used a nonexistent `identity` property; a
corrected full strict invocation passes. An initial supplemental loaded-library
probe failed to parse its generated JavaScript; its corrected invocation passes.
Both failures remain referenced and are not counted as successful runs.

Owned labeled containers and build/test processes are absent. No Postgres or
stack was started for this fork qualification. Build contexts, image, output and
inspection scratch are retained for review. No existing preview, Date package,
source data, pin, publication, model or provider changed. Fresh native
PNG/JPEG browser integration remains a separate gate, including the native
old-image compatibility correction; this record does not qualify that UI/API.
