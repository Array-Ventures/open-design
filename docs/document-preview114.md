# Document preview 114 qualification

Owned Evebot preview on port 6261 runs native `a8f18276cd614a108d3a492fd660e4d21d59824c` with the companion and renderer built from clean fork source `04ca86ab21842c26546d5e9c109aed8225feb9fd`. Later documentation commits do not change that runtime identity.

The companion build is `f501e32e167171ac451a0a4a329bbf84cb6a4c8c8f365ceab20f3ede1270ddfc`; renderer image is `sha256:16d8529cfefb2169bd07f509216a2a535a09749f33c291db4f8d525dd6e5ac47`. Strict verification checked the complete companion inventory, matching clean source provenance, actual contained worker/helper bytes, architecture, entrypoint and user. Both worker and helper changed from preview 113. Normal shutdown/startup preserved all configuration except the three candidate build settings; fixture login succeeded. Production, shared dev, published packages and installer pins were untouched.

## Manual comment checks

An owned made-up document was selected with real mouse gestures. Opening its comment composer through the host header and selection toolbar worked for both heading and paragraph selections. The empty composer remained 320×86 CSS pixels across the following four observations; its controls and border fit within the artifact at both widths. Host and child theme were measured, rather than inferred from emulated preferences.

| Theme | Viewport | Card border | Card background | Screenshot |
| --- | --- | --- | --- | --- |
| Light | 1440×1000 | `rgb(235,235,235)` | White | [Desktop](images/document-preview114/light-wide.png) |
| Light | 390×844 | `rgb(235,235,235)` | White | [Phone](images/document-preview114/light-phone.png) |
| Dark | 1440×1000 | `lab(27.036 0 0)` | `lab(15.204 0 -0.00000596046)` | [Desktop](images/document-preview114/dark-wide.png) |
| Dark | 390×844 | `lab(27.036 0 0)` | `lab(15.204 0 -0.00000596046)` | [Phone](images/document-preview114/dark-phone.png) |

All four screenshots were personally inspected. The document stayed 269 bytes with SHA-256 `d20d4ee45d3dc8e62dc1c1cc81335364f2f68a04d815619fd381256a96ef4496`. No comment or chat message was saved or sent. The composer was closed, Light restored, and the named browser closed normally. An initial keyboard/open-list selection attempt showed the empty list; subsequent real heading/paragraph mouse selections worked. That initial observation is not treated as a diagnosed product defect or as proof of keyboard/open-list coverage.

The authorized reference document's Comments region was inspected again and closed without editing, sending or exporting. Its capture remains private scratch evidence, not a repository asset. These checks qualify the compact composer's border and bounded layout, not every comment workflow.

## Actual packaged exports

Word and PDF were requested through the actual Export dialog and downloaded through its links. Both POST responses were the contract's HTTP 202; downloaded digests and lengths matched the corresponding ready jobs.

The positive geometry fixture was generated with the existing `documentHtml` function, including its canonical stylesheet, first H1, authored 40px inline text and later H2. Its 1476 original bytes retained SHA-256 `0875f76a0efd4f189aa4c969142c0f24506f60abf700d9a1367e1237e9ee4225` after both exports. Native Word inspection confirmed:

- Only the owned first heading received local before-spacing zero.
- Authored 40px text became native size 60 half-points.
- Letter page size and 1080-twip margins were present.
- Private presentation owner markers did not leak into the exported document.

The DOCX was 11049 bytes, SHA-256 `5e48af1da29c3f5eaa2dcb8f538bdf5d96828bff1b0d6c0708b3074e7a915d2b`. The PDF was 18839 bytes, SHA-256 `78aa700f0dfcaa8c57a2f5e0a9987afdc802ed98e1d135205136f8edf7535bac`; its raster was personally viewed. This is packaged UI/export evidence, distinct from the earlier source-worker overlays. Microsoft Word itself was not tested.

An earlier plain HTML fixture lacked the canonical stylesheet, so an assertion expecting its first heading to have canonical zero margin was invalid. Its original output and the failed assertion were retained separately; the positive fixture above uses the real canonical producer. This does not establish arbitrary HTML layout parity.

## Checks and remaining work

The integrated source passed 33 shared document-style tests, 78 focused daemon tests across six files, full workspace types and guard. Independent source review found no blocker; the reviewer did not rerun tests. Receipts remain in `/tmp/document-presentation114-pair-receipt.json`, `/tmp/document-presentation114-activation-proof.json`, `/tmp/document114-comment-*.json`, `/tmp/document114-canonical-native-proof.json` and `/tmp/document114-export-download-proof.json`.

The goal remains open. Image-only native positioning retains a failed source-worker visual oracle and remains unqualified in this immutable pair; its correction is separate work. Mixed-document inspection also showed a divider vertical-placement difference, and table borders/padding/header emphasis, link decoration, list placement, code typography, font-engine differences and page furniture remain explicit fidelity gaps. Worksheet membership/history/recovery, current-slide PNG's new paired acceptance and the complete cross-type/access/recovery matrix are not qualified by this document slice. See [first-heading evidence](document-first-heading.md) and [print geometry](document-export-geometry.md).
