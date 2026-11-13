import type { CSSProperties } from 'react';
import type { ManualEditTarget } from './types';

interface CanvasSize { width: number; height: number }
interface PanelPlacementOptions { bottomInset?: number; position?: {left:number;top:number} | null }
/** Keep the properties card in the visible canvas above insertion chrome.
 * This constrains only the card: authored canvas size and scale stay intact. */
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
  const panelHeight = Math.min(380,Math.max(0,height-bottom-pad*2));
  const maxLeft = Math.max(pad,width-panelWidth-pad), maxTop = Math.max(pad,height-bottom-panelHeight-pad);
  const clamp = (value: number,min: number,max: number) => Math.max(min,Math.min(max,value));
  const targetLeft = target.rect.x * scale, targetTop = target.rect.y * scale;
  const targetRight = (target.rect.x+target.rect.width)*scale;
  let left = targetRight+pad;
  if (left+panelWidth > width-pad) left=targetLeft-panelWidth-pad;
  const requestedLeft = options.position?.left, requestedTop = options.position?.top;
  return {
    left:clamp(Number.isFinite(requestedLeft) ? requestedLeft! : Number.isFinite(left) ? left : pad,pad,maxLeft),
    top:clamp(Number.isFinite(requestedTop) ? requestedTop! : Number.isFinite(targetTop) ? targetTop : pad,pad,maxTop),
    width:panelWidth,maxHeight:panelHeight,
  };
}
