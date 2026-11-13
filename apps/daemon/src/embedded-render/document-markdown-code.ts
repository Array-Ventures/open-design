import type { CheerioAPI } from 'cheerio';

const defaultWrap = /^\s*white-space\s*:\s*pre-wrap\s*;?\s*$/i;
const languageName = /^[A-Za-z0-9_+-]{1,50}$/;
// The maintained Next/Turbopack module class is verified against the owned
// companion fixture. Unknown classes retain their complete HTML owner.
const generatedCodeClass = /^DocumentEditor-module__[A-Za-z0-9_-]+__code$/;

/** Only regenerated Lexical text wrappers may disappear inside code. */
function codeText($: CheerioAPI, element: ReturnType<CheerioAPI>): string | null {
  let result = '';
  for (const node of element.contents().toArray()) {
    if (node.type === 'text') { result += node.data; continue; }
    if (node.type !== 'tag') return null;
    if (node.name === 'br' && !Object.keys(node.attribs).length) { result += '\n'; continue; }
    if (node.name !== 'span' || Object.keys(node.attribs).length !== 1 || !defaultWrap.test(node.attribs.style ?? '')) return null;
    const nested = codeText($, $(node)); if (nested === null) return null; result += nested;
  }
  return result;
}

/** Native Pandoc code blocks need PRE/CODE, not PRE/Span. Never infer away
 * custom styling: unsupported shapes remain whole RawBlock owners. */
export function normalizeDocumentCode($: CheerioAPI): Set<object> {
  const native = new Set<object>();
  $('pre').each((_index, node) => {
    const pre = $(node), attributes = node.attribs;
    if (Object.keys(attributes).some(name => !['class', 'spellcheck', 'data-language', 'data-highlight-language', 'data-od-id'].includes(name))) return;
    if (attributes.class !== undefined && !generatedCodeClass.test(attributes.class)) return;
    if (attributes.spellcheck !== undefined && attributes.spellcheck !== 'false') return;
    if (attributes['data-od-id'] !== undefined && !/^[A-Za-z0-9_-]{1,100}$/.test(attributes['data-od-id'])) return;
    let language = attributes['data-language'];
    if (language !== undefined && !languageName.test(language)) return;
    if (attributes['data-highlight-language'] !== undefined && attributes['data-highlight-language'] !== language) return;
    let content = pre;
    const children = pre.contents().toArray();
    if (children.length === 1 && children[0]?.type === 'tag' && children[0].name === 'code') {
      const child = children[0], codeLanguage = child.attribs.class?.match(/^language-([A-Za-z0-9_+-]{1,50})$/)?.[1];
      if (Object.keys(child.attribs).some(name => name !== 'class') || child.attribs.class !== undefined && !codeLanguage || language && codeLanguage && language !== codeLanguage) return;
      language ??= codeLanguage; content = $(child);
    }
    const text = codeText($, content); if (text === null) return;
    for (const name of Object.keys(attributes)) pre.removeAttr(name);
    const code = $('<code></code>').text(text); if (language) code.attr('class', `language-${language}`);
    pre.empty().append(code); native.add(node);
  });
  return native;
}
