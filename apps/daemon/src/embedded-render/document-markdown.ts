import { load } from 'cheerio';
import { normalizeDocumentCode } from './document-markdown-code.js';
import { randomUUID } from 'node:crypto';

/** Export-only normalization; the conditional source remains untouched. */
export function documentMarkdownHtml(html: string): string {
  const $ = load(html);
  if ($('html').attr('data-eve-document') !== '1') return html;
  normalizeDocumentCode($);
  $('span').each((_index, node) => {
    const span = $(node);
    if (span.parents('pre,code').length) return;
    if (Object.keys(node.attribs).length !== 1 || !/^\s*white-space\s*:\s*pre-wrap\s*;?\s*$/i.test(span.attr('style') ?? '')) return;
    // Raw HTML remains necessary when collapsing whitespace would change text.
    if (/[\t\r\n]| {2}|^\s|\s$/.test(span.text())) return;
    span.replaceWith(span.contents());
  });
  $('table').each((_index, node) => {
    const table = $(node);
    if (table.find('table').length || table.children('thead,tfoot').length) return;
    const rows = table.children('tbody').children('tr').add(table.children('tr'));
    const first = rows.first(), cells = first.children('th,td');
    if (!cells.length || cells.filter('th').length !== cells.length) return;
    // Merged/ragged structures retain their existing HTML representation.
    if (rows.toArray().some(row => $(row).children('th,td').length !== cells.length)) return;
    if (rows.find('th,td').toArray().some(cell => ['rowspan', 'colspan'].some(name => $(cell).attr(name) !== undefined && $(cell).attr(name) !== '1'))) return;
    const head = $('<thead></thead>'); head.append(first);
    const before = table.children('colgroup,caption').last();
    if (before.length) head.insertAfter(before); else table.prepend(head);
  });
  return $.html();
}

/** Pandoc's HTML reader collapses text whitespace even inside styled spans.
 * Preserve those owned source fragments as native RawInline AST nodes instead. */
export function documentMarkdownInput(html: string): { html: string; rawSpans: Map<string, string>; rawBlocks: Map<string, string> } {
  const normalized = documentMarkdownHtml(html), $ = load(normalized), rawSpans = new Map<string, string>(), rawBlocks = new Map<string, string>();
  if ($('html').attr('data-eve-document') !== '1') return { html, rawSpans, rawBlocks };
  const nativeCode = normalizeDocumentCode($), protectedNodes = new Set<object>();
  const owner = (html: string, block: boolean) => {
    const id = `eve-document-${randomUUID()}`;
    if (rawSpans.has(id) || rawBlocks.has(id)) throw new Error('The document duplicated a generated HTML owner.');
    (block ? rawBlocks : rawSpans).set(id, html);
    const wrapper = $(block ? '<div></div>' : '<span></span>').attr('id', id);
    protectedNodes.add(wrapper.get(0)!); return wrapper;
  };
  $('pre').each((_index, node) => {
    const pre = $(node);
    if (nativeCode.has(node)) return;
    const wrapper = owner($.html(node), true); pre.replaceWith(wrapper); wrapper.append(node);
  });
  $('span').each((_index, node) => {
    if (protectedNodes.has(node) || !Object.keys(node.attribs).length || $(node).parents('span,div').toArray().some(parent => protectedNodes.has(parent)) || $(node).parents('pre,code').length) return;
    const id = `eve-document-${randomUUID()}`;
    if (rawSpans.has(id) || rawBlocks.has(id)) throw new Error('The document duplicated a generated HTML owner.');
    rawSpans.set(id, $.html(node)); protectedNodes.add(node); $(node).attr('id', id);
  });
  $('code').each((_index, node) => {
    if ($(node).parents('pre').length || $(node).parents('span,div').toArray().some(parent => protectedNodes.has(parent))) return;
    const wrapper = owner($.html(node), false); $(node).replaceWith(wrapper); wrapper.append(node);
  });
  return { html: $.html(), rawSpans, rawBlocks };
}

export function restoreDocumentMarkdownOwners(ast: unknown, rawSpans: ReadonlyMap<string, string>, rawBlocks: ReadonlyMap<string, string> = new Map()): unknown {
  if ([...rawSpans.keys()].some(id => rawBlocks.has(id))) throw new Error('The document duplicated an HTML owner identity.');
  const pending: unknown[] = [ast], restored = new Set<string>();
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== 'object') continue;
    if (Array.isArray(value)) { for (const item of value) pending.push(item); continue; }
    const node = value as Record<string, unknown>, content = node.c;
    const owners = node.t === 'Span' ? rawSpans : node.t === 'Div' ? rawBlocks : null;
    const id = owners && Array.isArray(content) && Array.isArray(content[0]) ? content[0][0] : undefined;
    if (typeof id === 'string' && owners?.has(id)) {
      if (restored.has(id)) throw new Error('The document converter duplicated a styled text owner.');
      node.t = node.t === 'Div' ? 'RawBlock' : 'RawInline'; node.c = ['html', owners.get(id)!]; restored.add(id);
    } else pending.push(...Object.values(node));
  }
  if (restored.size !== rawSpans.size + rawBlocks.size) throw new Error('The document converter could not preserve styled text.');
  return ast;
}
