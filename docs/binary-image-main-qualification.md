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
dependency, native library or provenance. Its planned gate covers seven raster
cases plus ordinary HTML capture, PDF readback and standalone HTML export.
The separate inspection script never starts its container: it extracts the
actual runtime and compares the full JavaScript/native/license inventory with
the official context, checks both declared native hashes and real ELF machines,
and normalizes Docker amd64 against Node/Sharp x64.

Official local companion/renderer/image builds and those immutable gates are
next. This source checkpoint does not claim they already passed. No existing
preview, Date package, source data, pin, publication, model or provider changed.
