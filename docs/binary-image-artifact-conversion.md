# Bounded binary image conversion

Source `760a7e2d`, based on the separate Date/workbook checkpoint `8a9be42c`,
adds a real raster path before the renderer's HTML/UTF-8 path. It does not
activate a preview, rebuild a distribution or complete image acceptance.
The [hashed evidence](binary-image-artifact-evidence.json) retains author logs,
real output files, the old-worker failure and the exact overlaid worker.

## Contract and fidelity

The trusted companion advertises `formats: ['image']` for image entries ending
in PNG, JPG/JPEG or WebP. The existing request uses `format: 'image'` with
`imageFormat: 'png' | 'jpeg'`; PNG is the default. Intrinsic dimensions are
preserved, including the dimension swap required by EXIF orientation. Resize,
deck, selected-slide, template-data, restore and other capture options refuse.
SVG, GIF and AVIF retain original-file download only in this slice. Inputs may
still be refused after advertisement when their actual bytes exceed the bounds.

The pinned Sharp 0.35.3 decoder handles only complete static 8-bit RGB/greyscale
PNG/JPEG/WebP containers. Admission checks signatures and container boundaries
before decoding, rejects APNG control chunks and animated WebP, and compares
actual decoded metadata with the extension. Limits are 50 MiB input, 8192 pixels
per side, 16 megapixels, four input channels, 15 seconds of pixel processing and
65 MiB output. The existing network-disabled, read-only, memory-bounded worker
remains the execution boundary; a decoder timeout does not replace the native
job's outer deadline or cancellation lifecycle.

PNG retains transparency. JPEG explicitly flattens transparency against white
and encodes at quality 95 with 4:4:4 chroma; it is lossy. EXIF orientation is
applied to pixels, then camera/EXIF/XMP metadata is removed. ICC profiles are
retained. Non-sRGB PNG gamma/chromaticity without an ICC profile, HDR colour
metadata, CMYK, 16-bit pixels and animation refuse rather than silently losing
their interpretation. Original source bytes remain untouched; converted output
is not an original-byte copy or a physical-DPI/metadata-preserving archival
format. Original download remains a separate action.

The implementation uses the pinned library's
[input limits and orientation](https://sharp.pixelplumbing.com/api-constructor/)
and [ICC output policy](https://sharp.pixelplumbing.com/api-output/). Tests retain
a real Display-P3 profile byte-for-byte and compare decoded sRGB samples; this
is bounded colour evidence, not every profile/gamut combination.

## Native payload packaging

The renderer builder explicitly copies the pinned Sharp JavaScript dependency
closure, Linux/glibc addon and libvips. It retains package notices, component
licence/source links and exact versions. Its provenance adds `raster.sharp`,
`platform`, `addonSha256` and `libvipsSha256`. Docker refuses a target architecture
different from the copied `raster-platform`. Cross-build environments must first
install the exact optional Linux target packages; a missing target fails closed.
Actual native execution here is qualified on Linux arm64 only.

Final native image verification must extract and hash the addon and libvips,
alongside the existing worker/browser payload checks. A worker JavaScript hash
alone does not identify those native bytes.

## Author qualification and retained failures

- 68 daemon cases across three files pass: 37 new raster cases plus 31 unchanged
  media/input regressions. The real decoder/encoder runs; only the forbidden
  HTML browser path is replaced with a throwing test control.
- 33 shared-contract cases across two files and 15 controlled host-capability
  cases pass. Workspace types and guard pass. A standalone packaging test loads
  the independently copied native closure, checks its hashes and rejects an
  unsupported architecture.
- The existing immutable package140 renderer produces a 1440×900 screenshot
  from a real 2×2 PNG, failing the intrinsic-size assertion. The same image with
  a read-only current worker/native-dependency overlay passes seven actual
  container cases: intrinsic RGBA pixels, rotated JPEG, profiled WebP, white
  JPEG, and fake-PNG/SVG/animated-WebP refusals. All containers use network none,
  read-only source/runtime mounts, bounded memory/PIDs and no credentials.
  All test containers were removed; retained files are owned scratch evidence.
- Initial EXIF fixtures did not set an orientation, and identical animation
  frames collapsed to one. Corrected fixtures assert the actual tag/two-frame
  preconditions. An initial packaging test was in the daemon's wrong TypeScript
  root; it moved intact to the owning scripts layer. An attempted dependency add
  refreshed unrelated lock entries, and a manual correction briefly duplicated
  an existing snapshot; final lock changes are only the three-line daemon import
  of the already-pinned version. Failed logs are retained.

No full daemon/web suite, new immutable image/companion build, browser/native
modal acceptance, access withdrawal, job cancellation or crash lane was run.
Those final paired checks remain necessary, including independent output/visual
inspection, current authority and original-byte preservation. The native export
counterpart must admit this capability and expose PNG/JPEG choices before a
user-facing flow is claimed. No installer pin, Date/workbook source, running
preview, persistent data, model, provider, release or hosted Actions was changed
by this lane.

## Docker architecture attestation correction

Independent review found that source `760a7e2d` copied Node/Sharp's `linux-x64`
attestation but compared it directly with Docker's `linux-amd64`, rejecting a
legitimate x86 build. ARM-only native execution had not exercised that mapping.

Corrective source `64cb0135` executes the actual Dockerfile guard in eight bounded
shell cases. The unchanged guard genuinely failed x64/amd64 before the fix.
Docker `amd64` now maps explicitly to Sharp/Node `x64`, and `arm64` stays `arm64`.
Mismatched attestations, a wrongly named `linux-amd64` Sharp attestation and
unsupported Docker architectures all refuse. No mismatch guard was weakened.

All eight controls, the actual copied ARM native-runtime check, scripts types
and guard pass; the [five log receipts](binary-image-architecture-evidence.json)
retain the RED and GREEN. This tests the architecture contract without emulating
an x86 codec. No x86 image/native execution, new immutable build, source merge,
preview change, pin or publication is claimed. Raster provenance continues to
use Node/Sharp architecture names; final image verification must compare them
with Docker's canonical platform through the same explicit mapping.
