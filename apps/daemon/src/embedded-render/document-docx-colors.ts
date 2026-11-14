import { documentSimplePicture } from './document-picture.js';
import { documentWordFontSize, validDocumentFontSize, validDocumentFontLineHeight, validDocumentHeadingLevel, validDocumentHeadingImage } from '@open-design/document-style';
import { randomBytes } from 'node:crypto';
import { DOMParser, XMLSerializer, type Element, type Node } from '@xmldom/xmldom';

export interface DocumentDocxPresentation { foreground?: string; background?: string; fontSizePt?: number; fontLineHeightPt?: number; headingLevel?: number; headingBeforePt?: 0; headingImageLineHeightPt?: number; headingImageWidthPt?: number; headingImageHeightPt?: number; headingImageSource?: 'single-baseline-image' }
export type DocumentDocxColors = DocumentDocxPresentation;
export interface DocumentDocxStyleOwner { imageAssetSha256?: string; id: string; name: string; kind: 'cell' | 'inline' | 'heading'; rowSpan?: number; columnSpan?: number; temporaryStart?: boolean; temporaryEnd?: boolean; presentation: DocumentDocxPresentation }
type Ast = { t?: string; c?: unknown };
const fail = (): never => { throw new Error('The document converter could not preserve authored presentation ownership.'); };
const w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
function checkedPresentation(value: DocumentDocxPresentation): DocumentDocxPresentation {
  if (Object.keys(value).some(key => !['foreground', 'background', 'fontSizePt', 'fontLineHeightPt', 'headingLevel', 'headingBeforePt','headingImageLineHeightPt','headingImageWidthPt','headingImageHeightPt','headingImageSource'].includes(key))) return fail();
  for (const color of [value.foreground, value.background]) if (color !== undefined && !/^[A-Fa-f0-9]{6}$/.test(color)) return fail();
  if (value.fontSizePt !== undefined || value.fontLineHeightPt !== undefined) {
    if (!validDocumentFontSize(value.fontSizePt) || !validDocumentFontLineHeight(value.fontLineHeightPt)) return fail();
  }
  if (value.headingLevel !== undefined || value.headingBeforePt !== undefined) { if (!validDocumentHeadingLevel(value.headingLevel) || (value.headingBeforePt !== undefined && value.headingBeforePt !== 0) || (value.headingBeforePt === undefined && !value.headingImageSource)) return fail(); }
  if (Object.keys(value).some(key => key.startsWith('headingImage')) && !validDocumentHeadingImage(value)) return fail();
  return value;
}
/** The caller supplies qualified normalized presentation. This owner never
 * guesses authored styling or flattens native Pandoc content. */
export function documentDocxPresentationOwners(ast: unknown, resolve: (attributes: unknown, kind: 'cell' | 'inline' | 'heading') => DocumentDocxPresentation): DocumentDocxStyleOwner[] {
  const owners: DocumentDocxStyleOwner[] = [], prefix = `EveClr${randomBytes(8).toString('hex')}`;
  const marker = (owner: DocumentDocxStyleOwner, start: boolean) => ({ t: 'RawInline', c: ['openxml', start ? `<w:bookmarkStart w:id="${owner.id}" w:name="${owner.name}"/>` : `<w:bookmarkEnd w:id="${owner.id}"/>`] });
  const owner = (attributes: unknown, kind: 'cell' | 'inline' | 'heading') => {
    const value = checkedPresentation(resolve(attributes, kind));
    if (kind !== 'inline' && value.fontSizePt !== undefined) return fail();
    if (kind === 'heading') { if (Object.keys(value).some(key => !['headingLevel','headingBeforePt','headingImageLineHeightPt','headingImageWidthPt','headingImageHeightPt','headingImageSource'].includes(key))) return fail(); }
    else if (value.headingLevel !== undefined || value.headingBeforePt !== undefined || value.headingImageSource !== undefined) return fail();
    if (!Object.keys(value).length) return undefined;
    if (owners.length >= 10000) return fail();
    const result: DocumentDocxStyleOwner = { id: String(2_000_000_000 + owners.length), name: `${prefix}_${owners.length}`, kind, presentation: value }; owners.push(result); return result;
  };
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { for (const item of value) visit(item); return; }
    const node = value as Ast;
    if (node.t === 'Header' && Array.isArray(node.c)) {
      const entry = owner(node.c[1], 'heading');
      if (entry && entry.presentation.headingLevel !== node.c[0]) return fail();
      visit(node.c[2]);
      if (entry) { if (!Array.isArray(node.c[2])) return fail(); node.c[2] = [marker(entry,true), ...node.c[2], marker(entry,false)]; }
      return;
    }
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
export function projectDocumentDocxPresentation(xml: string, owners: readonly DocumentDocxStyleOwner[], imageAssets?: ReadonlyMap<string,string>): string {
  if (!owners.length) return xml;
  const doc = new DOMParser({ onError: fail }).parseFromString(xml, 'application/xml');
  const byId = new Map(owners.map(owner => [owner.id, owner])), names = new Set(owners.map(owner => owner.name));
  if (byId.size !== owners.length || names.size !== owners.length) return fail();
  const stack: DocumentDocxStyleOwner[] = [], seen = new Set<string>(), ended = new Set<string>(), markers: Element[] = [], temporary = new Set<Element>(), cells = new Map<string, Element>();
  const parentCell = (node: Node): Element | undefined => { for (let p = node.parentNode; p; p = p.parentNode) if (p.nodeType === 1 && (p as Element).namespaceURI === w && (p as Element).localName === 'tc') return p as Element; return undefined; };
  const children = (node: Element, name: string) => Array.from(node.childNodes).filter((n): n is Element => n.nodeType === 1 && (n as Element).namespaceURI === w && (n as Element).localName === name);
  const properties = (node: Element, name: string) => { const found = children(node, name); if (found.length > 1) return fail(); if (found[0]) return found[0]; const p = doc.createElementNS(w, `w:${name}`); node.insertBefore(p, node.firstChild); return p; };
  const set = (p: Element, name: string, attributes: Record<string, string>) => { for (const old of children(p, name)) p.removeChild(old); const item = doc.createElementNS(w, `w:${name}`); for (const [key, value] of Object.entries(attributes)) item.setAttributeNS(w, `w:${key}`, value); const later = p.localName === 'tcPr'
      ? ['noWrap','tcMar','textDirection','tcFitText','vAlign','hideMark','cellIns','cellDel','cellMerge','tcPrChange']
      : name === 'sz' || name === 'szCs'
        ? [...(name === 'sz' ? ['szCs'] : []), 'highlight','u','effect','bdr','shd','fitText','vertAlign','rtl','cs','em','lang','eastAsianLayout','specVanish','oMath','rPrChange']
      : name === 'color'
        ? ['spacing','w','kern','position','sz','szCs','highlight','u','effect','bdr','shd','fitText','vertAlign','rtl','cs','em','lang','eastAsianLayout','specVanish','rPrChange']
        : ['fitText','vertAlign','rtl','cs','em','lang','eastAsianLayout','specVanish','rPrChange'];
    // CT_RPr/CT_TcPr are ordered sequences. Preserve unrelated properties and
    // insert our owned property before the first schema successor (including
    // run extension properties), never append after superscript/alignment.
    const next = Array.from(p.childNodes).find(node => node.nodeType === 1 && ((node as Element).namespaceURI !== w || later.includes((node as Element).localName ?? '')));
    p.insertBefore(item, next ?? null); };
  const paragraphSpacing = (paragraph: Element): Element => {
    const pPr = properties(paragraph,'pPr'), existing = children(pPr,'spacing');
    if (existing.length > 1) return fail();
    if (existing[0]) return existing[0];
    const spacing = doc.createElementNS(w,'w:spacing');
    const later = ['ind','contextualSpacing','mirrorIndents','suppressOverlap','jc','textDirection','textAlignment','textboxTightWrap','outlineLvl','divId','cnfStyle','rPr','sectPr','pPrChange'];
    const next = Array.from(pPr.childNodes).find(node => node.nodeType===1 && ((node as Element).namespaceURI!==w || later.includes((node as Element).localName ?? '')));
    pPr.insertBefore(spacing,next ?? null); return spacing;
  };
  const parentParagraph = (node: Node): Element | undefined => { for (let parent = node.parentNode; parent; parent = parent.parentNode) if (parent.nodeType === 1 && (parent as Element).namespaceURI === w && (parent as Element).localName === 'p') return parent as Element; return undefined; };
  const headingParagraphs = new Map<string,Element>(), headingTargets = new Set<Element>();
  const paragraphLines = new Map<Element, number>();
  const headingImages = new Map<string, Set<Element>>();
  const visit = (node: Node): void => {
    if (node.nodeType !== 1) return;
    const element = node as Element, name = element.namespaceURI === w ? element.localName : '';
    if (name === 'p' && stack.some(owner => owner.kind === 'heading' && headingParagraphs.get(owner.id) !== element)) return fail();
    if (element.namespaceURI === 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing' && element.localName === 'inline') {
      for (const own of stack.filter(owner => owner.kind === 'heading')) {
        if (parentParagraph(element) !== headingParagraphs.get(own.id)) return fail();
        const images = headingImages.get(own.id) ?? new Set<Element>();
        images.add(element); headingImages.set(own.id,images);
      }
    }
    if (name === 'bookmarkStart' || name === 'bookmarkEnd') {
      const id = element.getAttributeNS(w, 'id')!, own = byId.get(id);
      if (!own && names.has(element.getAttributeNS(w, 'name') ?? '')) return fail();
      if (own) {
        if (name === 'bookmarkStart') {
          if (seen.has(id) || element.getAttributeNS(w, 'name') !== own.name) return fail();
          seen.add(id); stack.push(own);
          if (own.kind === 'heading') {
            const paragraph = parentParagraph(element);
            if (!paragraph || element.parentNode !== paragraph || headingTargets.has(paragraph)) return fail();
            const pPr = children(paragraph,'pPr');
            if (pPr.length !== 1 || children(pPr[0]!,'pStyle').length !== 1 || children(pPr[0]!,'pStyle')[0]!.getAttributeNS(w,'val') !== `Heading${own.presentation.headingLevel}`) return fail();
            headingParagraphs.set(id,paragraph); headingTargets.add(paragraph);
          }
          const cell = parentCell(element); if (cell) cells.set(id, cell); else if (own.kind === 'cell') return fail();
          if (own.kind === 'cell' && own.presentation.background) {
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
              if ((own.rowSpan ?? 1)===1 && marker) return fail();
              if ((own.rowSpan ?? 1)>1 && (!marker || (offset===0 ? marker.getAttributeNS(w,'val')!=='restart' : !['','continue'].includes(marker.getAttributeNS(w,'val') ?? '')))) return fail();
              set(properties(target,'tcPr'),'shd',{val:'clear',color:'auto',fill:own.presentation.background.toUpperCase()});
            }
          }
        } else {
          if (stack.at(-1)?.id !== id || ended.has(id) || cells.get(id) !== parentCell(element)) return fail();
          if (own.kind === 'heading' && (parentParagraph(element) !== headingParagraphs.get(id) || element.parentNode !== headingParagraphs.get(id))) return fail();
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
      const effective: DocumentDocxPresentation = {};
      for (const own of stack) { if (own.presentation.foreground) effective.foreground = own.presentation.foreground; if (own.kind === 'inline' && own.presentation.background) effective.background = own.presentation.background; if (own.kind === 'inline' && own.presentation.fontSizePt !== undefined) { effective.fontSizePt = own.presentation.fontSizePt; effective.fontLineHeightPt = own.presentation.fontLineHeightPt!; } }
      if (effective.foreground) set(properties(element, 'rPr'), 'color', { val: effective.foreground.toUpperCase() });
      if (effective.fontSizePt !== undefined) {
        set(properties(element, 'rPr'), 'sz', { val: documentWordFontSize(effective.fontSizePt) });
        set(properties(element, 'rPr'), 'szCs', { val: documentWordFontSize(effective.fontSizePt) });
        let paragraph: Node | null = element.parentNode;
        while (paragraph && !(paragraph.nodeType === 1 && (paragraph as Element).namespaceURI === w && (paragraph as Element).localName === 'p')) paragraph = paragraph.parentNode;
        if (!paragraph || !validDocumentFontLineHeight(effective.fontLineHeightPt)) return fail();
        paragraphLines.set(paragraph as Element, Math.max(paragraphLines.get(paragraph as Element) ?? 0, effective.fontLineHeightPt));
      }
      if (effective.background) set(properties(element, 'rPr'), 'shd', { val: 'clear', color: 'auto', fill: effective.background.toUpperCase() });
    }
    for (const child of Array.from(element.childNodes)) visit(child);
  };
  if (!doc.documentElement) return fail(); visit(doc.documentElement);
  if (stack.length || seen.size !== owners.length || ended.size !== owners.length) return fail();
  for (const [paragraph, minimum] of paragraphLines) {
    const spacing = paragraphSpacing(paragraph);
    spacing.setAttributeNS(w,'w:line',String(Math.round(minimum * 20))); spacing.setAttributeNS(w,'w:lineRule','atLeast');
  }
  for (const own of owners.filter(owner => owner.kind === 'heading')) {
    const paragraph = headingParagraphs.get(own.id) ?? fail();
    if (own.presentation.headingBeforePt !== undefined) paragraphSpacing(paragraph).setAttributeNS(w,'w:before','0');
    if (!own.presentation.headingImageSource) continue;
    const elements = Array.from(paragraph.getElementsByTagName('*'));
    const inlines = elements.filter(element => element.namespaceURI === 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing' && element.localName === 'inline');
    if (inlines.length !== 1 || elements.filter(element => element.namespaceURI === w && element.localName === 'drawing').length !== 1 || elements.some(element => element.localName === 'anchor') || elements.some(element => element.namespaceURI === w && ['t','br','tab','pict'].includes(element.localName ?? '')) || paragraphLines.has(paragraph)) return fail();
    const image = inlines[0]!;
    const ownedImages = headingImages.get(own.id);
    if (ownedImages?.size !== 1 || !ownedImages.has(image)) return fail();
    const extents = Array.from(image.getElementsByTagNameNS(image.namespaceURI!,'extent'));
    const drawing = 'http://schemas.openxmlformats.org/drawingml/2006/main';
    const picture = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
    const relationship = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const graphics = image.getElementsByTagNameNS(drawing,'graphicData'), pictures = image.getElementsByTagNameNS(picture,'pic');
    if (graphics.length !== 1 || graphics[0]!.getAttribute('uri') !== picture || pictures.length !== 1) return fail();
    const {blip,extent} = documentSimplePicture(image,graphics[0]!,pictures[0]!);
    if (own.imageAssetSha256 !== undefined && (!/^[a-f0-9]{64}$/.test(own.imageAssetSha256)
      || imageAssets?.get(blip.getAttributeNS(relationship,'embed')!) !== own.imageAssetSha256)) return fail();
    if (Number(extent.getAttribute('cx')) !== Math.round(own.presentation.headingImageWidthPt!*12700)
      || Number(extent.getAttribute('cy')) !== Math.round(own.presentation.headingImageHeightPt!*12700)) return fail();
    if (extents.length !== 1 || Number(extents[0]!.getAttribute('cx')) !== Math.round(own.presentation.headingImageWidthPt!*12700)
      || Number(extents[0]!.getAttribute('cy')) !== Math.round(own.presentation.headingImageHeightPt!*12700)) return fail();
    for (const side of ['T','B','L','R']) image.setAttribute(`dist${side}`,'0');
    const spacing = paragraphSpacing(paragraph);
    spacing.setAttributeNS(w,'w:line',String(Math.round(own.presentation.headingImageLineHeightPt!*20)));
    spacing.setAttributeNS(w,'w:lineRule','exact');
  }
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

export const documentDocxColorOwners = documentDocxPresentationOwners;
export const projectDocumentDocxColors = projectDocumentDocxPresentation;

export type DocumentDocxColorOwner = DocumentDocxStyleOwner;
