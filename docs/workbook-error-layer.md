# Calculation error layer above the workbook canvas

Actual immutable128/71 qualification terminated only the owned calculation Worker
after a genuine Add in a new fake TEAM workbook. The next trusted edit reached
the terminal calculation deadline. The alert's semantic white background and
16px padding were present, but its absolute z-index was auto while the SDK canvas
was absolute z-index8. `elementsFromPoint(40,20)` put the canvas before the alert;
the personally viewed screenshot showed red error text over grid content.
This contradicts the earlier missing-CSS hypothesis: the utility was not absent.

The correction adds only the existing structural `z-20` utility to the Grid error
alert. Background, text, padding, error ownership and recovery behavior are
unchanged. The compiled128 stylesheet contains the exact `.z-20` selector with
`z-index:20!important`, above the measured canvas layer. No component imitation,
raw color, new stacking mechanism or mirror unit test is added.

Original evidence remains in `/tmp/workbook-crash128-ui/{qualification.json,
calculation-stopped.png,error-overlay-style.json}`. The raw screenshot includes
existing sidebar content and is intentionally not committed. Compiled-selector
proof is `/tmp/workbook-error-layer-css-proof.json` (CSS SHA256
`089c7e601dfebd4829779704cc82065edabd35936136c3e22f7d401e56e2abb6`).
The first scratch declaration check incorrectly expected literal20 without the
existing !important suffix; the corrected check verifies the same exact rule.

The source correction is not present in immutable128. A fresh actual calculation
fault and personally viewed result in the next packaged candidate remain required.
It does not fix the separate recovered rich-cell Save refusal, qualify renderer
unavailability or establish the full crash/recovery matrix. No runtime, source
XLSX, publication or installer pin changes during this source task.

Author checks passed full workspace `pnpm typecheck` (including web) and
`pnpm guard`. The one-class reversible correction adds no implementation-mirror
test. Compiled-layer verification is source evidence; it does not replace the
pending packaged fault visual check.
