import { createHash } from 'node:crypto';
import { DOMParser } from '@xmldom/xmldom';
import type JSZip from 'jszip';
import { MAX_STANDALONE_ASSET_BYTES } from '../artifacts/standalone-html.js';

const fail = (): never => { throw new Error('The document converter could not preserve source image ownership.'); };
const relationships = 'http://schemas.openxmlformats.org/package/2006/relationships';
const imageType = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';
export const documentImageSha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** The standalone bundler has already resolved local source assets. Do not let
 * an unrelated native picture satisfy the exact source Image owner. */
export function documentSourceImageSha256(source: string): string {
  const match = /^data:image\/(?:png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(source);
  if (!match || match[1]!.length % 4 !== 0) return fail();
  const bytes = Buffer.from(match[1]!, 'base64');
  if (!bytes.length || bytes.length > MAX_STANDALONE_ASSET_BYTES || bytes.toString('base64') !== match[1]) return fail();
  return documentImageSha256(bytes);
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
