import { expect, it } from 'vitest';
import { load } from 'cheerio';
import { documentDocxSourceColors,normalizedDocumentDocxHtml,resolvedDocumentDocxColorOwners } from '../src/embedded-render/document-docx-source-colors.js';
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

it('keeps prepared disabled checklist inputs and their checked states while annotating label text', () => {
  const source=documentDocxSourceColors('<html><body><ul class="task-list"><li aria-checked="true"><label><input type="checkbox" disabled checked>Completed task</label></li><li aria-checked="false"><label><input type="checkbox" disabled>Pending task</label></li></ul></body></html>');
  const $=load(source.html), inputs=$('input');
  expect(inputs).toHaveLength(2);expect(inputs.eq(0).is('[disabled][checked]')).toBe(true);expect(inputs.eq(1).is('[disabled]:not([checked])')).toBe(true);
  expect($('label').map((_index,node)=>$(node).text()).get()).toEqual(['Completed task','Pending task']);
  expect(source.requests.map(r=>r.kind)).toEqual(['inline','inline']);
});

it('retains whitespace-only inline owners so highlighted spaces cannot silently lose their shading', () => {
  const source=documentDocxSourceColors('<body>\n<p><span style="background-color:yellow"><b>A</b> <i>B</i></span></p>\n</body>'),$=load(source.html);
  const wrappers=$(`[${source.attributeName}]`);
  expect(wrappers.map((_index,node)=>$(node).text()).get()).toEqual(['A',' ','B']);
  expect(source.requests).toHaveLength(3); // Structural indentation remains unwrapped.
});


it('restores collapsed TD/LI/P indentation before Pandoc while retaining the visible highlighted space owner', () => {
  const html='<html><body><table><tr><td style="background-color:#182828">\n<p>Value</p>\n</td><td><p><span style="background-color:yellow"><b>A</b> <i>B</i></span></p></td></tr></table><ul><li>\n<p>List value</p>\n</li></ul><p>\n<span>Paragraph value</span>\n</p></body></html>';
  const source=documentDocxSourceColors(html),$=load(source.html),resolved=new Map(source.requests.map(request=>[request.id,{}]));
  const visibleSpace=$(`[${source.attributeName}]`).toArray().find(node=>$(node).text()===' ' && $(node).parent().attr('style')==='background-color:yellow')!;
  const id=$(visibleSpace).attr(source.attributeName)!;resolved.set(id,{background:'FFFF00'});
  const output=load(normalizedDocumentDocxHtml(source,resolved));
  expect(output('td').first().html()).toBe('\n<p>Value</p>\n');
  expect(output('li').html()).toBe('\n<p>List value</p>\n');
  expect(output('body>p').html()).toBe('\n<span>Paragraph value</span>\n');
  expect(output(`[${source.attributeName}="${id}"]`).text()).toBe(' ');
  expect(output('#original').length).toBe(0);
});

it('preserves the actual ordinary-GFM MathML corpus and TeX annotations exactly while annotating surrounding HTML', async () => {
  const { readFile } = await import('node:fs/promises');
  const html=await readFile(new URL('./fixtures/documents/gfm-builtins-prepared.html',import.meta.url),'utf8'),before=load(html);
  const originalMath=before('math').toArray().map(node=>before(node).toString());
  expect(originalMath).toHaveLength(22);
  const source=documentDocxSourceColors(html),after=load(source.html);
  expect(after('math').toArray().map(node=>after(node).toString())).toEqual(originalMath);
  expect(after(`math[${source.attributeName}],math [${source.attributeName}]`)).toHaveLength(0);
  expect(after('math annotation').toArray().map(node=>after(node).text())).toEqual(before('math annotation').toArray().map(node=>before(node).text()));
  expect(after(`h1 [${source.attributeName}]`).text()).toBe('Heading one');
  expect(after(`section.footnotes [${source.attributeName}]`).length).toBeGreaterThan(0);
  expect(source.requests.length).toBeGreaterThan(50);
  const restored=load(normalizedDocumentDocxHtml(source,new Map(source.requests.map(request=>[request.id,{}]))));
  expect(restored('math').toArray().map(node=>restored(node).toString())).toEqual(originalMath);
  expect(restored('section.footnotes').text()).toBe(before('section.footnotes').text());
});
