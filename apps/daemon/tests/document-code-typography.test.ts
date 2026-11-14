import { expect, it } from 'vitest';
import { load } from 'cheerio';
import { documentDocxSourcePresentation, normalizedDocumentDocxHtml, resolvedDocumentDocxPresentationOwners } from '../src/embedded-render/document-docx-source-colors.js';

it.each(['<p>Body <code>inline</code>.</p><pre><code>block\n  indent</code></pre>', '<p>Body <code style="font-size:16pt">inline</code>.</p><pre><code>block\n  indent</code></pre>'])('owns code context on the source code elements, not disposable inner wrappers: %s', body => {
  const source = documentDocxSourcePresentation(body);
  const $ = load(source.html);
  expect($('code').first().attr(source.attributeName)).toBeDefined();
  expect($('pre').attr(source.attributeName)).toBeDefined();
  expect($('pre').text()).toBe('block\n  indent');
});

it('retains native CodeBlock semantics under an exact generated size owner', () => {
  const source = documentDocxSourcePresentation('<pre><code>block\n  indent</code></pre>');
  const $ = load(source.html);
  const id = $('pre').attr(source.attributeName)!;
  const resolved = new Map(source.requests.map(request => [request.id, request.id === id ? {fontSizePt:10.5,fontLineHeightPt:15.75,fontSizeSource:'code-context' as never} : {}]));
  const html = normalizedDocumentDocxHtml(source, resolved);
  expect(load(html)('pre').text()).toBe('block\n  indent');
  const block = {t:'CodeBlock',c:[['', ['javascript'], [[source.attributeName.slice(5),id]]], 'block\n  indent']};
  const ast = {blocks:[block]};
  const owners = resolvedDocumentDocxPresentationOwners(ast,source,resolved);
  expect(owners).toHaveLength(1);
  expect(JSON.stringify(ast)).toContain('CodeBlock');
  expect(JSON.stringify(ast)).toContain('javascript');
  expect(JSON.stringify(ast)).toContain('bookmarkStart');
  expect(JSON.stringify(ast)).not.toContain(source.attributeName.slice(5));
});

it('rejects code-context size provenance on an ordinary text wrapper', () => {
  const source = documentDocxSourcePresentation('<p>Text</p>');
  const id = source.requests[0]!.id;
  const resolved = new Map([[id,{fontSizePt:15,fontLineHeightPt:22.5,fontSizeSource:'code-context' as const}]]);
  expect(() => normalizedDocumentDocxHtml(source,resolved)).toThrow('ownership');
});

it('normalizes regenerated plain PRE text without dropping rich-code styling', () => {
  for (const rich of [false,true]) {
    const source = documentDocxSourcePresentation(`<pre><span style="${rich ? 'color:red' : 'white-space:pre-wrap'}">line</span><br>  next</pre>`);
    const resolved = new Map(source.requests.map(request => [request.id, {}]));
    const html = load(normalizedDocumentDocxHtml(source,resolved));
    expect(html('pre').text()).toBe(rich ? 'line  next' : 'line\n  next');
    expect(html('pre>code')).toHaveLength(rich ? 0 : 1);
    if (rich) expect(html('span[style]').attr('style')).toBe('color:red');
  }
});

it('projects only the owned editable code runs and retains native style, breaks and unrelated links', async () => {
  const {documentDocxPresentationOwners,projectDocumentDocxPresentation} = await import('../src/embedded-render/document-docx-colors.js');
  const ast = {blocks:[{t:'CodeBlock',c:[['original',['javascript'],[]],'line\n  next']}]};
  const owners = documentDocxPresentationOwners(ast, () => ({fontSizePt:10.5,fontLineHeightPt:15.75,foreground:'FF0000'}));
  const owner = owners[0]!;
  const w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const xml = `<w:document xmlns:w="${w}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:bookmarkStart w:id="${owner.id}" w:name="${owner.name}"/><w:p><w:pPr><w:pStyle w:val="SourceCode"/></w:pPr><w:r><w:rPr><w:rStyle w:val="VerbatimChar"/></w:rPr><w:t xml:space="preserve">line</w:t></w:r><w:r><w:br/></w:r><w:r><w:t xml:space="preserve">  next</w:t></w:r></w:p><w:bookmarkEnd w:id="${owner.id}"/><w:p><w:hyperlink r:id="rId9"><w:r><w:rPr><w:b/></w:rPr><w:t>Link</w:t></w:r></w:hyperlink></w:p></w:body></w:document>`;
  const result = projectDocumentDocxPresentation(xml,owners);
  expect(result).toContain('w:val="21"');
  expect(result).toContain('w:val="FF0000"');
  expect(result).not.toContain('w:shd');
  expect(result).toContain('w:val="SourceCode"');
  expect(result).toContain('w:val="VerbatimChar"');
  expect(result).toContain('<w:br/>');
  expect(result).toContain('xml:space="preserve">  next');
  expect(result).toContain('<w:hyperlink r:id="rId9"><w:r><w:rPr><w:b/></w:rPr><w:t>Link</w:t></w:r></w:hyperlink>');
  expect(result).not.toContain(owner.name);
  expect(() => projectDocumentDocxPresentation(xml.replace(`<w:bookmarkEnd w:id="${owner.id}"/>`,''),owners)).toThrow('ownership');
});

it('refuses code-context identity retained on an ordinary Span instead of native code', () => {
  const source = documentDocxSourcePresentation('<code>Code</code>');
  const id = source.requests[0]!.id;
  const resolved = new Map([[id,{fontSizePt:15,fontLineHeightPt:22.5,fontSizeSource:'code-context' as const}]]);
  const ast = {blocks:[{t:'Para',c:[{t:'Span',c:[['',[],[[source.attributeName.slice(5),id]]],[{t:'Str',c:'Code'}]]}]}]};
  expect(() => resolvedDocumentDocxPresentationOwners(ast,source,resolved)).toThrow('ownership');
});
