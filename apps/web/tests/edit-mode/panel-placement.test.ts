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
  it('places a split-pane card below a selection when neither side fits',() => {
    const shape={rect:{x:160,y:240,width:160,height:96}}, original=structuredClone(shape);
    const style=manualEditFloatingPanelStyle(shape,1,{width:640,height:940},{bottomInset:80});
    expect(overlap(style,shape.rect)).toBe(0);
    expect(Number(style.top)).toBeGreaterThanOrEqual(shape.rect.y+shape.rect.height+12);
    expect(Number(style.top)+Number(style.maxHeight)).toBeLessThanOrEqual(940-80-12);
    expect(style.maxHeight).toBe(380);expect(shape).toEqual(original);
  });
  it('uses a shorter card above an image when no full-height region fits',() => {
    const image={rect:{x:160,y:360,width:320,height:160}};
    const style=manualEditFloatingPanelStyle(image,1,{width:640,height:800},{bottomInset:80});
    expect(overlap(style,image.rect)).toBe(0);
    expect(Number(style.maxHeight)).toBeGreaterThanOrEqual(220);
    expect(Number(style.maxHeight)).toBeLessThan(380);
    expect(Number(style.top)+Number(style.maxHeight)).toBeLessThanOrEqual(image.rect.y-12);
  });
  it('preserves a user-positioned card even if it covers the selected object',() => {
    const shape={rect:{x:160,y:240,width:160,height:96}};
    const style=manualEditFloatingPanelStyle(shape,1,{width:640,height:940},{position:{left:24,top:32},bottomInset:80});
    expect(style).toEqual({left:24,top:32,width:320,maxHeight:380});
  });
  it('applies the same non-overlap guarantee to a scaled source canvas',() => {
    const shape={rect:{x:320,y:480,width:320,height:192}};
    const style=manualEditFloatingPanelStyle(shape,0.5,{width:640,height:940},{bottomInset:80});
    expect(overlap(style,shape.rect,0.5)).toBe(0);
    expect(style).toEqual(manualEditFloatingPanelStyle({rect:{x:160,y:240,width:160,height:96}},1,{width:640,height:940},{bottomInset:80}));
  });
  it('keeps controls bounded when a large selection leaves no usable empty region',() => {
    const shape={rect:{x:16,y:150,width:400,height:400}};
    const style=manualEditFloatingPanelStyle(shape,1,{width:460,height:900},{bottomInset:124});
    expect(Number(style.left)).toBeGreaterThanOrEqual(12);expect(Number(style.top)).toBeGreaterThanOrEqual(12);
    expect(Number(style.left)+Number(style.width)).toBeLessThanOrEqual(448);
    expect(Number(style.top)+Number(style.maxHeight)).toBeLessThanOrEqual(900-124-12);
    // Given the minimum usable editor size, every corner overlaps. The chosen
    // position must cover no more content than any other in-bounds corner.
    for(const left of [12,128]) for(const top of [12,384]) {
      expect(overlap(style,shape.rect)).toBeLessThanOrEqual(overlap({...style,left,top},shape.rect));
    }
  });

});

function overlap(style:ReturnType<typeof manualEditFloatingPanelStyle>,rect:typeof target.rect,scale=1) {
  return Math.max(0,Math.min(Number(style.left)+Number(style.width),(rect.x+rect.width)*scale)-Math.max(Number(style.left),rect.x*scale))
    * Math.max(0,Math.min(Number(style.top)+Number(style.maxHeight),(rect.y+rect.height)*scale)-Math.max(Number(style.top),rect.y*scale));
}
