import { createHash } from 'node:crypto';
import { DOMParser } from '@xmldom/xmldom';
import type JSZip from 'jszip';
import { MAX_STANDALONE_ASSET_BYTES, MAX_STANDALONE_OUTPUT_BYTES } from '../artifacts/standalone-html.js';

const fail = (): never => { throw new Error('The document converter could not preserve source image ownership.'); };
const relationships = 'http://schemas.openxmlformats.org/package/2006/relationships';
const imageType = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';
export const documentImageSha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** The standalone bundler has already resolved local source assets. Do not let
 * an unrelated native picture satisfy the exact source Image owner. */
export function documentSourceImageIdentity(source: string): { mime: string; sha256: string } {
  if (source.length > MAX_STANDALONE_OUTPUT_BYTES) return fail();
  const prefix = /^data:(image\/(?:png|jpeg));base64,/.exec(source);
  if (!prefix) return fail();
  let payload: string;
  try { payload = decodeURIComponent(source.slice(prefix[0].length)); }
  catch { return fail(); }
  // Actual browser-valid HTML whitespace becomes percent-escaped (and tabs
  // become spaces) in Pandoc's Image target. Normalize the base64 payload,
  // never an external URL, source ID, MIME type or image bytes.
  const compact = payload.replace(/[ \t\n\r\f]/g,'');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact) || compact.length % 4 === 1
    || compact.length > Math.ceil(MAX_STANDALONE_ASSET_BYTES/3)*4) return fail();
  const bytes = Buffer.from(compact,'base64');
  if (!bytes.length || bytes.length > MAX_STANDALONE_ASSET_BYTES) return fail();
  const canonical = bytes.toString('base64');
  // Permit canonical padding or valid omitted padding. Buffer's permissive
  // decoder must not admit wrong padding or nonzero unused trailing bits.
  if (compact !== (compact.includes('=') ? canonical : canonical.replace(/=+$/,''))) return fail();
  return {mime:prefix[1]!,sha256:documentImageSha256(bytes)};
}
export function documentSourceImageSha256(source: string): string {
  return documentSourceImageIdentity(source).sha256;
}

/** Resolve package-local image relationships, not URL or filename guesses.
 * A selected owner still has to match this digest through its exact blip ID. */
export async function documentDocxImageAssets(zip: JSZip): Promise<ReadonlyMap<string, string>> {
  const part = zip.file('word/_rels/document.xml.rels');
  if (!part) return fail();
  const xml = new DOMParser({ onError: fail }).parseFromString(await part.async('string'), 'application/xml');
  if (xml.documentElement?.namespaceURI !== relationships || xml.documentElement.localName !== 'Relationships') return fail();
  const ids = new Set<string>(), result = new Map<string,string>(), assets = new Map<string,string>();
  let bytesRead = 0;
  for (const node of Array.from(xml.documentElement.childNodes)) {
    if (node.nodeType !== 1) continue;
    const relationship = node as import('@xmldom/xmldom').Element;
    if (relationship.namespaceURI !== relationships || relationship.localName !== 'Relationship') return fail();
    const id = relationship.getAttribute('Id');
    if (!id || ids.has(id)) return fail();
    ids.add(id);
    if (relationship.getAttribute('Type') !== imageType) continue;
    if (relationship.hasAttribute('TargetMode') && relationship.getAttribute('TargetMode') !== 'Internal') continue;
    const target = relationship.getAttribute('Target');
    if (!target || !/^media\/[A-Za-z0-9_.-]+$/.test(target) || target.endsWith('/..')) return fail();
    const known = assets.get(target);
    if (known) { result.set(id,known); continue; }
    const asset = zip.file(`word/${target}`);
    if (!asset) return fail();
    const bytes = await asset.async('uint8array');
    bytesRead += bytes.byteLength;
    if (!bytes.length || bytesRead > MAX_STANDALONE_ASSET_BYTES) return fail();
    const digest = documentImageSha256(bytes);
    assets.set(target,digest); result.set(id,digest);
  }
  return result;
}
