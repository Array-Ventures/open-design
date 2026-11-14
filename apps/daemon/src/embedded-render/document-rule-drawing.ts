import type { Document, Element } from '@xmldom/xmldom';
import { documentExportProfile } from './document-export-profile.js';

const namespaces = {
  w: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  wp: 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  mc: 'http://schemas.openxmlformats.org/markup-compatibility/2006',
  wps: 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape',
  wp14: 'http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing',
} as const;
const fail = (): never => { throw new Error('The document converter could not preserve divider presentation.'); };
const contentWidthPt = documentExportProfile.page.widthPt - 2*documentExportProfile.page.marginPt;
export function documentRuleWordWidth(width?: string): { widthPt: number; percent?: number } {
  if (width === undefined) return {widthPt:contentWidthPt,percent:100};
  if (!/^(?:[1-9][0-9]{0,3}(?:\.[0-9]+)?px|(?:[1-9][0-9]?|100)(?:\.[0-9]+)?%)$/.test(width)) return fail();
  const value = Number.parseFloat(width);
  if (!Number.isFinite(value) || value <= 0) return fail();
  if (width.endsWith('px')) return {widthPt:value*.75};
  const tenths = value*10;
  if (tenths > 1000 || Math.abs(tenths-Math.round(tenths)) > 1e-8) return fail();
  return {widthPt:contentWidthPt*value/100,percent:value};
}

/** Modern editable line geometry, isolated from the old VML consumer's implicit
 * paragraph-after wrap distance. The original owned VML remains the fallback. */
export function createDocumentRuleDrawing(document: Document) {
  const ids = new Set<number>();
  for (const properties of Array.from(document.getElementsByTagNameNS(namespaces.wp,'docPr'))) {
    const raw = properties.getAttribute('id');
    if (!raw || !/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) > 0xffffffff) return fail();
    ids.add(Number(raw));
  }
  let nextId = 1;
  const node = (name: string, attributes: Record<string,string|number> = {}, children: Element[] = [], text?: string): Element => {
    const namespace = namespaces[name.split(':')[0] as keyof typeof namespaces] ?? fail();
    const element = document.createElementNS(namespace,name);
    for (const [key,value] of Object.entries(attributes)) element.setAttribute(key,String(value));
    for (const child of children) element.appendChild(child);
    if (text !== undefined) element.appendChild(document.createTextNode(text));
    return element;
  };
  return (picture: Element, width: string | undefined, foreground: string | undefined, background?: string): Element => {
    const geometry = documentRuleWordWidth(width);
    if (geometry.widthPt > contentWidthPt || !foreground || !/^[A-F0-9]{6}$/.test(foreground)
      || (background !== undefined && !/^[A-F0-9]{6}$/.test(background))) return fail();
    while (ids.has(nextId)) nextId++;
    if (nextId > 0xffffffff) return fail();
    const id = nextId++; ids.add(id);
    const widthEmu = Math.round(geometry.widthPt*12700);
    const strokeEmu = Math.round(documentExportProfile.rule.borderPx*.75*12700);
    const fill = (color: string) => node('a:solidFill',{},[node('a:srgbClr',{val:color})]);
    const properties = node('wps:spPr',{},[
      node('a:xfrm',{},[node('a:off',{x:0,y:0}),node('a:ext',{cx:widthEmu,cy:0})]),
      node('a:prstGeom',{prst:'line'},[node('a:avLst')]),
      background ? fill(background) : node('a:noFill'),
      node('a:ln',{w:strokeEmu,cap:'flat'},[fill(foreground)]),
    ]);
    const anchor = node('wp:anchor',{distT:0,distB:0,distL:0,distR:0,simplePos:0,relativeHeight:0,behindDoc:0,locked:0,layoutInCell:1,allowOverlap:1},[
      node('wp:simplePos',{x:0,y:0}),
      node('wp:positionH',{relativeFrom:'margin'},[node('wp:align',{},[],'center')]),
      // The source border occupies this exact rule line. Its center is half
      // the actual stroke, not an offset inferred from preceding text glyphs.
      node('wp:positionV',{relativeFrom:'line'},[node('wp:posOffset',{},[],String(Math.round(strokeEmu/2)))]),
      node('wp:extent',{cx:widthEmu,cy:0}),
      node('wp:effectExtent',{l:0,t:0,r:0,b:0}),
      node('wp:wrapNone'),
      node('wp:docPr',{id,name:`Divider ${id}`,descr:'Divider'}),
      node('a:graphic',{},[node('a:graphicData',{uri:namespaces.wps},[
        node('wps:wsp',{},[node('wps:cNvSpPr'),properties,node('wps:bodyPr')]),
      ])]),
    ]);
    if (geometry.percent !== undefined) anchor.appendChild(node('wp14:sizeRelH',{relativeFrom:'margin'},[
      node('wp14:pctWidth',{},[],String(Math.round(geometry.percent*1000))),
    ]));
    const alternate = node('mc:AlternateContent',{},[
      node('mc:Choice',{Requires:'wps'},[node('w:drawing',{},[anchor])]),
      node('mc:Fallback',{},[picture.cloneNode(true) as Element]),
    ]);
    // Local bindings cannot overwrite an unrelated prefix on the input root.
    for (const [prefix,namespace] of Object.entries(namespaces)) alternate.setAttributeNS('http://www.w3.org/2000/xmlns/',`xmlns:${prefix}`,namespace);
    return alternate;
  };
}
