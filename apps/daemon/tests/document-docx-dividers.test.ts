import { expect, it } from 'vitest';
import { documentDocxSourceColors } from '../src/embedded-render/document-docx-source-colors.js';
import { documentDocxDividers, projectDocumentDocxDividers } from '../src/embedded-render/document-docx-dividers.js';
import { documentMarkdownInput, restoreDocumentMarkdownOwners } from '../src/embedded-render/document-markdown.js';

function fixture() {
  const html = '<html data-eve-document="1"><body><p>Before</p><hr data-od-id="authored" style="width:40%;color:#ff0000;background-color:#00ff00"><p>After</p></body></html>';
  const source = documentDocxSourceColors(html);
  const request = source.requests.find(request => request.kind === 'divider')!;
  const normalized = new Map([[request.id, { foreground: 'FF0000', background: '00FF00' }]]);
  const result = documentDocxDividers(source.html, source, normalized);
  const name = result.owners[0]!.name;
  const xml = `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"><w:body><w:bookmarkStart w:id="9" w:name="${name}"/><w:p><w:r><w:pict><v:rect style="width:0;height:1.5pt" o:hr="t" o:hrstd="t"/></w:pict></w:r></w:p><w:bookmarkEnd w:id="9"/></w:body></w:document>`;
  return { result, xml };
}
it('projects only the exact generated native rule and retains the authored source ID', () => {
  const { result, xml } = fixture();
  expect(result.html).toContain('data-od-id="authored"');
  const projected = projectDocumentDocxDividers(xml, result.owners);
  expect(projected).toContain('o:hrpct="400"');
  expect(projected).toContain('w:jc w:val="center"');
  expect(projected).toContain('height:0pt');
  expect(projected).toContain('strokeweight="0.75pt"');
  expect(projected).toContain('fillcolor="#00FF00"');
  expect(projected).toContain('strokecolor="#FF0000"');
  expect(projected).not.toContain('bookmark');
});
it('refuses missing, duplicate, crossing and text-contaminated native owners', () => {
  const { result, xml } = fixture();
  const invalid = [
    xml.replace('w:bookmarkEnd', 'w:notAnEnd'),
    xml.replace('</w:body>', '<w:bookmarkEnd w:id="9"/></w:body>'),
    xml.replace('<w:r>', '<w:r><w:t>Unrelated</w:t>'),
    xml.replace('<w:p><w:r>', '<w:p><w:p/><w:r>'),
    xml.replace('o:hr="t"', 'o:hr="f"'),
  ];
  for (const value of invalid) expect(() => projectDocumentDocxDividers(value, result.owners)).toThrow();
});
it('retains styled rules as raw Markdown blocks and refuses a lost owner', () => {
  const input = documentMarkdownInput('<html data-eve-document="1"><body><hr style="width:40%;color:red"></body></html>');
  const [id, html] = [...input.rawBlocks][0]!;
  expect(html).toContain('width:40%');
  const ast = { blocks: [{ t: 'Div', c: [[id, [], []], [{ t: 'HorizontalRule' }]] }] };
  const restored = restoreDocumentMarkdownOwners(ast, input.rawSpans, input.rawBlocks);
  expect(restored).toEqual({ blocks: [{ t: 'RawBlock', c: ['html', html] }] });
  expect(() => restoreDocumentMarkdownOwners({ blocks: [] }, input.rawSpans, input.rawBlocks)).toThrow();
});

it('refuses non-representable fractional percentage precision and missing normalization', () => {
  const source = documentDocxSourceColors('<html><body><hr style="width:40.123%"></body></html>');
  const id = source.requests.find(request => request.kind === 'divider')!.id;
  expect(() => documentDocxDividers(source.html, source, new Map([[id, {}]]))).toThrow();
  expect(() => documentDocxDividers(source.html, source, new Map())).toThrow();
});
