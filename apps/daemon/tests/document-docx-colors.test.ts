import { expect, it } from 'vitest';
import { documentDocxColorOwners, projectDocumentDocxColors } from '../src/embedded-render/document-docx-colors.js';
const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const ast = () => ({ blocks: [{ t: 'Para', c: [{ t: 'Span', c: [['', [], [['style', 'color:red']]], [{ t: 'Strong', c: [{ t: 'Str', c: 'Bold' }] }, { t: 'Link', c: [['', [], []], [{ t: 'Str', c: 'Link' }], ['https://fixture.test', '']] }]] }] }] });
it('preserves native mixed inline content and applies real foreground/background to hyperlink runs', () => {
  const input = ast(), owners = documentDocxColorOwners(input, () => ({ foreground: '7f1d1d', background: 'fff6aa' }));
  expect(JSON.stringify(input)).toContain('Strong'); expect(JSON.stringify(input)).toContain('https://fixture.test');
  const o = owners[0]!;
  const xml = `<w:document xmlns:w="${ns}" xmlns:r="urn:fixture"><w:body><w:p><w:bookmarkStart w:id="${o.id}" w:name="${o.name}"/><w:r><w:rPr><w:b/></w:rPr><w:t>Bold</w:t></w:r><w:hyperlink r:id="rId1"><w:r><w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr><w:t>Link</w:t></w:r></w:hyperlink><w:bookmarkEnd w:id="${o.id}"/></w:p></w:body></w:document>`;
  const result = projectDocumentDocxColors(xml, owners);
  expect(result.match(/w:color w:val="7F1D1D"/g)).toHaveLength(2);
  expect(result.match(/w:fill="FFF6AA"/g)).toHaveLength(2);
  expect(result).toContain('<w:b/>'); expect(result).toContain('w:rStyle w:val="Hyperlink"'); expect(result).toContain('r:id="rId1"');
  expect(result).not.toContain(o.name); expect(result).not.toContain(o.id);
});
it('rejects missing, duplicate, crossing, collided and changed cell ownership instead of flattening', () => {
  const owners = documentDocxColorOwners(ast(), () => ({ foreground: 'FF0000' })), o = owners[0]!;
  const wrap = (body: string) => `<w:document xmlns:w="${ns}"><w:body>${body}</w:body></w:document>`;
  const start = `<w:bookmarkStart w:id="${o.id}" w:name="${o.name}"/>`, end = `<w:bookmarkEnd w:id="${o.id}"/>`;
  for (const xml of [wrap(''), wrap(start), wrap(start+start+end), wrap(end+start), wrap(start.replace(o.name,'unknown')+end), wrap(`<w:tbl><w:tr><w:tc><w:p>${start}</w:p></w:tc><w:tc><w:p>${end}</w:p></w:tc></w:tr></w:tbl>`)]) expect(() => projectDocumentDocxColors(xml, owners)).toThrow('ownership');
});
it('refuses unnormalized/alpha colors at the resolver boundary', () => {
  for (const color of ['red', '#ffffff', 'FFFFFFFF', 'rgb(1,2,3)', 'rgba(1,2,3,.5)']) expect(() => documentDocxColorOwners(ast(), () => ({ foreground: color }))).toThrow('ownership');
});

it('projects actual pinned converter cells including merge continuations without losing authored empty paragraphs', async () => {
  const { readFile } = await import('node:fs/promises');
  const { DOMParser } = await import('@xmldom/xmldom');
  const fixture = JSON.parse(await readFile(new URL('./fixtures/documents/pandoc-docx-color-owners.json', import.meta.url), 'utf8'));
  // Recorded actual pinned Pandoc JSON→DOCX output, before projection. Native
  // geometry and relationships are not supplied by the implementation helper.
  expect(fixture.xml).not.toContain('<w:shd');
  const result = projectDocumentDocxColors(fixture.xml, fixture.owners);
  const doc = new DOMParser().parseFromString(result, 'application/xml');
  const all = (name: string) => Array.from(doc.getElementsByTagNameNS(ns, name));
  expect(all('tc')).toHaveLength(6);
  expect(all('vMerge').map(node => node.getAttributeNS(ns, 'val'))).toEqual(['restart', 'continue']);
  expect(all('shd').filter(node => node.getAttributeNS(ns,'fill') === '182828')).toHaveLength(2);
  expect(all('color').filter(node => node.getAttributeNS(ns,'val') === '7F1D1D')).toHaveLength(4);
  expect(all('hyperlink')).toHaveLength(1); expect(all('b')).toHaveLength(1);
  for (const cell of all('tc')) {
    const last = Array.from(cell.childNodes).filter(node => node.nodeType === 1).at(-1) as import('@xmldom/xmldom').Element;
    expect(last.localName).toBe('p');
  }
  // One original empty paragraph cell and one originally empty cell both remain
  // legal, non-visible empty paragraphs rather than vanishing cell containers.
  expect(all('tc').filter(cell => !cell.textContent?.trim())).toHaveLength(3);
  expect(result).not.toContain('EveColorFixture_');
  const broken = fixture.xml.replace('w:vMerge w:val="continue"', 'w:vMerge w:val="restart"');
  expect(() => projectDocumentDocxColors(broken,fixture.owners)).toThrow('ownership');
  const unexpectedMerge = fixture.xml.replace('<w:tcPr />','<w:tcPr><w:vMerge w:val="restart"/></w:tcPr>');
  expect(() => projectDocumentDocxColors(unexpectedMerge,fixture.owners)).toThrow('ownership');
});

it('keeps unrelated bookmarks and gives nested authored colors precedence without dropping outer formatting', () => {
  const outer = { id:'2000000000',name:'EveOuter',kind:'inline' as const,presentation:{foreground:'FF0000',background:'FFFF00'} };
  const inner = { id:'2000000001',name:'EveInner',kind:'inline' as const,presentation:{foreground:'0000FF'} };
  const start=(o:typeof outer|typeof inner)=>`<w:bookmarkStart w:id="${o.id}" w:name="${o.name}"/>`;
  const end=(o:typeof outer|typeof inner)=>`<w:bookmarkEnd w:id="${o.id}"/>`;
  const xml=`<w:document xmlns:w="${ns}"><w:body><w:p><w:bookmarkStart w:id="7" w:name="authored-bookmark"/>${start(outer)}<w:r><w:t>outer</w:t></w:r>${start(inner)}<w:r><w:rPr><w:i/></w:rPr><w:t>inner</w:t></w:r>${end(inner)}${end(outer)}<w:bookmarkEnd w:id="7"/></w:p></w:body></w:document>`;
  const result=projectDocumentDocxColors(xml,[outer,inner]);
  expect(result).toContain('w:name="authored-bookmark"');expect(result).toContain('w:bookmarkEnd w:id="7"');
  expect(result).toContain('w:color w:val="0000FF"');expect(result).toContain('w:color w:val="FF0000"');
  expect(result.match(/w:fill="FFFF00"/g)).toHaveLength(2);expect(result).toContain('<w:i/>');
  const crossing=xml.replace(end(inner)+end(outer),end(outer)+end(inner));
  expect(()=>projectDocumentDocxColors(crossing,[outer,inner])).toThrow('ownership');
});

it('places owned properties in the primary OOXML schema order while retaining font, underline, superscript and cell layout', async () => {
  const { readFile } = await import('node:fs/promises');
  const { DOMParser } = await import('@xmldom/xmldom');
  const order = JSON.parse(await readFile(new URL('./fixtures/documents/openxml-color-property-order.json',import.meta.url),'utf8'));
  const cell={id:'2000000000',name:'EveCell',kind:'cell' as const,rowSpan:1,columnSpan:1,presentation:{background:'F2F3F5'}}, ink={id:'2000000001',name:'EveInk',kind:'inline' as const,presentation:{foreground:'7F1D1D',background:'FFF6AA'}};
  const start=(o:typeof cell|typeof ink)=>`<w:bookmarkStart w:id="${o.id}" w:name="${o.name}"/>`,end=(o:typeof cell|typeof ink)=>`<w:bookmarkEnd w:id="${o.id}"/>`;
  const xml=`<w:document xmlns:w="${ns}"><w:body><w:tbl><w:tr><w:tc><w:tcPr><w:tcW w:w="1200" w:type="dxa"/><w:noWrap/><w:tcMar><w:top w:w="80" w:type="dxa"/></w:tcMar><w:vAlign w:val="center"/></w:tcPr><w:p>${start(cell)}${start(ink)}<w:r><w:rPr><w:rFonts w:ascii="Arial"/><w:b/><w:sz w:val="28"/><w:u w:val="single"/><w:vertAlign w:val="superscript"/><w:lang w:val="fr-FR"/></w:rPr><w:t>Styled</w:t></w:r>${end(ink)}${end(cell)}</w:p></w:tc></w:tr></w:tbl></w:body></w:document>`;
  const result=projectDocumentDocxColors(xml,[cell,ink]),doc=new DOMParser().parseFromString(result,'application/xml');
  for (const tag of ['rPr','tcPr']) for(const properties of Array.from(doc.getElementsByTagNameNS(ns,tag))) {
    const ranks=Array.from(properties.childNodes).filter(n=>n.nodeType===1).map(n=>order[tag].indexOf(`w:${(n as import('@xmldom/xmldom').Element).localName}`));
    expect(ranks.every((value,index)=>value>=0 && (index===0||value>ranks[index-1]!))).toBe(true);
  }
  for(const fragment of ['w:ascii="Arial"','w:sz w:val="28"','w:u w:val="single"','w:vertAlign w:val="superscript"','w:lang w:val="fr-FR"','w:top w:w="80"','w:vAlign w:val="center"'])expect(result).toContain(fragment);
});
it('projects nested native font owners without flattening links, formatting or paragraph spacing', () => {
  const input = { blocks: [{ t: 'Para', c: [{ t: 'Span', c: [['outer', [], []], [{ t: 'Str', c: 'A' }, { t: 'Span', c: [['inner', [], []], [{ t: 'Str', c: 'B' }]] }, { t: 'Str', c: 'C' }]] }] }] };
  const owners = documentDocxColorOwners(input, attributes => (attributes as unknown[])[0] === 'outer'
    ? { fontSizePt:30, fontLineHeightPt:45 }
    : { fontSizePt:15, fontLineHeightPt:22.5 });
  const [outer, inner] = owners;
  const start = (owner: typeof outer) => `<w:bookmarkStart w:id="${owner!.id}" w:name="${owner!.name}"/>`;
  const end = (owner: typeof outer) => `<w:bookmarkEnd w:id="${owner!.id}"/>`;
  const xml = `<w:document xmlns:w="${ns}" xmlns:r="urn:fixture"><w:body><w:p><w:pPr><w:spacing w:before="120" w:after="240"/><w:jc w:val="right"/></w:pPr>${start(outer)}<w:r><w:rPr><w:b/><w:u w:val="single"/><w:vertAlign w:val="superscript"/><w:lang w:val="fr-FR"/></w:rPr><w:t>A</w:t></w:r>${start(inner)}<w:hyperlink r:id="existing"><w:r><w:rPr><w:i/></w:rPr><w:t>B</w:t></w:r></w:hyperlink>${end(inner)}<w:r><w:t>C</w:t></w:r>${end(outer)}</w:p></w:body></w:document>`;
  const result = projectDocumentDocxColors(xml, owners);
  expect(result.match(/w:sz w:val="60"/g)).toHaveLength(2);
  expect(result.match(/w:sz w:val="30"/g)).toHaveLength(1);
  expect(result.match(/w:szCs w:val="60"/g)).toHaveLength(2);
  expect(result).toContain('w:before="120" w:after="240" w:line="900" w:lineRule="atLeast"');
  expect(result).toContain('<w:b/><w:sz w:val="60"/><w:szCs w:val="60"/><w:u');
  expect(result).toContain('w:vertAlign w:val="superscript"');
  expect(result).toContain('w:lang w:val="fr-FR"');
  expect(result).toContain('r:id="existing"');
  expect(result).toContain('<w:i/>');
  expect(result).toContain('w:jc w:val="right"');
  expect(result).not.toContain('bookmark');
});
it('refuses malformed, unbounded or incomplete native font descriptors', () => {
  for (const value of [0,NaN,Infinity,2000,'30']) {
    expect(() => documentDocxColorOwners(ast(), () => ({fontSizePt:value,fontLineHeightPt:45} as never))).toThrow('ownership');
  }
  expect(() => documentDocxColorOwners(ast(), () => ({fontSizePt:30}))).toThrow('ownership');
  expect(() => documentDocxColorOwners(ast(), () => ({fontLineHeightPt:45}))).toThrow('ownership');
});
