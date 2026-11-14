import { documentWordFontSize } from '@open-design/document-style';
/** Physical print geometry already used by the canonical browser PDF. CSS uses
 * 96px/in; Word measures page/paragraph geometry in 20ths of a point. */
export const documentExportProfile = {
  page: { widthPt: 612, heightPt: 792, marginPt: 54 },
  body: { sizePx: 20, linePx: 30, afterPx: 20 },
  // The first three rules are explicit print overrides. The remaining values
  // retain the canonical h4–h6 browser defaults at its 20px print body size.
  headings: [
    { sizePx: 40, linePx: 50, beforePx: 24, afterPx: 16 },
    { sizePx: 30, linePx: 39, beforePx: 24, afterPx: 12 },
    { sizePx: 25, linePx: 35, beforePx: 24, afterPx: 12 },
    { sizePx: 20, linePx: 25, beforePx: 28, afterPx: 12 },
    { sizePx: 16.6, linePx: 20.75, beforePx: 23.24, afterPx: 9.96 },
    { sizePx: 13.4, linePx: 16.75, beforePx: 18.76, afterPx: 8.04 },
  ],
  rule: { borderPx: 1, marginPx: 24 },
  // The contained renderer installs DejaVu and Noto; these are the actual
  // default faces selected for the canonical generic sans/serif categories.
  fonts: { sans: 'DejaVu Sans', serif: 'DejaVu Serif' },
} as const;
export const cssPxToPoints = (value: number): number => value * .75;
/** Native twip geometry is rounded to its nearest 1/20pt, not CSS pixels. */
export const cssPxToTwips = (value: number): number => Math.round(value * 15);
/** Office 2010+ supports explicit point measures for fractional half-points. */
export function wordFontSize(valuePx: number): string {
  return documentWordFontSize(cssPxToPoints(valuePx));
}

export const documentExportPrintCss = `@media print{body{padding:0!important;font-size:${documentExportProfile.body.sizePx}px!important;line-height:${documentExportProfile.body.linePx / documentExportProfile.body.sizePx}!important}${documentExportProfile.headings.slice(0,3).map((heading, index) => `h${index+1}{font-size:${heading.sizePx}px!important;line-height:${heading.linePx / heading.sizePx}!important}`).join('')}h1,h2,h3,h4,h5,h6{font-weight:500!important}ul.task-list{list-style:none;padding-inline-start:0}ul.task-list input{margin-inline-end:8px}}`;
