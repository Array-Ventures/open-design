# Media artifact downloads and exports

The native Export modal offers **Original image**, **Original audio** or
**Original video** for recognized ordinary project files. This downloads the
current saved file byte-for-byte. It is not an immutable prepared job and does
not enter render history. There are no authored source URLs in this action.

`StudioOriginalMediaFile` validates the project UUID and ordinary relative media
path; the shared URL builder encodes each segment. The authenticated GET/HEAD
route forwards only that project's raw file through the existing gateway and
sets an attachment disposition. Project access is checked before reading and
again while streaming. Hidden/internal paths, traversal, arbitrary URL/query
inputs and malformed scopes fail before daemon reads. Unicode filenames use
RFC 5987 attachment names. Native modality/layout, workspace access and the
underlying current-file semantics are unchanged.

## Prepared media exports

The trusted companion advertises MP4/WebM for `.mp4`, `.mov`, `.webm`, `.mkv`,
and MP3/WAV for `.mp3`, `.wav`, `.m4a`, `.ogg`, `.flac`, `.aac`. The native parser
admits only the corresponding kind/extension/format combinations. Within the
companion, one pure media-input map owns viewer classification, advertised
formats and the worker's explicit demuxer selection. Extra audio formats and
MKV receive their proper media kind and raw MIME rather than a text viewer.

These choices use the existing immutable snapshot/render/receipt pipeline.
Admission retains the 250 MiB total project snapshot and 10,000-file bounds.
The media worker additionally requires a known positive duration at most
120 seconds, the required audio/video stream, video at most 3840×2160 and
60 fps, a 250 MiB input/output ceiling and bounded probe/encoder timeouts.
Unknown or over-budget inputs fail instead of producing partial exports.
Video-to-audio extraction remains available through existing tools but is not
added to this modal in this slice.

Binary images have original-file download only. The generic PNG/JPEG renderer
still treats its entry as HTML/UTF-8; it is not advertised as a binary image
converter. Existing HTML screenshot PNG and document/workbook/CSV exports,
selected worksheet identity, native frame fencing and narrow-dialog tooltip
behavior are retained.

## Qualification and limits

Native tests cover strict capabilities, original URL construction, actual route
and gateway forwarding of exact binary bytes, identity/access denial, Unicode
attachment names, hidden/path/query refusal, HEAD, and mid-stream revocation.
Companion tests exercise trusted host capabilities and actual media dispatch
before any HTML decoding, demuxer/protocol/encoder flags, source containment and
metadata/byte-budget refusals. Their encoder/probe calls are bounded fixtures,
not evidence of real codec output. This host lacks `/usr/bin/ffmpeg`.

No packages/images, services, browser sessions or model calls were started.
Only owned source/dependency compilation supports focused tests/types.
Real encoded MP4/WebM/MP3/WAV output and original browser downloads still need
packaged manual qualification in light/dark, narrow/wide and chat layouts.

The preexisting availability fixture expected only XLSX even though the current
host already advertises XLSX plus selected-sheet CSV. Its assertion now checks
both actual existing formats; the production workbook capabilities did not
change in this slice.
