import type { ManualEditInsertion, ManualEditInsertionPatch } from './insertion';

type Point = { x: number; y: number };
export interface InsertionSurface {
  /** Viewport bounds of an axis-aligned containing block's border box. */
  rect: { left: number; top: number; width: number; height: number };
  offsetWidth: number; offsetHeight: number;
  clientWidth: number; clientHeight: number;
  clientLeft: number; clientTop: number;
  scrollLeft: number; scrollTop: number;
}
export type InsertionPlacement = NonNullable<ManualEditInsertionPatch['placement']>;

/** Convert viewport pointers into the existing containing block's CSS pixels.
 * The caller must choose an authored positioned container; this never changes
 * its layout. Rotated/skewed containers must be excluded by the bridge. */
export function insertionPlacement(
  surface: InsertionSurface,
  start: Point,
  end: Point | null,
  element: ManualEditInsertion,
  anchor: 'start' | 'center' = 'start',
): InsertionPlacement | null {
  const { rect } = surface;
  if (![...Object.values(rect), ...Object.values(start), ...(end ? Object.values(end) : []),
    surface.offsetWidth, surface.offsetHeight, surface.clientWidth, surface.clientHeight,
    surface.clientLeft, surface.clientTop, surface.scrollLeft, surface.scrollTop].every(Number.isFinite)) return null;
  if (rect.width <= 0 || rect.height <= 0 || surface.offsetWidth <= 0 || surface.offsetHeight <= 0
    || surface.clientWidth < 1 || surface.clientHeight < 1 || surface.clientLeft < 0 || surface.clientTop < 0
    || surface.scrollLeft < 0 || surface.scrollTop < 0) return null;
  const scaleX = rect.width / surface.offsetWidth, scaleY = rect.height / surface.offsetHeight;
  const point = (value: Point): Point => ({
    x: (value.x - rect.left) / scaleX - surface.clientLeft,
    y: (value.y - rect.top) / scaleY - surface.clientTop,
  });
  const origin = point(start);
  if (origin.x < 0 || origin.y < 0 || origin.x > surface.clientWidth || origin.y > surface.clientHeight) return null;
  const clamp = (value: number, max: number) => Math.max(0, Math.min(max, value));
  const target = end ? point(end) : null;
  // A tiny pointer movement is a click; use a visible type-appropriate size.
  const dragged = target !== null && Math.hypot((end!.x - start.x), (end!.y - start.y)) >= 4;
  const line = element.kind === 'shape' && (element.shape === 'line' || element.shape === 'arrow');
  let left: number, top: number, width: number, height: number;
  if (dragged && target) {
    const x = clamp(target.x, surface.clientWidth), y = clamp(target.y, surface.clientHeight);
    left = Math.min(origin.x, x); top = Math.min(origin.y, y);
    width = Math.max(1, Math.abs(x - origin.x)); height = Math.max(line ? 1 : 16, Math.abs(y - origin.y));
  } else {
    const preferred = element.kind === 'table' ? { width: element.columns * 120, height: element.rows * 40 }
      : element.kind === 'image' && element.size ? {width:Math.max(1,element.size.width*Math.min(320/element.size.width,240/element.size.height)),height:Math.max(1,element.size.height*Math.min(320/element.size.width,240/element.size.height))}
      : element.kind === 'image' ? { width: 320, height: 240 }
      : element.kind === 'text' ? { width: 240, height: 48 }
      : { width: 160, height: line ? 2 : 96 };
    const fit = element.kind === 'image' ? Math.min(1,surface.clientWidth/preferred.width,surface.clientHeight/preferred.height) : 1;
    width = Math.max(1,Math.min(preferred.width*fit, surface.clientWidth)); height = Math.max(1,Math.min(preferred.height*fit, surface.clientHeight));
    left = clamp(origin.x - (anchor === 'center' ? width / 2 : 0), surface.clientWidth - width);
    top = clamp(origin.y - (anchor === 'center' ? height / 2 : 0), surface.clientHeight - height);
  }
  width = Math.min(width, surface.clientWidth - left, 4096);
  height = Math.min(height, surface.clientHeight - top, 4096);
  left += surface.scrollLeft; top += surface.scrollTop;
  if (width < 1 || height < 1 || left > 100_000 || top > 100_000) return null;
  return { left, top, width, height, ...(line && dragged && target ? { flipX: target.x < origin.x, flipY: target.y < origin.y } : {}) };
}
