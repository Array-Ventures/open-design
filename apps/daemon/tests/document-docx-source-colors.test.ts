import { expect, it } from 'vitest';
import { load } from 'cheerio';
import { documentDocxSourceColors,resolvedDocumentDocxColorOwners } from '../src/embedded-render/document-docx-source-colors.js';
it('annotates each original text owner once and preserves authored IDs, styling and link identity', () => {
  const source=documentDocxSourceColors('<html><body><p id="authored"><span style="color:red">A <b>B</b></span><a id="link" href="https://fixture.test">C</a></p><table><tr><td id="cell">D</td></tr></table></body></html>');
  const $=load(source.html);
  expect(source.requests.filter(r=>r.kind==='inline')).toHaveLength(4);
  expect(source.requests.filter(r=>r.kind==='cell')).toHaveLength(1);
  expect($('#authored').text()).toBe('A BC');expect($('#link').attr('href')).toBe('https://fixture.test');expect($('#cell').text()).toBe('D');
  expect($(`[${source.attributeName}]`)).toHaveLength(5);
  expect($('b').text()).toBe('B');expect($('span[style]').attr('style')).toBe('color:red');
});
it('removes only generated data ownership and refuses vanished or duplicated normalized colored owners', () => {
  const source=documentDocxSourceColors('<p id="original">A</p>'), request=source.requests[0]!, key=source.attributeName.slice(5);
  const ast=()=>({blocks:[{t:'Para',c:[{t:'Span',c:[['original',[],[[key,request.id],['authored','retained']]],[{t:'Str',c:'A'}]]}]}]});
  const input=ast(), colors=new Map([[request.id,{foreground:'FF0000'}]]);
  expect(resolvedDocumentDocxColorOwners(input,source,colors)).toHaveLength(1);
  expect(JSON.stringify(input)).not.toContain(key);expect(JSON.stringify(input)).toContain('original');expect(JSON.stringify(input)).toContain('retained');
  expect(()=>resolvedDocumentDocxColorOwners({blocks:[]},source,colors)).toThrow('ownership');
  const duplicate=ast();duplicate.blocks[0]!.c.push(structuredClone(duplicate.blocks[0]!.c[0]!));
  expect(()=>resolvedDocumentDocxColorOwners(duplicate,source,colors)).toThrow('ownership');
  expect(()=>resolvedDocumentDocxColorOwners(ast(),source,new Map([['wrong',{}]]))).toThrow('ownership');
});

it.each(['Code', 'CodeBlock'])('permits proved-empty %s wrappers to disappear but refuses the identical lost colored owner', kind => {
  const source=documentDocxSourceColors(kind==='Code'?'<p><code> x  y </code></p>':'<pre>  x\n  y</pre>'), id=source.requests[0]!.id;
  const code={t:kind,c:[['',kind==='CodeBlock'?['javascript']:[],[]],kind==='Code'?' x  y ':'  x\n  y']};
  const input=kind==='Code'?{blocks:[{t:'Para',c:[code]}]}:{blocks:[code]};
  const before=structuredClone(input);
  expect(resolvedDocumentDocxColorOwners(input,source,new Map([[id,{}]]))).toEqual([]);
  expect(input).toEqual(before); // Native code text/language/whitespace remain owned by Pandoc.
  expect(()=>resolvedDocumentDocxColorOwners(structuredClone(input),source,new Map([[id,{foreground:'FF0000'}]]))).toThrow('ownership');
});
