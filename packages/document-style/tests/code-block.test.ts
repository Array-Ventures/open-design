// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { documentCodeBlockGeometry } from '../src/code-block.js';

function fixture(body = '<p>Before</p><pre><code>line\nnext</code></pre><p>After</p>') {
  document.head.innerHTML = `<style>body{margin:0;padding:0}main{padding:0;border:0;direction:ltr;writing-mode:horizontal-tb}pre{display:block;position:static;float:none;transform:none;direction:ltr;writing-mode:horizontal-tb;text-align:start;white-space:pre;padding:16px;border:0;margin:14px 0;font:14px/21px monospace}pre code{line-height:21px}p{margin:0 0 20px}main>:first-child{margin-top:0}</style>`;
  document.body.innerHTML = `<main>${body}</main>`;
  const main = document.querySelector('main')!;
  const codes = Array.from(document.querySelectorAll('pre'));
  const rectangle = (top:number,height:number) => ({x:0,y:top,left:0,right:672,top,bottom:top+height,width:672,height,toJSON(){return {};}});
  vi.spyOn(main,'getBoundingClientRect').mockReturnValue(rectangle(0,300));
  for (const [index,pre] of codes.entries()) vi.spyOn(pre,'getBoundingClientRect').mockReturnValue(rectangle(pre.previousElementSibling?.tagName==='P' ? 50 : index===0 ? 0 : 88,74));
  vi.spyOn(document,'createRange').mockReturnValue({selectNodeContents(){},getClientRects:()=>[{width:100,height:21}]} as unknown as Range);
  return { main, codes, measure:(index=0)=>documentCodeBlockGeometry(document,codes[index]!,672,912) };
}
afterEach(()=>{vi.restoreAllMocks();document.head.replaceChildren();document.body.replaceChildren();});
it('maps padding plus the larger collapsed neighboring margin without changing the source',()=>{
  const f=fixture(),before=document.documentElement.outerHTML;
  expect(f.measure()).toEqual({codeBlockSource:'canonical-pre',codeBlockBeforePt:27,codeBlockAfterPt:22.5,codeBlockStartPt:12,codeBlockEndPt:12,codeBlockLineCount:2});
  expect(document.documentElement.outerHTML).toBe(before);
});
it('keeps first-block margin zero and adds both padding edges between adjacent code blocks',()=>{
  const f=fixture('<pre><code>line\nnext</code></pre><pre><code>line\nnext</code></pre><p>After</p>');
  expect(f.measure().codeBlockBeforePt).toBe(12);
  expect(f.measure(1).codeBlockBeforePt).toBe(34.5);
  expect(f.measure(1).codeBlockAfterPt).toBe(22.5);
});
it('retains terminal bottom padding and margin',()=>{
  const f=fixture('<p>Before</p><pre><code>line\nnext</code></pre>');
  expect(f.measure().codeBlockAfterPt).toBe(22.5);
});
it.each(['container','explicit-size','class','overflow','pagination','tab','unsupported-neighbor'] as const)('declines unproved %s geometry without fabricating a receipt',problem=>{
  const f=fixture();
  if(problem==='container') f.main.style.width='400px';
  if(problem==='explicit-size') f.codes[0]!.style.height='95px';
  if(problem==='class') f.codes[0]!.className='numberLines';
  if(problem==='overflow') vi.spyOn(document,'createRange').mockReturnValue({selectNodeContents(){},getClientRects:()=>[{width:700,height:21}]} as unknown as Range);
  if(problem==='pagination') vi.spyOn(f.codes[0]!,'getBoundingClientRect').mockReturnValue({top:900,bottom:974,width:672,height:74} as DOMRect);
  if(problem==='tab') f.codes[0]!.textContent='line\t next';
  if(problem==='unsupported-neighbor') f.main.firstElementChild!.replaceWith(document.createElement('ul'));
  expect(f.measure()).toEqual({});
});
