/** Exactly the inline font-size syntax already admitted by the editor. */
export const documentFontSizePattern = /^(?:\d+(?:\.\d+)?)(?:px|pt|em|rem|%)$/;
export const DOCUMENT_FONT_MAX_PT = 1638.5;
export const DOCUMENT_FONT_LINE_MAX_PT = 3277;
export interface DocumentPresentationRequest { id: string; kind: 'cell' | 'inline' | 'divider' | 'heading' }
export interface NormalizedDocumentPresentation {
  foreground?: string;
  background?: string;
  foregroundSource?: 'authored' | 'inherited';
  fontSizePt?: number;
  fontLineHeightPt?: number;
  fontSizeSource?: 'authored';
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
  headingBeforePt?: 0;
  headingSource?: 'canonical-first-block';
}
export function validDocumentFontSize(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= DOCUMENT_FONT_MAX_PT;
}
export function validDocumentFontLineHeight(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= DOCUMENT_FONT_LINE_MAX_PT;
}
/** CSSOM serializes some exact point declarations as rounded pixel decimals
 * (16pt → 21.3333px). Retain exact native half-points within that measured
 * 0.0001pt noise floor; this is not general half-point quantization. */
export function normalizeDocumentFontPoints(points: number): number {
  const halfPoint = Math.round(points * 2) / 2;
  return halfPoint > 0 && Math.abs(points - halfPoint) <= .0001 ? halfPoint : points;
}
/** Shortest round-trip numeric spelling, expanded because OOXML unit values
 * accept decimal notation, not JavaScript scientific notation. Finite font
 * bounds keep this expansion small (including Number.MIN_VALUE). */
function decimalFontPoints(points: number): string {
  const text = String(points);
  if (!/[eE]/.test(text)) return text;
  const [coefficient, exponentText] = text.split(/[eE]/);
  const [whole, fraction = ''] = coefficient!.split('.');
  const digits = whole! + fraction, position = whole!.length + Number(exponentText);
  if (position <= 0) return `0.${'0'.repeat(-position)}${digits}`;
  if (position >= digits.length) return digits + '0'.repeat(position - digits.length);
  return `${digits.slice(0,position)}.${digits.slice(position)}`;
}
/** Modern OOXML permits explicit point units when integer half-points cannot
 * retain the source measure. Consumer rendering precision is separate. */
export function documentWordFontSize(points: number): string {
  if (!validDocumentFontSize(points)) throw new Error('The authored font size is not representable.');
  points = normalizeDocumentFontPoints(points);
  const halfPoints = points * 2;
  return Number.isInteger(halfPoints) ? String(halfPoints) : `${decimalFontPoints(points)}pt`;
}

export function validDocumentHeadingLevel(value: unknown): value is 1 | 2 | 3 | 4 | 5 | 6 {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 6;
}
