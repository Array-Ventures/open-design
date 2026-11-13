import {describe,expect,it} from 'vitest';
import {manualEditFloatingPanelStyle} from '../../src/edit-mode/panel-placement';
const target={rect:{x:400,y:700,width:240,height:48}};
describe('properties placement above insertion chrome',() => {
  it('reserves measured toolbar/status space without changing authored geometry',() => {
    const original=structuredClone(target);
    const style=manualEditFloatingPanelStyle(target,1,{width:800,height:900},{bottomInset:104});
    expect(style).toEqual({left:68,top:404,width:320,maxHeight:380});
    expect(Number(style.top)+Number(style.maxHeight)).toBeLessThanOrEqual(900-104-12);
    expect(target).toEqual(original);
  });
  it('clamps a dragged card when the viewport shrinks or the status wraps',() => {
    const style=manualEditFloatingPanelStyle(target,1,{width:300,height:400},{bottomInset:144,position:{left:800,top:900}});
    expect(style).toEqual({left:12,top:12,width:276,maxHeight:232});
  });
  it('uses source preview scale while keeping the card in viewport pixels',() => {
    expect(manualEditFloatingPanelStyle(target,0.5,{width:800,height:900},{bottomInset:64}))
      .toEqual({left:332,top:350,width:320,maxHeight:380});
  });
  it('does not retain offscreen or nonfinite drag positions',() => {
    expect(manualEditFloatingPanelStyle(target,NaN,{width:800,height:900},{position:{left:-100,top:Infinity}}))
      .toEqual({left:12,top:508,width:320,maxHeight:380});
  });
});
