import { randomBytes } from 'node:crypto';
import { DOMParser, XMLSerializer, type Element, type Node } from '@xmldom/xmldom';

export interface DocumentDocxColors { foreground?: string; background?: string }
export interface DocumentDocxColorOwner { id: string; name: string; kind: 'cell' | 'inline'; rowSpan?: number; columnSpan?: number; temporaryStart?: boolean; temporaryEnd?: boolean; colors: DocumentDocxColors }
type Ast = { t?: string; c?: unknown };
const fail = (): never => { throw new Error('The document converter could not preserve authored color ownership.'); };
const w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
function colors(value: DocumentDocxColors): DocumentDocxColors {
  if (Object.keys(value).some(key => !['foreground', 'background'].includes(key))) return fail();
  for (const color of Object.values(value)) if (!/^[A-Fa-f0-9]{6}$/.test(color)) return fail();
  return value;
}
/** The caller resolves authored CSS to opaque sRGB. This owner does not infer
 * author colors from display contrast or flatten native Pandoc content. */
export function documentDocxColorOwners(ast: unknown, resolve: (attributes: unknown, kind: 'cell' | 'inline') => DocumentDocxColors): DocumentDocxColorOwner[] {
  const owners: DocumentDocxColorOwner[] = [], prefix = `EveClr${randomBytes(8).toString('hex')}`;
  const marker = (owner: DocumentDocxColorOwner, start: boolean) => ({ t: 'RawInline', c: ['openxml', start ? `<w:bookmarkStart w:id="${owner.id}" w:name="${owner.name}"/>` : `<w:bookmarkEnd w:id="${owner.id}"/>`] });
  const owner = (attributes: unknown, kind: 'cell' | 'inline') => {
    const value = colors(resolve(attributes, kind));
    if (!Object.keys(value).length) return undefined;
    if (owners.length >= 10000) return fail();
    const result: DocumentDocxColorOwner = { id: String(2_000_000_000 + owners.length), name: `${prefix}_${owners.length}`, kind, colors: value }; owners.push(result); return result;
  };
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { for (const item of value) visit(item); return; }
    const node = value as Ast;
    if (node.t === 'Span' && Array.isArray(node.c)) {
      const entry = owner(node.c[0], 'inline'); visit(node.c[1]);
      if (entry) { if (!Array.isArray(node.c[1])) return fail(); node.c[1] = [marker(entry, true), ...node.c[1], marker(entry, false)]; }
      return;
    }
    if (node.t === 'Table' && Array.isArray(node.c)) {
      // Pandoc 1.23 Table: head rows, body head/body rows, foot rows. The
      // bounded native cell tuple retains rowspan/colspan and nested blocks.
      const table = node.c as unknown[];
      const groups: unknown[] = [(table[3] as unknown[])?.[1], ...((table[4] as unknown[]) ?? []).flatMap(body => [(body as unknown[])[2], (body as unknown[])[3]]), (table[5] as unknown[])?.[1]];
      for (const rows of groups) {
        if (!Array.isArray(rows)) return fail();
        for (const row of rows) {
          if (!Array.isArray(row) || !Array.isArray(row[1])) return fail();
          for (const cell of row[1]) {
            if (!Array.isArray(cell) || cell.length !== 5 || !Array.isArray(cell[4])) return fail();
            const entry = owner(cell[0], 'cell');
            if (entry) {
              if (!Number.isSafeInteger(cell[2]) || !Number.isSafeInteger(cell[3]) || cell[2] < 1 || cell[3] < 1 || cell[2] > 10000 || cell[3] > 10000) return fail();
              entry.rowSpan = cell[2]; entry.columnSpan = cell[3];
            }
            visit(cell[4]);
            if (entry) {
              const blocks = cell[4] as Ast[], first = blocks[0], last = blocks.at(-1);
              if (first && ['Para','Plain'].includes(first.t ?? '') && Array.isArray(first.c)) first.c.unshift(marker(entry,true));
              else { blocks.unshift({t:'Plain',c:[marker(entry,true)]}); entry.temporaryStart=true; }
              if (last && ['Para','Plain'].includes(last.t ?? '') && Array.isArray(last.c)) last.c.push(marker(entry,false));
              else { blocks.push({t:'Plain',c:[marker(entry,false)]}); entry.temporaryEnd=true; }
            }
          }
        }
      }
      // Caption may itself contain colored spans/tables.
      visit(table[1]); return;
    }
    for (const child of Object.values(value)) visit(child);
  };
  visit(ast); return owners;
}

/** Verify generated bookmarks before projecting into editable native OOXML.
 * Never identify cells/runs by text or positional guesses. */
export function projectDocumentDocxColors(xml: string, owners: readonly DocumentDocxColorOwner[]): string {
  if (!owners.length) return xml;
  const doc = new DOMParser({ onError: fail }).parseFromString(xml, 'application/xml');
  const byId = new Map(owners.map(owner => [owner.id, owner])), names = new Set(owners.map(owner => owner.name));
  if (byId.size !== owners.length || names.size !== owners.length) return fail();
  const stack: DocumentDocxColorOwner[] = [], seen = new Set<string>(), ended = new Set<string>(), markers: Element[] = [], temporary = new Set<Element>(), cells = new Map<string, Element>();
  const parentCell = (node: Node): Element | undefined => { for (let p = node.parentNode; p; p = p.parentNode) if (p.nodeType === 1 && (p as Element).namespaceURI === w && (p as Element).localName === 'tc') return p as Element; return undefined; };
  const children = (node: Element, name: string) => Array.from(node.childNodes).filter((n): n is Element => n.nodeType === 1 && (n as Element).namespaceURI === w && (n as Element).localName === name);
  const properties = (node: Element, name: string) => { const found = children(node, name); if (found.length > 1) return fail(); if (found[0]) return found[0]; const p = doc.createElementNS(w, `w:${name}`); node.insertBefore(p, node.firstChild); return p; };
  const set = (p: Element, name: string, attributes: Record<string, string>) => { for (const old of children(p, name)) p.removeChild(old); const item = doc.createElementNS(w, `w:${name}`); for (const [key, value] of Object.entries(attributes)) item.setAttributeNS(w, `w:${key}`, value); p.appendChild(item); };
  const visit = (node: Node): void => {
    if (node.nodeType !== 1) return;
    const element = node as Element, name = element.namespaceURI === w ? element.localName : '';
    if (name === 'bookmarkStart' || name === 'bookmarkEnd') {
      const id = element.getAttributeNS(w, 'id')!, own = byId.get(id);
      if (!own && names.has(element.getAttributeNS(w, 'name') ?? '')) return fail();
      if (own) {
        if (name === 'bookmarkStart') {
          if (seen.has(id) || element.getAttributeNS(w, 'name') !== own.name) return fail();
          seen.add(id); stack.push(own);
          const cell = parentCell(element); if (cell) cells.set(id, cell); else if (own.kind === 'cell') return fail();
          if (own.kind === 'cell' && own.colors.background) {
            const row = cell!.parentNode as Element, table = row.parentNode as Element;
            if (row.localName !== 'tr' || table.localName !== 'tbl') return fail();
            const span = (tc: Element) => { const raw = children(tc, 'tcPr')[0]; const value = raw && children(raw, 'gridSpan')[0]?.getAttributeNS(w, 'val'); const count = value ? Number(value) : 1; if (!Number.isSafeInteger(count) || count < 1) return fail(); return count; };
            const rowCells = children(row, 'tc'), index = rowCells.indexOf(cell!);
            if (index < 0 || span(cell!) !== own.columnSpan) return fail();
            const column = rowCells.slice(0,index).reduce((sum,tc) => sum + span(tc),0);
            const rows = children(table, 'tr'), rowIndex = rows.indexOf(row);
            for (let offset=0; offset < (own.rowSpan ?? 1); offset++) {
              const targetRow = rows[rowIndex+offset]; if (!targetRow) return fail();
              let current=0; const target = children(targetRow,'tc').find(tc => { const found=current===column; current+=span(tc); return found; });
              if (!target || span(target)!==own.columnSpan) return fail();
              const merge = children(target,'tcPr')[0]; const marker = merge && children(merge,'vMerge')[0];
              if ((own.rowSpan ?? 1)>1 && (!marker || (offset===0 ? marker.getAttributeNS(w,'val')!=='restart' : !['','continue'].includes(marker.getAttributeNS(w,'val') ?? '')))) return fail();
              set(properties(target,'tcPr'),'shd',{val:'clear',color:'auto',fill:own.colors.background.toUpperCase()});
            }
          }
        } else {
          if (stack.at(-1)?.id !== id || ended.has(id) || cells.get(id) !== parentCell(element)) return fail();
          stack.pop(); ended.add(id);
        }
        markers.push(element);
        if (own.kind === 'cell' && (name === 'bookmarkStart' ? own.temporaryStart : own.temporaryEnd)) {
          if (element.parentNode?.nodeType !== 1 || (element.parentNode as Element).namespaceURI !== w || (element.parentNode as Element).localName !== 'p') return fail();
          temporary.add(element.parentNode as Element);
        }
      }
    }
    if (name === 'r') {
      const effective: DocumentDocxColors = {};
      for (const own of stack) { if (own.colors.foreground) effective.foreground = own.colors.foreground; if (own.kind === 'inline' && own.colors.background) effective.background = own.colors.background; }
      if (effective.foreground) set(properties(element, 'rPr'), 'color', { val: effective.foreground.toUpperCase() });
      if (effective.background) set(properties(element, 'rPr'), 'shd', { val: 'clear', color: 'auto', fill: effective.background.toUpperCase() });
    }
    for (const child of Array.from(element.childNodes)) visit(child);
  };
  if (!doc.documentElement) return fail(); visit(doc.documentElement);
  if (stack.length || seen.size !== owners.length || ended.size !== owners.length) return fail();
  for (const marker of markers) marker.parentNode?.removeChild(marker);
  for (const paragraph of temporary) {
    // Only our marker-only paragraphs can disappear; real empty authored
    // paragraphs, paragraph properties and cell contents remain untouched.
    if (Array.from(paragraph.childNodes).some(node => node.nodeType === 1 && (node as Element).localName !== 'pPr' || node.nodeType === 3 && Boolean(node.textContent?.trim()))) return fail();
    paragraph.parentNode?.removeChild(paragraph);
  }
  // Word requires a terminal paragraph even after a nested table or for an
  // empty cell. Do not remove/recreate any existing authored empty paragraph.
  for (const cell of new Set(cells.values())) {
    const elements=Array.from(cell.childNodes).filter((n): n is Element => n.nodeType===1);
    if (elements.at(-1)?.namespaceURI !== w || elements.at(-1)?.localName !== 'p') cell.appendChild(doc.createElementNS(w,'w:p'));
  }
  return new XMLSerializer().serializeToString(doc);
}
