import type { Element } from '@xmldom/xmldom';

const drawing = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const picture = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const relationship = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const xmlns = 'http://www.w3.org/2000/xmlns/';
const fail = (): never => { throw new Error('The document converter could not preserve source image ownership.'); };
const expanded = (namespace: string | null, name: string) => `${namespace ?? ''}|${name}`;
const unsigned = /^\d+$/;

/** Exact children of the pinned converter's simple picture, not a descendant
 * search that could borrow a nested fill or overlook a crop/effect. */
function children(element: Element, names: readonly string[]): Element[] {
  const elements: Element[] = [];
  for (const node of Array.from(element.childNodes)) {
    if (node.nodeType === 1) elements.push(node as Element);
    else if (node.nodeType !== 8 && !(node.nodeType === 3 && !node.textContent?.trim())) return fail();
  }
  if (elements.length !== names.length) return fail();
  for (const [index,name] of names.entries()) {
    const [prefix,local] = name.split(':');
    if (elements[index]!.namespaceURI !== (prefix === 'a' ? drawing : picture) || elements[index]!.localName !== local) return fail();
  }
  return elements;
}
function attributes(element: Element, allowed: Readonly<Record<string,string|RegExp>>, required = Object.keys(allowed)): void {
  const seen = new Set<string>();
  for (const attribute of Array.from(element.attributes)) {
    if (attribute.namespaceURI === xmlns) continue;
    const key = expanded(attribute.namespaceURI,attribute.localName ?? attribute.name);
    const expected = allowed[key];
    if (expected === undefined || seen.has(key) || (typeof expected === 'string' ? attribute.value !== expected : !expected.test(attribute.value))) return fail();
    seen.add(key);
  }
  if (required.some(key => !seen.has(key))) return fail();
}
const plain = (values: Record<string,string|RegExp>) => Object.fromEntries(Object.entries(values).map(([key,value]) => [expanded(null,key),value]));

/** Media identity plus equal extents do not prove visible-image identity when
 * the native picture crops, masks, recolors or decorates those same bytes.
 * Accept the actual simple Pandoc form; retain every accepted native property. */
export function documentSimplePicture(inline: Element, graphicData: Element, ownedPicture: Element): { blip: Element; extent: Element } {
  const graphic = graphicData.parentNode as Element;
  if (!graphic || graphic.namespaceURI !== drawing || graphic.localName !== 'graphic' || graphic.parentNode !== inline) return fail();
  attributes(graphic,{}); children(graphic,['a:graphicData']);
  attributes(graphicData,plain({uri:picture}));
  if (children(graphicData,['p:pic'])[0] !== ownedPicture) return fail();
  attributes(ownedPicture,{});
  const [nonvisual,fill,shape] = children(ownedPicture,['p:nvPicPr','p:blipFill','p:spPr']);
  attributes(nonvisual!,{});
  const [metadata,locks] = children(nonvisual!,['p:cNvPr','p:cNvPicPr']);
  const metadataAttributes = plain({id:unsigned,name:/^.*$/s,descr:/^.*$/s,title:/^.*$/s});
  attributes(metadata!,metadataAttributes,[expanded(null,'id'),expanded(null,'name')]); children(metadata!,[]);
  attributes(locks!,{});
  const [pictureLocks] = children(locks!,['a:picLocks']);
  attributes(pictureLocks!,plain({noChangeArrowheads:'1',noChangeAspect:'1'})); children(pictureLocks!,[]);

  attributes(fill!,{});
  const [blip,stretch] = children(fill!,['a:blip','a:stretch']);
  attributes(blip!,{[expanded(relationship,'embed')]:/^.+$/s}); children(blip!,[]);
  attributes(stretch!,{});
  const [fillRectangle] = children(stretch!,['a:fillRect']);
  attributes(fillRectangle!,{}); children(fillRectangle!,[]);

  attributes(shape!,plain({bwMode:'auto'}));
  const [transform,geometry,noFill,line] = children(shape!,['a:xfrm','a:prstGeom','a:noFill','a:ln']);
  attributes(transform!,{});
  const [offset,extent] = children(transform!,['a:off','a:ext']);
  attributes(offset!,plain({x:'0',y:'0'})); children(offset!,[]);
  attributes(extent!,plain({cx:unsigned,cy:unsigned})); children(extent!,[]);
  attributes(geometry!,plain({prst:'rect'}));
  const [adjustments] = children(geometry!,['a:avLst']);
  attributes(adjustments!,{}); children(adjustments!,[]);
  attributes(noFill!,{}); children(noFill!,[]);
  attributes(line!,plain({w:'9525'}));
  for (const child of children(line!,['a:noFill','a:headEnd','a:tailEnd'])) { attributes(child,{}); children(child,[]); }
  return {blip:blip!,extent:extent!};
}
