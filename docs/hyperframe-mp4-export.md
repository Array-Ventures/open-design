# HyperFrame composition MP4 export

This source change connects declared HyperFrame HTML artifacts to the existing
contained composition renderer. It does not introduce a codec, renderer route,
permission layer or generation service.

The embedded shell classifies an ordinary HTML entry as `hyperframes` only when
the project declares that kind. It publishes HTML/PDF/PNG plus `hyperframes` as
export formats. An explicitly selected binary video remains a video, Markdown
remains a document, and ordinary HTML remains an app. Authored content stays in
its existing opaque child frame; it does not publish trusted host capabilities.

The paired native host recognizes the exact HyperFrame/HTML/format combination
and labels `hyperframes` output as MP4. Ordinary `mp4` remains local media
transcoding. The existing source-revision request, expected manifest SHA-256,
idempotent render operation, current project access checks and immutable source
freeze remain authoritative. Source classification is intent, never permission
or proof that a composition is renderable.

The renderer already validates composition geometry, duration/fps and local
resources; captures at most 3,600 frames; and produces `artifact.mp4` in the
existing network-disabled, read-only container. Its audio resolver/encoder and
output checksum/download checks are unchanged. Missing resources, invalid timing
or inaccessible source must still fail rather than produce a fabricated video.

Compatibility requires the paired host update. Old host enums reject the new
kind/format instead of interpreting composition HTML as a binary video. This
is not a claim that an old host clears every previous UI entry. A new host still
accepts an old companion's ordinary app entry with HTML/PDF/PNG, without guessing
a composition from scripts or adding MP4 to every HTML document.

Author evidence: the original classification/publication tests failed in both
places (two failures, 24 passing controls). The corrected focused lane passes
26 cases across two files; full workspace types, guard and frozen install exit
0. Logs: `/tmp/hyperframe-fork-{red,focused,types,guard,install}.log`.
These source tests alone qualify no package or runtime. The subsequent
[actual 136/79 composition-export check](hyperframe-mp4-136-qualification.md)
exercised the owned 12-second composition through the UI, with independent MP4
frame/pose/audio, checksum and source-asset checks. That combined pair included
separate unmerged document work; it was not a standalone build of this scoped
checkpoint. Historical 133/134 media playback records remain separate.
