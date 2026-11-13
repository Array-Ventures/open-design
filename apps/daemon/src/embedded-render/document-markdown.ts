import { load } from 'cheerio';
import { randomUUID } from 'node:crypto';

/** Export-only normalization; the conditional source remains untouched. */
export function documentMarkdownHtml(html: string): string {
  const $ = load(html);
  if ($('html').attr('data-eve-document') !== '1') return html;
  $('span').each((_index, node) => {
    const span = $(node);
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
export function documentMarkdownInput(html: string): { html: string; rawSpans: Map<string, string> } {
  const normalized = documentMarkdownHtml(html), $ = load(normalized), rawSpans = new Map<string, string>();
  if ($('html').attr('data-eve-document') !== '1') return { html, rawSpans };
  const protectedNodes = new Set<object>();
  $('span').each((_index, node) => {
    if (!Object.keys(node.attribs).length || $(node).parents('span').toArray().some(parent => protectedNodes.has(parent))) return;
    const id = `eve-document-${randomUUID()}`;
    rawSpans.set(id, $.html(node)); protectedNodes.add(node); $(node).attr('id', id);
  });
  return { html: $.html(), rawSpans };
}

export function restoreDocumentMarkdownSpans(ast: unknown, rawSpans: ReadonlyMap<string, string>): unknown {
  const pending: unknown[] = [ast], restored = new Set<string>();
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== 'object') continue;
    if (Array.isArray(value)) { for (const item of value) pending.push(item); continue; }
    const node = value as Record<string, unknown>, content = node.c;
    const id = node.t === 'Span' && Array.isArray(content) && Array.isArray(content[0]) ? content[0][0] : undefined;
    if (typeof id === 'string' && rawSpans.has(id)) {
      if (restored.has(id)) throw new Error('The document converter duplicated a styled text owner.');
      node.t = 'RawInline'; node.c = ['html', rawSpans.get(id)!]; restored.add(id);
    } else pending.push(...Object.values(node));
  }
  if (restored.size !== rawSpans.size) throw new Error('The document converter could not preserve styled text.');
  return ast;
}
