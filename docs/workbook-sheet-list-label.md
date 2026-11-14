# Localized worksheet navigation label

The pinned SDK's sheet-list icon had no accessible name. Its `SheetBarMenu`
producer now forwards the existing `sheets-ui.sheetConfig.sheetTabs` navigation
label through `SheetBarButton`'s supported `aria-label` prop. The public footer
configuration offers no label/component override. The same bounded producer
change is maintained in ESM, CommonJS and compatibility entries; dependency
versions, permissions, navigation and workbook write behavior are unchanged.

## Source checks

The unpatched producer genuinely failed the accessible-name assertion. Six real
standalone SDK DOM cases pass across the three entries in English and French,
including selecting each of the same two sheets and checking unchanged sheet
snapshots. These expose the private producer only in a test loader, with real
SDK dependencies and workbook; they are not packaged-browser keyboard proof.
Source checkpoint `0181c162` passed frozen installation, full workspace types
and guard. Normal main integration `5839de88` retained the identical label patch.
Combined source `4fde91b6` passed frozen installation, 79 affected SDK cases in
10 files, full workspace types and guard. The later normal main merge adds only
already-qualified documentation; it does not relabel the immutable build below.

## Actual local 121/64 check

| Artifact | Immutable identity |
| --- | --- |
| Clean source | `4fde91b66a2a9e003b4a0dea3ed3b7f2f69f619e` |
| Source tree SHA256 | `56ec2d414336f261bf1059db05c5fd3bbfad7dda399a0c4e83cc0da49a55d563` |
| Companion build | `f604c6120b477188158c0e079eed1c9d0f94fb755ee7a198760579ead540a201` |
| Renderer image | `sha256:1b5d06cb2bffb87673ada30f6beb015c485019b8531f27a908882ddc1f0987a0` |
| Worker SHA256 | `f62b1efd67f983002aa1e3b7223525f465a39e47c0d71483f47d048f0b552c00` |
| Document helper SHA256 | `6e0e3ca112229662f0e56cb61699e43e5ae2519b0fa09195fe95560e61ed5bb4` |

Both builders exited0. Strict verification checked the full inventory, clean
source pairing, actual image runtime bytes/provenance and platform/user/entrypoint.
Worker and document helper bytes match120; the companion contains the label fix.

In the owned6261 preview, real English UI checks at1280×633 in Dark and Light
found the named **Sheet tabs** button. Pointer opening and switching both ways
showed **Rich cells** values111/112 and **Retained sheet** value222. After pointer
opening, ArrowDown twice focused Retained sheet and Enter selected it. Six captures
were personally viewed by the manual tester. No cell/source edits or membership
operations were performed. Actual raw readback retained all7143 source bytes,
SHA256 `0e4ef97590ec4caf27d2d62fd4f4f930b632e0ac0807e06aebcbaf8b4925e2f5`.
Dark and the first sheet were restored; the named browser closed normally.

**Keyboard-only entry remains unqualified.** CLI focus followed by Enter did not
open the menu; actual focus returned to the SDK's hidden editor. This observation
has no established cause and is not promoted to a keyboard-accessibility pass.
French is covered by the source producer cases only. An existing image-rich
document also opened as a rich editor, without edit/export; that is a smoke check,
not a combined document/workbook regression matrix or worksheet-goal completion.

The first scalar fixture failed reader admission. Its ElementTree serialization
changed namespace prefixes while leaving an MC `Ignorable` QName-valued token
with an unresolved binding. CRC and expanded XML tree equality did not establish
valid MC semantics; that failure does not prove a valid-prefix compatibility gap
or a121 product regression. The original7157-byte fixture/hash was retained, and
only that owned file was replaced with the conventionally serialized7143-byte
fixture after unchanged-reader admission and exact API readback. Namespace
compatibility investigation is separate; no reader policy changed here.

Local receipts: `/tmp/workbook-menu121-pair-receipt.json`,
`/tmp/workbook-menu121-browser/qualification.json` and
`/tmp/workbook-menu121-browser/final-source-readback.json`. No publication,
installer pins, production or shared-preview settings changed for this check.
