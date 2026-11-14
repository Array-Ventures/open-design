export type DocumentColor = readonly [number, number, number, number];
export function compositeDocumentColor(front: DocumentColor, back: DocumentColor): DocumentColor {
  const alpha = front[3] + back[3] * (1 - front[3]);
  if (!alpha) return [0, 0, 0, 0];
  const channel = (index: 0 | 1 | 2) => (front[index] * front[3] + back[index] * back[3] * (1 - front[3])) / alpha;
  return [channel(0), channel(1), channel(2), alpha];
}
function luminance(color: DocumentColor): number {
  const linear = color.slice(0, 3).map(value => { const channel = value / 255; return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4; });
  return .2126 * linear[0]! + .7152 * linear[1]! + .0722 * linear[2]!;
}
export function documentContrast(first: DocumentColor, second: DocumentColor): number {
  const a = luminance(first), b = luminance(second); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}
export function opaqueDocumentColorHex(color: DocumentColor): string {
  if (color[3] !== 1 || color.some(value => !Number.isFinite(value)) || color.slice(0, 3).some(value => value < 0 || value > 255)) throw new Error('The document color is not an opaque sRGB color.');
  return color.slice(0, 3).map(value => Math.round(value).toString(16).padStart(2, '0')).join('').toUpperCase();
}
export interface DocumentColorRequest { id: string; kind: 'cell' | 'inline' | 'divider' }
export interface NormalizedDocumentColors { foreground?: string; background?: string; foregroundSource?: 'authored' | 'inherited' }
