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
  const image = '<w:r><w:drawing><wp:inline distL="114300"><wp:extent cx="228600" cy="228600"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rIdImage"/></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
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
  const source = documentDocxSourcePresentation('<html><body><main><h1><img src="pixel.png"></h1></main></body></html>');
  const heading = source.requests.find(request=>request.kind==='heading')!;
  const resolved = new Map([[heading.id,descriptor]]);
  expect(normalizedDocumentDocxHtml(source,resolved)).toContain(`${source.attributeName}-image="${heading.id}"`);
  const ast = (id:string) => ({blocks:[{t:'Header',c:[1,['',[],[[source.attributeName.slice(5),heading.id]]],[{t:'Image',c:[['',[],[[`${source.attributeName.slice(5)}-image`,id]]],[],['pixel.png','']]}]]}]});
  const input = ast(heading.id);
  expect(resolvedDocumentDocxPresentationOwners(input,source,resolved)).toHaveLength(1);
  expect(JSON.stringify(input)).not.toContain(source.attributeName.slice(5));
  expect(()=>resolvedDocumentDocxPresentationOwners(ast('different-image'),source,resolved)).toThrow('ownership');
});
