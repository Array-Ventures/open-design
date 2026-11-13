import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { buildManualEditBridge } from '../../src/edit-mode/bridge';
function fixture() {
  const dom = new JSDOM(`<body style="position:static"><section data-od-id="slide" style="position:relative"><h1 data-od-id="heading">Retain me</h1><a href="#navigate">Link</a></section>${buildManualEditBridge(true)}</body>`, {runScripts:'dangerously',url:'http://localhost'});
  const win = dom.window, section = win.document.querySelector('section')!;
  const posts: Array<Record<string, unknown>> = [];
  win.postMessage = vi.fn(data => posts.push(data));
  section.getBoundingClientRect = () => ({left:100,top:200,width:500,height:300,right:600,bottom:500,x:100,y:200,toJSON(){}});
  for (const [name,value] of Object.entries({offsetWidth:1000,offsetHeight:600,clientWidth:980,clientHeight:580,clientLeft:10,clientTop:10,scrollLeft:0,scrollTop:0})) Object.defineProperty(section,name,{value,configurable:true});
  const message = (data: object, source: Window | null = win as unknown as Window) => win.dispatchEvent(new win.MessageEvent('message',{source,data}));
  const arm = () => message({type:'od-insert-arm',requestId:'request-1',element:{kind:'text',text:'New text'}});
  const pointer = (type: string, x: number, y: number, target: Element = section) => {
    const event = new win.MouseEvent(type,{bubbles:true,cancelable:true,clientX:x,clientY:y,button:0});
    Object.defineProperty(event,'pointerId',{value:1}); target.dispatchEvent(event); return event;
  };
  return {dom,win,section,posts,message,arm,pointer};
}
describe('canvas insertion bridge', () => {
  it('discovers and selects an inserted thin SVG as a source-owned object', async () => {
    const {win,section,posts,message,pointer} = fixture();
    const svg = win.document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('data-od-id','eve-246109ab-8f8b-422b-b088-1260d39478d4');
    svg.setAttribute('data-od-edit','container');
    svg.append(win.document.createElementNS('http://www.w3.org/2000/svg','line')); section.append(svg);
    svg.getBoundingClientRect = () => ({left:100,top:200,width:160,height:1,right:260,bottom:201,x:100,y:200,toJSON(){}});
    message({type:'od-edit-mode',enabled:true});
    await new Promise(resolve => setTimeout(resolve,10));
    expect(posts.some(item => item.type === 'od-edit-targets' && (item.targets as Array<{id:string}>).some(target => target.id === svg.getAttribute('data-od-id')))).toBe(true);
    pointer('click',155,200,svg.querySelector('line')!);
    expect(posts).toContainEqual(expect.objectContaining({type:'od-edit-select',target:expect.objectContaining({id:svg.getAttribute('data-od-id'),kind:'container'})}));
    win.close();
  });

  it('places a subsequent object on the canvas rather than inside an existing text box', () => {
    const {win,section,posts,arm,pointer} = fixture();
    const text = win.document.createElement('div'); text.setAttribute('data-od-id','existing-box');
    text.setAttribute('data-od-edit','text'); text.style.position='absolute'; text.textContent='Existing text'; section.append(text);
    arm(); pointer('pointerdown',155,255,text); pointer('pointerup',255,305,text);
    expect(posts).toContainEqual(expect.objectContaining({type:'od-insert-placement',parentId:'slide'}));
    win.close();
  });
  it('captures the placing pointer and cancels cleanly if that capture is lost', () => {
    const {win,section,posts,arm,pointer} = fixture();
    const capture = vi.fn(); Object.defineProperty(section,'setPointerCapture',{value:capture});
    arm(); pointer('pointerdown',155,255);
    expect(capture).toHaveBeenCalledWith(1);
    const lost = new win.Event('lostpointercapture',{bubbles:true}); Object.defineProperty(lost,'pointerId',{value:1}); section.dispatchEvent(lost);
    expect(posts).toContainEqual({type:'od-insert-cancelled',requestId:'request-1'});
    pointer('pointerup',255,305);
    expect(posts.some(item => item.type === 'od-insert-placement')).toBe(false); win.close();
  });
  it('proposes scaled geometry while leaving source content and navigation untouched', () => {
    const {win,section,posts,arm,pointer} = fixture(); arm();
    expect(posts).toContainEqual({type:'od-insert-armed',requestId:'request-1'});
    const authored = section.outerHTML;
    expect(pointer('pointerdown',155,255).defaultPrevented).toBe(true);
    pointer('pointermove',255,305); pointer('pointerup',255,305);
    expect(posts).toContainEqual({type:'od-insert-placement',requestId:'request-1',parentId:'slide',placement:{left:100,top:100,width:200,height:100}});
    expect(section.outerHTML).toBe(authored); expect(win.document.querySelector('[data-od-inserting]')).toBeNull();
    expect(pointer('click',255,305,section.querySelector('a')!).defaultPrevented).toBe(true);
    expect(win.location.hash).toBe(''); win.close();
  });
  it('Escape cancels without writing or selecting the underlying element', () => {
    const {win,posts,arm,pointer} = fixture(); arm(); pointer('pointerdown',155,255);
    win.dispatchEvent(new win.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})); pointer('pointerup',255,305);
    expect(posts).toContainEqual({type:'od-insert-cancelled',requestId:'request-1'});
    expect(posts.some(item => item.type === 'od-insert-placement')).toBe(false); win.close();
  });
  it('ignores an arm request from an unrelated window and outside edit mode', () => {
    const {win,posts,message,arm} = fixture();
    message({type:'od-insert-arm',requestId:'other',element:{kind:'text'}},null);
    expect(posts).toEqual([]); message({type:'od-edit-mode',enabled:false}); arm();
    expect(posts.some(item => item.type === 'od-insert-armed')).toBe(false); win.close();
  });
  it('refuses geometry that changed while dragging', () => {
    const {win,section,posts,arm,pointer} = fixture(); arm(); pointer('pointerdown',155,255);
    Object.defineProperty(section,'scrollTop',{value:40}); pointer('pointerup',255,305);
    expect(posts).toContainEqual({type:'od-insert-cancelled',requestId:'request-1'});
    expect(posts.some(item => item.type === 'od-insert-placement')).toBe(false); win.close();
  });
  it('keeps insertion armed and reports an unsupported canvas without navigating', () => {
    const {win,posts,arm,pointer} = fixture(); arm(); pointer('pointerdown',20,20,win.document.body);
    expect(posts).toContainEqual({type:'od-insert-unavailable',requestId:'request-1'});
    expect(posts.some(item => item.type === 'od-insert-placement')).toBe(false); win.close();
  });
  it('Enter places a default object at the visible canvas center', () => {
    const {win,section,posts,arm} = fixture();
    Object.defineProperty(win,'innerWidth',{value:400}); Object.defineProperty(win,'innerHeight',{value:600});
    win.document.elementFromPoint = () => section;
    arm(); win.dispatchEvent(new win.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
    expect(posts).toContainEqual({type:'od-insert-placement',requestId:'request-1',parentId:'slide',placement:{left:70,top:166,width:240,height:48}}); win.close();
  });
});
