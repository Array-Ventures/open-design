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
});
