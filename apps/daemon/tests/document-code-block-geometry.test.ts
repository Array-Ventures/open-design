import { expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { documentDocxPresentationOwners, projectDocumentDocxPresentation } from '../src/embedded-render/document-docx-colors.js';

const word = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const font = {fontSizePt:10.5,fontLineHeightPt:15.75};
const geometry = {codeBlockSource:'canonical-pre' as const,codeBlockBeforePt:27,codeBlockAfterPt:22.5,codeBlockStartPt:12,codeBlockEndPt:12,codeBlockLineCount:2};
function fixture() {
  const ast = {blocks:[{t:'CodeBlock',c:[['',[],[]],'line\n  next']}]};
  const owners = documentDocxPresentationOwners(ast, () => ({...font,...geometry}));
  const owner = owners[0]!;
  const start = `<w:bookmarkStart w:id="${owner.id}" w:name="${owner.name}"/>`;
  const end = `<w:bookmarkEnd w:id="${owner.id}"/>`;
  const paragraph = '<w:p><w:pPr><w:pStyle w:val="SourceCode"/><w:keepNext/><w:wordWrap w:val="off"/><w:jc w:val="left"/></w:pPr><w:r><w:rPr><w:rStyle w:val="VerbatimChar"/></w:rPr><w:t>line</w:t></w:r><w:r><w:br/></w:r><w:r><w:t xml:space="preserve">  next</w:t></w:r></w:p>';
  const wrap = (content:string) => `<w:document xmlns:w="${word}"><w:body>${content}</w:body></w:document>`;
  return {owners,start,end,paragraph,wrap};
}
it('projects measured canonical code padding and collapsed margins only into its owned native paragraph', () => {
  const f = fixture();
  const xml = projectDocumentDocxPresentation(f.wrap(f.start+f.paragraph+f.end),f.owners);
  const doc = new DOMParser().parseFromString(xml,'application/xml');
  const spacing = doc.getElementsByTagNameNS(word,'spacing')[0]!;
  expect(spacing.getAttributeNS(word,'before')).toBe('540');
  expect(spacing.getAttributeNS(word,'after')).toBe('450');
  expect(spacing.getAttributeNS(word,'line')).toBe('315');
  const indent = doc.getElementsByTagNameNS(word,'ind')[0]!;
  expect(indent.getAttributeNS(word,'left')).toBe('240');
  expect(indent.getAttributeNS(word,'right')).toBe('240');
  expect(xml).toContain('w:val="SourceCode"'); expect(xml).toContain('w:val="VerbatimChar"');
  expect(xml).toContain('<w:keepNext/>'); expect(xml).toContain('<w:jc w:val="left"/>');
  expect(xml).toContain('xml:space="preserve">  next'); expect(xml).not.toContain(f.owners[0]!.name);
  const properties = doc.getElementsByTagNameNS(word,'pPr')[0]!;
  const names = Array.from(properties.childNodes).filter(node=>node.nodeType===1).map(node=>'localName' in node ? node.localName : undefined);
  expect(names.indexOf('spacing')).toBeLessThan(names.indexOf('ind'));
  expect(names.indexOf('ind')).toBeLessThan(names.indexOf('jc'));
});
it.each(['before','after','empty','two','wrong-style','line-count'] as const)('refuses %s native paragraph ownership instead of rewriting a nearby code block', problem => {
  const f = fixture();
  const body = problem==='before' ? f.paragraph+f.start+f.end
    : problem==='after' ? f.start+f.end+f.paragraph
    : problem==='empty' ? f.start+f.end
    : problem==='two' ? f.start+f.paragraph+f.paragraph+f.end
    : f.start+f.paragraph.replace(problem==='wrong-style'?'SourceCode':'<w:br/>',problem==='wrong-style'?'BodyText':'')+f.end;
  expect(() => projectDocumentDocxPresentation(f.wrap(body),f.owners)).toThrow('ownership');
});

it.each(['indent','alignment','contextual'] as const)('refuses conflicting native %s geometry while preserving unrelated properties',conflict=>{
  const f=fixture();
  const property=conflict==='indent'?'<w:ind w:firstLine="120"/>' :conflict==='alignment'?'<w:jc w:val="center"/>':'<w:contextualSpacing/>';
  const paragraph=f.paragraph.replace('<w:jc w:val="left"/>',property);
  expect(()=>projectDocumentDocxPresentation(f.wrap(f.start+paragraph+f.end),f.owners)).toThrow('ownership');
});

it('retains unrelated existing bookmarks and refuses copied non-code owner kinds or partial geometry',()=>{
  const f=fixture();
  const unrelated='<w:bookmarkStart w:id="77" w:name="authored"/><w:bookmarkEnd w:id="77"/>';
  expect(projectDocumentDocxPresentation(f.wrap(unrelated+f.start+f.paragraph+f.end),f.owners)).toContain(unrelated);
  const span={blocks:[{t:'Para',c:[{t:'Span',c:[['',[],[]],[{t:'Str',c:'text'}]]}]}]};
  expect(()=>documentDocxPresentationOwners(span,()=>({...font,...geometry}))).toThrow('ownership');
  expect(()=>documentDocxPresentationOwners({blocks:[{t:'CodeBlock',c:[['',[],[]],'text']}]},()=>({...font,codeBlockBeforePt:27}))).toThrow('ownership');
});

it.each(['page-break','foreign-math','drawing'] as const)('refuses non-source native %s content within an otherwise matching owned range',variant=>{
  const f=fixture();
  const paragraph=variant==='page-break'?f.paragraph.replace('<w:br/>','<w:br w:type="page"/>')
    :f.paragraph.replace('</w:p>',variant==='foreign-math'?'<m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"/></w:p>':'<w:r><w:drawing/></w:r></w:p>');
  expect(()=>projectDocumentDocxPresentation(f.wrap(f.start+paragraph+f.end),f.owners)).toThrow('ownership');
});

it('preserves the actual pinned converter soft-hyphen run instead of rejecting ordinary code text',()=>{
  const ast={blocks:[{t:'CodeBlock',c:[['',[],[]],'soft\u00adhyphen']}]};
  const owners=documentDocxPresentationOwners(ast,()=>({...font,...geometry,codeBlockLineCount:1}));
  const own=owners[0]!;
  // The pinned converter represents U+00AD as a native softHyphen element;
  // U+2011 remains literal text. This validates content without flattening it.
  const xml=`<w:document xmlns:w="${word}"><w:body><w:bookmarkStart w:id="${own.id}" w:name="${own.name}"/><w:p><w:pPr><w:pStyle w:val="SourceCode"/></w:pPr><w:r><w:t>soft</w:t></w:r><w:r><w:softHyphen/></w:r><w:r><w:t>hyphen</w:t></w:r></w:p><w:bookmarkEnd w:id="${own.id}"/></w:body></w:document>`;
  expect(projectDocumentDocxPresentation(xml,owners)).toContain('<w:softHyphen/>');
});
