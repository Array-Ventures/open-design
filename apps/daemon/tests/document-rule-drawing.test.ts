import { expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { documentDocxSourcePresentation } from '../src/embedded-render/document-docx-source-colors.js';
import { documentDocxDividers, projectDocumentDocxDividers } from '../src/embedded-render/document-docx-dividers.js';
const w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const wp = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const wp14 = 'http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing';
const mc = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const v = 'urn:schemas-microsoft-com:vml';
function fixture(width = '40%', frame = (rule:string)=>`<main><p>Before</p>${rule}<p>After</p></main>`) {
  const html = `<html data-eve-document="1"><body>${frame(`<hr id="authored" style="width:${width};color:red">`)}</body></html>`;
  const source = documentDocxSourcePresentation(html), request = source.requests.find(request=>request.kind==='divider')!;
  const result = documentDocxDividers(source.html,source,new Map([[request.id,{foreground:'FF0000'}]]));
  const name = result.owners[0]!.name;
  const before = '<w:p><w:r><w:t>Before</w:t></w:r></w:p>', after = '<w:p><w:pPr><w:spacing w:before="123"/></w:pPr><w:r><w:t>After</w:t></w:r></w:p>';
  const xml = `<w:document xmlns:w="${w}" xmlns:v="${v}" xmlns:o="urn:schemas-microsoft-com:office:office"><w:body>${before}<w:bookmarkStart w:id="9" w:name="${name}"/><w:p><w:pPr><w:keepNext/></w:pPr><w:r><w:pict><v:rect style="width:0;height:1.5pt" o:hr="t" o:hrstd="t"/></w:pict></w:r></w:p><w:bookmarkEnd w:id="9"/>${after}</w:body></w:document>`;
  return {result,xml,before,after};
}
it('adds a schema-ordered editable line anchor with margin-relative percentage width and the original legacy fallback', () => {
  const {result,xml,before,after} = fixture();
  const output = projectDocumentDocxDividers(xml,result.owners), doc = new DOMParser().parseFromString(output,'application/xml');
  expect(output).toContain(before); expect(output).toContain(after); expect(output).not.toContain('bookmark');
  const anchor = doc.getElementsByTagNameNS(wp,'anchor')[0]!;
  expect(anchor).toBeDefined();
  expect(Array.from(anchor.childNodes).filter(node=>node.nodeType===1).map(node=>node.localName)).toEqual(['simplePos','positionH','positionV','extent','effectExtent','wrapNone','docPr','graphic','sizeRelH']);
  expect(doc.getElementsByTagNameNS(wp,'inline')).toHaveLength(0);
  expect(doc.getElementsByTagNameNS(wp,'positionH')[0]!.getAttribute('relativeFrom')).toBe('margin');
  expect(doc.getElementsByTagNameNS(wp,'positionV')[0]!.getAttribute('relativeFrom')).toBe('line');
  expect(doc.getElementsByTagNameNS(wp,'posOffset')[0]!.textContent).toBe('4763');
  expect(doc.getElementsByTagNameNS(wp14,'sizeRelH')[0]!.getAttribute('relativeFrom')).toBe('margin');
  expect(doc.getElementsByTagNameNS(wp14,'pctWidth')[0]!.textContent).toBe('40000');
  expect(doc.getElementsByTagNameNS(wp,'extent')[0]!.getAttribute('cx')).toBe('2560320');
  expect(doc.getElementsByTagNameNS(mc,'Choice')[0]!.getAttribute('Requires')).toBe('wps');
  expect(doc.getElementsByTagNameNS(mc,'Fallback')[0]!.getElementsByTagNameNS(v,'rect')).toHaveLength(1);
  const spacing = doc.getElementsByTagNameNS(w,'spacing')[0]!;
  expect(spacing.getAttributeNS(w,'before')).toBe('360');
  expect(spacing.getAttributeNS(w,'after')).toBe('360');
});
it.each([
  (rule:string)=>`<main><blockquote>${rule}</blockquote></main>`,
  (rule:string)=>`<main style="width:400px">${rule}</main>`,
  (rule:string)=>`<main hidden>${rule}</main>`,
])('retains the existing legacy behavior for unqualified source containers', frame => {
  const {result,xml} = fixture('40%',frame);
  expect(new DOMParser().parseFromString(projectDocumentDocxDividers(xml,result.owners),'application/xml').getElementsByTagNameNS(wp,'anchor')).toHaveLength(0);
});
it('resolves absolute pixels without adding a relative-size field, and retains oversized legacy behavior', () => {
  const absolute = fixture('240px');
  const doc = new DOMParser().parseFromString(projectDocumentDocxDividers(absolute.xml,absolute.result.owners),'application/xml');
  expect(doc.getElementsByTagNameNS(wp,'extent')[0]!.getAttribute('cx')).toBe('2286000');
  expect(doc.getElementsByTagNameNS(wp14,'sizeRelH')).toHaveLength(0);
  const oversized = fixture('9999px');
  const legacy = new DOMParser().parseFromString(projectDocumentDocxDividers(oversized.xml,oversized.result.owners),'application/xml');
  expect(legacy.getElementsByTagNameNS(wp,'anchor')).toHaveLength(0);
});
it('allocates document-local numeric IDs and isolates namespace bindings from an unrelated root prefix', () => {
  const {result,xml} = fixture();
  const unrelated = `<w:p><w:r><w:drawing><x:inline xmlns:x="${wp}"><x:docPr id="01" name="Existing"/></x:inline></w:drawing></w:r></w:p>`;
  const input = xml.replace('<w:document ', '<w:document xmlns:wp="urn:unrelated-prefix" ').replace('<w:body>',`<w:body>${unrelated}`);
  const output = projectDocumentDocxDividers(input,result.owners), doc = new DOMParser().parseFromString(output,'application/xml');
  expect(output).toContain(unrelated);
  expect(doc.documentElement!.lookupNamespaceURI('wp')).toBe('urn:unrelated-prefix');
  const anchor = doc.getElementsByTagNameNS(wp,'anchor')[0]!;
  expect(anchor.lookupNamespaceURI('wp')).toBe(wp);
  const ids = Array.from(doc.getElementsByTagNameNS(wp,'docPr')).map(node=>Number(node.getAttribute('id')));
  expect(ids).toEqual([1,2]);
});
it('refuses a canonical source owner moved under an unrelated native container', () => {
  const {result,xml} = fixture();
  const input = xml.replace('<w:bookmarkStart','<w:sdt><w:sdtContent><w:bookmarkStart').replace('<w:bookmarkEnd w:id="9"/>','<w:bookmarkEnd w:id="9"/></w:sdtContent></w:sdt>');
  expect(()=>projectDocumentDocxDividers(input,result.owners)).toThrow('presentation');
});
it.each(['before','after'])('does not borrow a native rule outside its exact bookmark range: %s', position => {
  const {result,xml} = fixture();
  const picture = xml.match(/<w:pict>.*?<\/w:pict>/)![0];
  const outside = `<w:p><w:r>${picture}</w:r></w:p>`;
  const emptyRange = xml.replace(picture,'');
  const input = position === 'before'
    ? emptyRange.replace('<w:bookmarkStart',outside+'<w:bookmarkStart')
    : emptyRange.replace('<w:bookmarkEnd w:id="9"/>','<w:bookmarkEnd w:id="9"/>'+outside);
  expect(()=>projectDocumentDocxDividers(input,result.owners)).toThrow('presentation');
});

it.each(['style="width:400px"', 'hidden'])('does not qualify authored root container geometry: %s', attribute => {
  const {result} = fixture();
  const html = `<html data-eve-document="1" ${attribute}><body><main><hr style="width:40%;color:red"></main></body></html>`;
  const source = documentDocxSourcePresentation(html);
  const request = source.requests.find(request => request.kind === 'divider')!;
  const converted = documentDocxDividers(source.html, source, new Map([[request.id, {foreground:'FF0000'}]]));
  expect(result.owners[0]!.sourceBlock).toBe('canonical-main');
  expect(converted.owners[0]!.sourceBlock).toBeUndefined();
});

it('keeps the owned explicit background and foreground in modern and legacy representations', () => {
  const {result, xml} = fixture();
  result.owners[0]!.colors.background = '00FF00';
  const output = projectDocumentDocxDividers(xml, result.owners);
  const doc = new DOMParser().parseFromString(output, 'application/xml');
  const colors = Array.from(doc.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/main', 'srgbClr'));
  expect(colors.map(color => color.getAttribute('val'))).toEqual(['00FF00', 'FF0000']);
  const fallback = doc.getElementsByTagNameNS(mc, 'Fallback')[0]!;
  const rectangle = fallback.getElementsByTagNameNS(v, 'rect')[0]!;
  expect(rectangle.getAttribute('fillcolor')).toBe('#00FF00');
  expect(rectangle.getAttribute('strokecolor')).toBe('#FF0000');
});
