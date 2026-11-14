import { expect, it } from 'vitest';
import { documentDocxPresentationOwners, projectDocumentDocxPresentation } from '../src/embedded-render/document-docx-colors.js';
import { documentDocxSourcePresentation, normalizedDocumentDocxHtml, resolvedDocumentDocxPresentationOwners } from '../src/embedded-render/document-docx-source-colors.js';
const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const descriptor = {headingLevel:1,headingBeforePt:0} as const;
function owned() {
  const ast = {blocks:[{t:'Header',c:[1,['authored-title',[],[]],[{t:'Image',c:[['',[],[]],[],['pixel.png','']]}]]}]};
  const owners = documentDocxPresentationOwners(ast,(_attrs,kind)=>kind==='heading'?descriptor:{});
  return {ast,owners,owner:owners[0]!};
}
it('owns an image-only native heading and changes only its before spacing, not the first native paragraph', () => {
  const {ast,owners,owner} = owned();
  expect(JSON.stringify(ast)).toContain('Image');
  const unrelated = '<w:p><w:pPr><w:spacing w:before="999"/></w:pPr><w:r><w:t>Unrelated</w:t></w:r></w:p>';
  const drawing = '<w:r><w:drawing><graphic xmlns="urn:fixture">Image stays native</graphic></w:drawing></w:r>';
  const target = `<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:keepNext/><w:spacing w:before="360" w:after="240" w:line="750" w:lineRule="atLeast"/></w:pPr><w:bookmarkStart w:id="${owner.id}" w:name="${owner.name}"/>${drawing}<w:bookmarkEnd w:id="${owner.id}"/></w:p>`;
  const later = '<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:spacing w:before="360"/></w:pPr><w:r><w:t>Later heading</w:t></w:r></w:p>';
  const result = projectDocumentDocxPresentation(`<w:document xmlns:w="${ns}"><w:body>${unrelated}${target}${later}</w:body></w:document>`,owners);
  expect(result).toContain(unrelated);
  expect(result).toContain(later);
  expect(result).toContain(drawing);
  expect(result).toContain('w:before="0" w:after="240" w:line="750" w:lineRule="atLeast"');
  expect(result).not.toContain(owner.name);
});
it('refuses wrong AST level, wrong native heading style and crossing native paragraph ownership', () => {
  const {owners,owner} = owned();
  expect(()=>documentDocxPresentationOwners({blocks:[{t:'Header',c:[2,['',[],[]],[]]}]},()=>descriptor)).toThrow('ownership');
  const start = `<w:bookmarkStart w:id="${owner.id}" w:name="${owner.name}"/>`,end=`<w:bookmarkEnd w:id="${owner.id}"/>`;
  for (const body of [
    `<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr>${start}${end}</w:p>`,
    `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>${start}</w:p><w:p>${end}</w:p>`,
    `<w:p><w:pPr><w:pStyle w:val="Heading1"/>${start}${end}</w:pPr></w:p>`,
  ]) expect(()=>projectDocumentDocxPresentation(`<w:document xmlns:w="${ns}"><w:body>${body}</w:body></w:document>`,owners)).toThrow('ownership');
});
it('carries heading IDs through Header AST independently of collapsed whitespace text owners', () => {
  const source = documentDocxSourcePresentation('<html><body><main><h1>  <em>Title</em> </h1><p>Body</p></main></body></html>');
  const heading = source.requests.find(request=>request.kind==='heading')!;
  const resolved = new Map(source.requests.map(request=>[request.id,request.id===heading.id?{headingLevel:1 as const,headingBeforePt:0 as const,headingSource:'canonical-first-block' as const}:{}]));
  const html = normalizedDocumentDocxHtml(source,resolved);
  expect(html).toContain('  <em>Title</em> ');
  const input = {blocks:[{t:'Header',c:[1,['original',[],[[source.attributeName.slice(5),heading.id]]],[{t:'Emph',c:[{t:'Str',c:'Title'}]}]]}]};
  const owners = resolvedDocumentDocxPresentationOwners(input,source,resolved);
  expect(owners).toHaveLength(1);
  expect(owners[0]!.kind).toBe('heading');
  expect(()=>resolvedDocumentDocxPresentationOwners({blocks:[]},source,resolved)).toThrow('ownership');
});
