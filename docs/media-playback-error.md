# Native audio/video failure presentation

## Actual 133 observation

The local 133/76 media audit used five new owned TEAM fixtures and existing local
PNG, MP3, H264 MP4 and VP9 WebM assets, plus a small local GSAP/audio composition.
No generation, conversion job or source overlay was used. At 1440×1000 and
390×844, the image, WebM, MP3 and composition were personally inspected in both
themes. Playback, pause, keyboard seek/replay and applicable mute/volume controls
were exercised through the real UI. All seven uploaded files remained exact;
four original UI downloads matched their inputs byte for byte.

The first isolated browser reported no H264 support. The MP4's native element
reported `DEMUXER_ERROR_NO_SUPPORTED_STREAMS`, but the viewer remained at 0:00
without an accessible failure explanation. In a separately authorized isolated
browser with H264 support, the exact same fixture actually played at 6.6 seconds
and 1920×1080; play/pause, keyboard seek/replay, both-theme/width inspection and a
byte-exact original download passed. This is a browser-specific decoder failure,
not a universal app MP4 regression. It nevertheless exposes the missing app
failure state for genuine native media errors.

The actual audit and exact-session cleanup are retained in
`/tmp/media133-ui/qualification.json` and `exact-session-audit.json`. Both named
browsers closed normally; five captured sessions were absent in the owned
preview database. No global cleanup is inferred. The composition's cross-origin
sandbox correctly refused direct DOM access; only its public playback state and
trusted controls were used. Audible speaker quality and the full media matrix
remain unqualified. A development-tool overlay covered the composition's mute
pointer target; keyboard activation worked, without establishing a production
overlap bug. Composition export/volume capabilities remain separate gaps.

## Narrow correction

`MediaPlayback` owns only the native audio/video element and its failure state.
`FileViewer` retains project context, URL construction and its existing original
file Download/Open actions. A genuine native `MediaError` replaces the unusable
controls with a compact `role=alert` and those same actions. Arbitrary event text
or an event without `MediaError` cannot produce diagnostics or change action
URLs. The existing generic localized unavailable message is reused in all 19
locales; an error code alone does not establish a specific network or codec cause.

The inner owner is keyed by media kind and revision URL. A changed source starts
with a fresh native element and error state; late events on an old element cannot
mark the replacement failed. Cleanup pauses its captured old element. Healthy
native controls, metadata preload and video inline playback remain native;
there is no codec installation, transcoder, inferred permission or new download
route.

The actual `FileViewer` DOM-error regression failed for both audio and video
before the correction (`/tmp/media-playback-failure-red.log`). Additional source
checks cover revision recovery, detached old errors, diagnostic URL refusal,
missing-error events, StrictMode cleanup and localized/RTL output. The test
adapter mocks only the unimplemented JSDOM pause method; actual playback proof
belongs to the separate 133 audit. New packaged error-state/browser acceptance
remains pending; no runtime or installer descriptor was changed by this fix.

Author checks: 29 focused cases across the media-error and existing Share-icon
suites passed, full workspace `pnpm typecheck` and `pnpm guard` exited 0, and the
frozen install passed. Logs: `/tmp/media-playback-failure-final-focused.log`,
`/tmp/media-playback-failure-types.log` and
`/tmp/media-playback-failure-guard.log`. The first typecheck rejected six new
fixtures missing the existing required `projectKind`; explicit media kinds were
added without changing assertions or product admission, and that failed log was
retained separately. No new app package or renderer image was built.
