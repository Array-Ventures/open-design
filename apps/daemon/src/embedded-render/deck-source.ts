import { createHash, randomBytes } from 'node:crypto';
import { load } from 'cheerio';
import { canonicalDeckSourceSlides, deckSourcePath, decodeDeckSourceBytes, type DeckSourceTree } from '@open-design/contracts/runtime/deck-source';
import { findSpeakerNotesScriptBlock } from '@open-design/contracts/runtime/speaker-notes';

type SourceRoot = ReturnType<ReturnType<typeof load>['root']>[0];
type SourceNode = SourceRoot | SourceRoot['children'][number];
const tree: DeckSourceTree<SourceNode> = {
  tag: node => 'tagName' in node ? node.tagName : null,
  children: node => 'children' in node ? node.children.filter(child => 'tagName' in child) : [],
  parent: node => node.parent,
  attribute: (node, name) => 'attribs' in node ? node.attribs[name] ?? null : null,
};
const fail = (): never => { throw new Error('The selected slide no longer has a unique source-owned render target.'); };

/** Conversion-only identity. Hash the admitted ORIGINAL bytes, before notes
 * removal, marker stamping, fallback injection or browser execution. */
export function prepareDeckSourceCapture(bytes: Buffer, selection: { deckSourceSha256: string; deckSourcePath: string; index: number }) {
  if (createHash('sha256').update(bytes).digest('hex') !== selection.deckSourceSha256) throw new Error('The selected slide belongs to a different source revision.');
  const original = decodeDeckSourceBytes(bytes);
  if (original === null) throw new Error('Source-owned slide export requires valid UTF-8.');
  const notes = findSpeakerNotesScriptBlock(original);
  const visual = notes ? original.slice(0, notes.start) + original.slice(notes.end) : original;
  const $visual = load(visual), visualSlides = canonicalDeckSourceSlides($visual.root()[0]!, tree);
  if (visualSlides.length < 1 || visualSlides.length > 200) return fail();
  const matches = visualSlides.filter(node => deckSourcePath(node, tree) === selection.deckSourcePath);
  if (matches.length !== 1 || visualSlides[selection.index] !== matches[0]) return fail();
  const $ = load(original), slides = canonicalDeckSourceSlides($.root()[0]!, tree);
  if (slides.length !== visualSlides.length) return fail();
  const target = slides[selection.index];
  // The trusted first-child SCRIPT requires ordinary HTML flow content.
  if (!target || !['section', 'div', 'article', 'main'].includes(tree.tag(target) ?? '')) return fail();
  const nonce = randomBytes(16).toString('hex');
  const attribute = `data-od-export-${nonce}`;
  const capture = `__od_capture_${nonce}`, read = `__od_target_${nonce}`;
  if ($(`[${attribute}]`).length) return fail();
  $(target).attr(attribute, nonce).prepend(`<script ${attribute}="${nonce}">window[${JSON.stringify(capture)}]();</script>`);
  // Every getter/method used to acquire identity is captured before authored JS.
  // No authored argument supplies currentScript or parent identity.
  const bootstrap = `(()=>{
    const get=Object.getOwnPropertyDescriptor;
    const current=get(Document.prototype,'currentScript').get;
    const parent=get(Node.prototype,'parentNode').get;
    const owner=get(Node.prototype,'ownerDocument').get;
    const tag=get(Element.prototype,'tagName').get;
    const ns=get(Element.prototype,'namespaceURI').get;
    const kind=get(Node.prototype,'nodeType').get,connected=get(Node.prototype,'isConnected').get;
    const addedNodes=get(MutationRecord.prototype,'addedNodes').get;
    const listLength=get(NodeList.prototype,'length').get,item=NodeList.prototype.item;
    const attr=Element.prototype.getAttribute,remove=Node.prototype.removeChild;
    const MO=MutationObserver,take=MO.prototype.takeRecords;
    let node=null,used=false,invalid=false;
    const expected=${JSON.stringify(nonce)},attribute=${JSON.stringify(attribute)};
    function target(candidate){return candidate&&kind.call(candidate)===1&&ns.call(candidate)==='http://www.w3.org/1999/xhtml'&&attr.call(candidate,attribute)===expected&&/^(SECTION|DIV|ARTICLE|MAIN)$/.test(tag.call(candidate));}
    function added(records){for(let r=0;r<records.length;r++){const list=addedNodes.call(records[r]);for(let i=0;i<listLength.call(list);i++){const candidate=item.call(list,i);if(target(candidate)){if(node&&node!==candidate)invalid=true;else node=candidate;}}}}
    const observer=new MO(added);
    observer.observe(document,{childList:true,subtree:true});
    Object.defineProperty(window,${JSON.stringify(capture)},{configurable:false,writable:false,value:function(){
      added(take.call(observer));
      const script=current.call(document),candidate=script&&parent.call(script);
      if(used||invalid||!script||tag.call(script)!=='SCRIPT'||attr.call(script,attribute)!==expected||!target(candidate)||owner.call(candidate)!==document||candidate!==node){invalid=true;throw Error('Invalid source slide capture');}
      used=true;remove.call(candidate,script);
    }});
    Object.defineProperty(window,${JSON.stringify(read)},{configurable:false,writable:false,value:()=>used&&!invalid&&node&&connected.call(node)&&attr.call(node,attribute)===expected?node:null});
  })();`;

  return { html: $.html(), bootstrap, targetExpression: `window[${JSON.stringify(read)}]()`, attribute, nonce };
}

/** The browser evaluation is an untyped boundary. Never interpolate an absent
 * or fractional result into navigation, even if evaluation stops invoking. */
export function checkedDeckRuntimeIndex(value: unknown): number {
  if (!value || typeof value !== 'object') return fail();
  const { index, count } = value as { index?: unknown; count?: unknown };
  if (typeof index !== 'number' || typeof count !== 'number' || !Number.isSafeInteger(index) || !Number.isSafeInteger(count) || count < 1 || count > 200 || index < 0 || index >= count) return fail();
  return index;
}
