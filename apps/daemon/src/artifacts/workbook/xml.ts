import { TextDecoder } from 'node:util';
import { DOMParser, XMLSerializer, type Document } from '@xmldom/xmldom';
import { SaxesParser } from 'saxes';
import { WorkbookFormatError, WORKBOOK_PACKAGE_LIMITS } from './package.js';

export function parseWorkbookXml(bytes: Buffer): Document {
  if (bytes.length > WORKBOOK_PACKAGE_LIMITS.partBytes) throw new WorkbookFormatError('Workbook XML exceeds its limit.', 'WORKBOOK_LIMIT');
  let text: string;
  try {
    const bigEndian = bytes[0] === 0xfe && bytes[1] === 0xff || bytes[0] === 0 && bytes[1] === 0x3c;
    const littleEndian = bytes[0] === 0xff && bytes[1] === 0xfe || bytes[0] === 0x3c && bytes[1] === 0;
    text = new TextDecoder(bigEndian ? 'utf-16be' : littleEndian ? 'utf-16le' : 'utf-8', { fatal: true }).decode(bytes);
    if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new WorkbookFormatError('Workbook XML declarations are not supported.', 'WORKBOOK_UNSUPPORTED');
    const encoding = /^\s*<\?xml\b[^?]*\bencoding\s*=\s*['"]([^'"]+)['"]/i.exec(text)?.[1];
    if (encoding && !/^utf-(?:8|16|16le|16be)$/i.test(encoding)) throw new WorkbookFormatError('Workbook XML encoding is not supported.', 'WORKBOOK_UNSUPPORTED');
    if (encoding && !(bigEndian ? /^utf-16(?:be)?$/i : littleEndian ? /^utf-16(?:le)?$/i : /^utf-8$/i).test(encoding)) {
      throw new WorkbookFormatError('Workbook XML encoding does not match its bytes.');
    }
    let depth = 0, nodes = 0;
    const parser = new SaxesParser({ xmlns: true });
    parser.on('error', error => { throw error; });
    parser.on('opentag', () => {
      if (++depth > 128 || ++nodes > 250_000) throw new WorkbookFormatError('Workbook XML exceeds its structural limit.', 'WORKBOOK_LIMIT');
    });
    parser.on('closetag', () => { depth--; });
    parser.write(text).close();
    return new DOMParser({ onError: () => { throw new WorkbookFormatError('Invalid workbook XML.'); } }).parseFromString(text, 'application/xml');
  } catch (error) {
    throw error instanceof WorkbookFormatError ? error : new WorkbookFormatError('Invalid workbook XML.');
  }
}

export function writeWorkbookXml(document: Document): Buffer {
  const serialized = new XMLSerializer().serializeToString(document)
    .replace(/^(\s*<\?xml\b[^?]*\bencoding\s*=\s*['"])[^'"]+(['"])/i, '$1UTF-8$2');
  return Buffer.from(serialized, 'utf8');
}
