# Image and merged Date source integration

Normal merge `d095f1374be456bd47e767658015604f36c20ec2` joins the image-only checkpoint `cad142a2`
with fork main `bb057884`, which contains reviewed Date PR47. The merge had no
conflicts. The lockfile automatically retains the pinned Sharp daemon importer,
Date web dependency and Date shared-policy workspace dependency. All ten image
production files remain byte-identical to the qualified image-only source;
all 92 incoming non-lock paths exactly match merged fork main.

Affected author checks pass: 188 daemon cases/11 files (image runner/input plus
Date converters/color/geometry), 58 contract cases/3 files, 99 shared-policy
cases/8 files and 15 host-capability cases/1 file. Frozen offline install,
dependency refresh, full workspace/scripts types and guard exit 0. This is a
scoped combined-source qualification, not the full web/daemon suites.

The [evidence](binary-image-date-integration-evidence.json) preserves source
identities, path equality and eight log hashes. Earlier Date acceptance and
image-only immutable build records retain their own exact source scopes. The
image-only companion `702041eb` and renderer `6ea8ae56` do not prove execution
of this newly combined source. No new pair was built here; a combined immutable
pair and fresh native image-export acceptance remain pending.

The original image-only worktree and built artifacts are preserved. No preview,
pins, activation, publication, model/provider calls or browser action occurred.
