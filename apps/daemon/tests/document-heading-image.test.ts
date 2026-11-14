import { expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { documentDocxPresentationOwners, projectDocumentDocxPresentation } from '../src/embedded-render/document-docx-colors.js';
import { documentDocxSourcePresentation, normalizedDocumentDocxHtml, resolvedDocumentDocxPresentationOwners } from '../src/embedded-render/document-docx-source-colors.js';
const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const wp = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const descriptor = {headingLevel:1 as const,headingImageLineHeightPt:37.5,headingImageWidthPt:18,headingImageHeightPt:18,headingImageSource:'single-baseline-image' as const};
function fixture() {
  const ast = {blocks:[{t:'Header',c:[1,['',[],[]],[{t:'Image',c:[['',[],[]],[],['pixel.png','']]}]]}]};
  const owners = documentDocxPresentationOwners(ast,(_attrs,kind)=>kind==='heading'?descriptor:{}), owner = owners[0]!;
  const image = '<w:r><w:drawing><wp:inline distL="114300"><wp:extent cx="228600" cy="228600"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="228600" cy="228600"/></a:xfrm></pic:spPr><pic:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rIdImage"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
  const start = `<w:bookmarkStart w:id="${owner.id}" w:name="${owner.name}"/>`, end = `<w:bookmarkEnd w:id="${owner.id}"/>`;
  const wrap = (content:string) => `<w:document xmlns:w="${ns}" xmlns:wp="${wp}"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/><w:spacing w:before="360" w:after="240" w:line="750" w:lineRule="atLeast"/></w:pPr>${start}${content}${end}</w:p></w:body></w:document>`;
  return {owners,image,wrap};
}
it('projects only the verified image line while preserving later-heading margins and unrelated paragraph properties', () => {
  const {owners,image,wrap} = fixture();
  const result = projectDocumentDocxPresentation(wrap(image),owners);
  const doc = new DOMParser().parseFromString(result,'application/xml');
  const spacing = doc.getElementsByTagNameNS(ns,'spacing')[0]!;
  expect(spacing.getAttributeNS(ns,'lineRule')).toBe('exact');
  expect(spacing.getAttributeNS(ns,'line')).toBe('750');
  expect(spacing.getAttributeNS(ns,'before')).toBe('360');
  expect(spacing.getAttributeNS(ns,'after')).toBe('240');
  const inline = doc.getElementsByTagNameNS(wp,'inline')[0]!;
  for (const side of ['T','B','L','R']) expect(inline.getAttribute(`dist${side}`)).toBe('0');
  expect(doc.getElementsByTagNameNS(ns,'bookmarkStart')).toHaveLength(0);
});
it('refuses changed dimensions, text, duplicate drawings or floating image geometry', () => {
  const {owners,image,wrap} = fixture();
  for (const content of [image.replace('228600','228601'),image+'<w:r><w:t>Text</w:t></w:r>',image+image,image.replaceAll('wp:inline','wp:anchor')]) {
    expect(()=>projectDocumentDocxPresentation(wrap(content),owners)).toThrow('ownership');
  }
});
it('binds the actual source image through its Header and Image AST attributes', () => {
  const image = 'data:image/png;base64,AA==';
  const source = documentDocxSourcePresentation(`<html><body><main><h1><img src="${image}"></h1></main></body></html>`);
  const heading = source.requests.find(request=>request.kind==='heading')!;
  const resolved = new Map([[heading.id,descriptor]]);
  expect(normalizedDocumentDocxHtml(source,resolved)).toContain(`${source.attributeName}-image="${heading.id}"`);
  const ast = (id:string) => ({blocks:[{t:'Header',c:[1,['',[],[[source.attributeName.slice(5),heading.id]]],[{t:'Image',c:[['',[],[[`${source.attributeName.slice(5)}-image`,id]]],[],[image,'']]}]]}]});
  const input = ast(heading.id);
  const owners = resolvedDocumentDocxPresentationOwners(input,source,resolved);
  expect(owners).toHaveLength(1);
  expect(owners[0]!.imageAssetSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(input)).toContain('18pt');
  expect(()=>resolvedDocumentDocxPresentationOwners(ast(heading.id),{...source,html:source.html.replace(image,'data:image/png;base64,AQ==')},resolved)).toThrow('ownership');
  expect(JSON.stringify(input)).not.toContain(source.attributeName.slice(5));
  expect(()=>resolvedDocumentDocxPresentationOwners(ast('different-image'),source,resolved)).toThrow('ownership');
});
it.each(['before','after'])('refuses an image outside its exact heading bookmark range: %s', position => {
  const {owners,image,wrap} = fixture();
  const emptyRange = wrap('');
  const xml = position === 'before'
    ? emptyRange.replace(/(<w:bookmarkStart\b[^>]*\/>)/, image+'$1')
    : emptyRange.replace(/(<w:bookmarkEnd\b[^>]*\/>)/, '$1'+image);
  expect(()=>projectDocumentDocxPresentation(xml,owners)).toThrow('ownership');
});
it('normalizes only verified collapsed heading whitespace before parsing, preserving source attributes and visible NBSP', () => {
  const html = '<html><body><main><h1 id="title">\n <span id="wrapper">\n <img src="pixel.png" alt="Owned">\n </span>\n</h1></main></body></html>';
  const source = documentDocxSourcePresentation(html), original = source.html;
  const resolved = new Map(source.requests.map(request => [request.id,request.kind === 'heading' ? descriptor : {}]));
  const normalized = normalizedDocumentDocxHtml(source,resolved);
  expect(normalized).toContain('id="title"');
  expect(normalized).toContain('id="wrapper"><img');
  expect(normalized).toContain('src="pixel.png" alt="Owned"');
  expect(source.html).toBe(original);
  const visible = documentDocxSourcePresentation(html.replace('\n <img','&nbsp;<img'));
  const forged = new Map(visible.requests.map(request => [request.id,request.kind === 'heading' ? descriptor : {}]));
  expect(()=>normalizedDocumentDocxHtml(visible,forged)).toThrow('ownership');
  const unchanged = new Map(visible.requests.map(request => [request.id,{}]));
  expect(normalizedDocumentDocxHtml(visible,unchanged)).toContain('&nbsp;');
});

it('requires the exact selected source asset through the native embed relationship', () => {
  const {owners, image, wrap} = fixture();
  const digest = 'a'.repeat(64);
  owners[0]!.imageAssetSha256 = digest;
  expect(() => projectDocumentDocxPresentation(wrap(image),owners)).toThrow('ownership');
  expect(() => projectDocumentDocxPresentation(wrap(image),owners,new Map([['different',digest]]))).toThrow('ownership');
  expect(() => projectDocumentDocxPresentation(wrap(image),owners,new Map([['rIdImage','b'.repeat(64)]]))).toThrow('ownership');
  expect(projectDocumentDocxPresentation(wrap(image),owners,new Map([['rIdImage',digest]]))).toContain('lineRule="exact"');
  const changedTransform = image.replace('<a:ext cx="228600"','<a:ext cx="228601"');
  expect(() => projectDocumentDocxPresentation(wrap(changedTransform),owners,new Map([['rIdImage',digest]]))).toThrow('ownership');
});
