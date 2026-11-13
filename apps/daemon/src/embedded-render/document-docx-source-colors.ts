import { randomBytes } from 'node:crypto';
import { load } from 'cheerio';
import { documentDocxColorOwners, type DocumentDocxColors } from './document-docx-colors.js';

export interface DocumentDocxColorRequest { id: string; kind: 'cell' | 'inline' }
export interface DocumentDocxColorSource { html: string; attributeName: string; requests: DocumentDocxColorRequest[] }
const fail = (): never => { throw new Error('The document converter could not preserve normalized color ownership.'); };

/** Temporary conversion-only data attributes preserve all authored IDs. Neutral
 * text wrappers allow the contained DOM adapter to resolve inherited ink and
 * actual nested backgrounds without reproducing CSS ownership rules here. */
export function documentDocxSourceColors(html: string): DocumentDocxColorSource {
  const $ = load(html), requests: DocumentDocxColorRequest[] = [];
  let attributeName: string;
  do { attributeName = `data-eve-docx-color-${randomBytes(8).toString('hex')}`; }
  while ($(`[${attributeName}],[${attributeName.slice(5)}]`).length);
  const add = (kind: 'cell' | 'inline') => { if (requests.length >= 20000) return fail(); const id = String(requests.length); requests.push({ id, kind }); return id; };
  $('td,th').each((_index, cell) => { $(cell).attr(attributeName, add('cell')); });
  // Snapshot direct TextNodes before adding wrappers; never walk newly wrapped
  // children a second time or reinterpret source IDs as generated ownership.
  const text = $('body,body *').contents().toArray().filter(node => node.type === 'text' && Boolean(node.data.trim()));
  for (const node of text) {
    if ($(node).parents('script,style').length) continue;
    $(node).wrap(`<span ${attributeName}="${add('inline')}"></span>`);
  }
  return { html: $.html(), attributeName, requests };
}

/** Pandoc strips the HTML data- prefix. Remove only our generated attribute
 * before native conversion, and fail if any normalized colored owner vanished
 * (for example an unsupported code importer) rather than dropping its color. */
export function resolvedDocumentDocxColorOwners(ast: unknown, source: DocumentDocxColorSource, resolved: ReadonlyMap<string, DocumentDocxColors>) {
  const expected = new Map(source.requests.map(request => [request.id, request.kind])), seen = new Set<string>(), key = source.attributeName.slice(5);
  if (resolved.size !== expected.size || [...resolved.keys()].some(id => !expected.has(id))) return fail();
  const owners = documentDocxColorOwners(ast, (raw, kind) => {
    if (!Array.isArray(raw) || raw.length !== 3 || !Array.isArray(raw[2])) return fail();
    const attributes = raw[2] as unknown[], own = attributes.filter(pair => Array.isArray(pair) && pair[0] === key);
    if (!own.length) return {};
    if (own.length !== 1 || !Array.isArray(own[0]) || typeof own[0][1] !== 'string') return fail();
    const id = own[0][1]; if (expected.get(id) !== kind || seen.has(id)) return fail();
    seen.add(id); raw[2] = attributes.filter(pair => pair !== own[0]);
    const value = resolved.get(id) ?? fail();
    const { foreground, background } = value;
    return { ...(foreground ? {foreground} : {}), ...(background ? {background} : {}) };
  });
  for (const [id, value] of resolved) if (Object.keys(value).length && !seen.has(id)) return fail();
  return owners;
}
