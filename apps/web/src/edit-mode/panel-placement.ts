import type { CSSProperties } from 'react';
import type { ManualEditTarget } from './types';

interface CanvasSize { width: number; height: number }
interface PanelPlacementOptions { bottomInset?: number; position?: {left:number;top:number} | null }
/** Keep the properties card in the visible canvas above insertion chrome.
 * Prefer space outside the selection; never change authored geometry or scale.
 * A user's dragged/pinned position takes precedence over automatic placement. */
export function manualEditFloatingPanelStyle(
  target: Pick<ManualEditTarget,'rect'>,
  previewScale: number,
  canvasSize: CanvasSize | undefined,
  options: PanelPlacementOptions = {},
): CSSProperties {
  const scale = Number.isFinite(previewScale) && previewScale > 0 ? previewScale : 1;
  const pad = 12;
  const width = Number.isFinite(canvasSize?.width) ? Math.max(0,canvasSize!.width) : 1200;
  const height = Number.isFinite(canvasSize?.height) ? Math.max(0,canvasSize!.height) : 800;
  const bottom = Number.isFinite(options.bottomInset) ? Math.max(0,options.bottomInset!) : 0;
  const panelWidth = Math.min(320,Math.max(0,width-pad*2));
  let panelHeight = Math.min(380,Math.max(0,height-bottom-pad*2));
  const rightEdge = width-pad, bottomEdge = height-bottom-pad;
  const maxLeft = Math.max(pad,rightEdge-panelWidth);
  const clamp = (value: number,min: number,max: number) => Math.max(min,Math.min(max,value));
  const finite = (value: number) => Number.isFinite(value) ? value : 0;
  const targetLeft = finite(target.rect.x)*scale, targetTop = finite(target.rect.y)*scale;
  const targetRight = targetLeft+Math.max(0,finite(target.rect.width))*scale;
  const targetBottom = targetTop+Math.max(0,finite(target.rect.height))*scale;
  const requestedLeft = options.position?.left, requestedTop = options.position?.top;
  const positioned = Number.isFinite(requestedLeft) || Number.isFinite(requestedTop);
  let left = targetRight+pad, top = targetTop;
  if (left+panelWidth > rightEdge) left=targetLeft-panelWidth-pad;

  if (!positioned && (left < pad || left+panelWidth > rightEdge)) {
    const belowTop = Math.max(pad,targetBottom+pad);
    const aboveBottom = Math.min(bottomEdge,targetTop-pad);
    const belowSpace = Math.max(0,bottomEdge-belowTop);
    const aboveSpace = Math.max(0,aboveBottom-pad);
    const minimumHeight = Math.min(220,panelHeight);
    if (belowSpace >= minimumHeight || aboveSpace >= minimumHeight) {
      // A full-height card below the object is preferable to a shortened one
      // above it. If neither fits in full, use the larger usable scroll region.
      const below = belowSpace >= panelHeight || (aboveSpace < panelHeight && belowSpace >= aboveSpace);
      panelHeight = Math.min(panelHeight,below ? belowSpace : aboveSpace);
      top = below ? belowTop : aboveBottom-panelHeight;
      left = clamp(targetLeft,pad,maxLeft);
    } else {
      // Large selections may leave no non-overlapping region. Keep the card
      // usable in the corner covering the least selection, rather than
      // arbitrarily dropping it over the centre of the selected object.
      const maxTop = Math.max(pad,bottomEdge-panelHeight);
      const corners = [
        {left:pad,top:pad}, {left:maxLeft,top:pad},
        {left:pad,top:maxTop}, {left:maxLeft,top:maxTop},
      ];
      const overlap = (point: {left:number;top:number}) => (
        Math.max(0,Math.min(point.left+panelWidth,targetRight)-Math.max(point.left,targetLeft))
        * Math.max(0,Math.min(point.top+panelHeight,targetBottom)-Math.max(point.top,targetTop))
      );
      const best = corners.reduce((best,point) => overlap(point) < overlap(best) ? point : best);
      left=best.left;top=best.top;
    }
  }
  const maxTop = Math.max(pad,bottomEdge-panelHeight);
  return {
    left:clamp(Number.isFinite(requestedLeft) ? requestedLeft! : left,pad,maxLeft),
    top:clamp(Number.isFinite(requestedTop) ? requestedTop! : top,pad,maxTop),
    width:panelWidth,maxHeight:panelHeight,
  };
}
