export type DocumentColor = readonly [number, number, number, number];
export type DocumentColorReader = (value: string) => DocumentColor | null;
export const DOCUMENT_TEXT_INK = '--eve-document-text-ink';

/** Canvas resolves valid computed colors, including oklch/color(), into sRGB. */
export function documentColorReader(document: Document): DocumentColorReader {
  let context: CanvasRenderingContext2D | null;
  try { context = document.createElement('canvas').getContext('2d', { willReadFrequently: true }); }
  catch { return () => null; }
  const colors = new Map<string, DocumentColor | null>();
  return value => {
    if (colors.has(value)) return colors.get(value)!;
    try {
      if (!context || !document.defaultView?.CSS?.supports('color', value)) return null;
      context.clearRect(0, 0, 1, 1); context.fillStyle = value; context.fillRect(0, 0, 1, 1);
      const pixel = context.getImageData(0, 0, 1, 1).data;
      const color: DocumentColor = [pixel[0]!, pixel[1]!, pixel[2]!, pixel[3]! / 255];
      colors.set(value, color); return color;
    } catch { colors.set(value, null); return null; }
  };
}
function over(front: DocumentColor, back: DocumentColor): DocumentColor {
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
/** Adjust inherited ink only. Authored descendant foreground styles still win. */
export function documentTextInk(owner: HTMLElement, read: DocumentColorReader): string | null {
  const view = owner.ownerDocument.defaultView;
  if (!view) return null;
  const ink = read(view.getComputedStyle(owner).color);
  let background: DocumentColor = [0, 0, 0, 0];
  for (let current: HTMLElement | null = owner; current; current = current.parentElement) {
    const color = read(view.getComputedStyle(current).backgroundColor);
    if (!color) return null;
    background = over(background, color);
    if (background[3] >= 1) break;
  }
  // Do not guess an unknown canvas/background or replace adequate inherited ink.
  if (!ink || background[3] < 1 || documentContrast(over(ink, background), background) >= 4.5) return null;
  return documentContrast([0, 0, 0, 1], background) >= documentContrast([255, 255, 255, 1], background) ? 'black' : 'white';
}
