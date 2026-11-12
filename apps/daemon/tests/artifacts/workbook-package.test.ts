import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { readWorkbookPackage, writeWorkbookPackage, WORKBOOK_PACKAGE_LIMITS } from '../../src/artifacts/workbook/package.js';
import { parseWorkbookXml, writeWorkbookXml } from '../../src/artifacts/workbook/xml.js';

const fixtureParts = () => new Map([
  ['[Content_Types].xml', Buffer.from('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>')],
  ['_rels/.rels', Buffer.from('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>')],
  ['xl/workbook.xml', Buffer.from('<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>')],
  ['xl/_rels/workbook.xml.rels', Buffer.from('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>')],
]);
async function archive(extra?: (zip: JSZip) => void, compression: 'STORE' | 'DEFLATE' = 'DEFLATE') {
  const zip = new JSZip();
  for (const [name, bytes] of fixtureParts()) zip.file(name, bytes, { createFolders: false });
  extra?.(zip);
  return zip.generateAsync({ type: 'nodebuffer', compression, platform: 'UNIX' });
}
function centralEntry(bytes: Buffer, name: string): number {
  for (let offset = 0; offset <= bytes.length - 46; offset++) {
    if (bytes.readUInt32LE(offset) !== 0x02014b50) continue;
    const length = bytes.readUInt16LE(offset + 28);
    if (bytes.subarray(offset + 46, offset + 46 + length).toString() === name) return offset;
  }
  throw new Error('Fixture ZIP entry was not found');
}

describe('bounded workbook package admission and preservation', () => {
  it('retains untouched chart, drawing, relationship and extension parts byte for byte', async () => {
    const original = await archive(zip => {
      zip.file('xl/worksheets/sheet1.xml', '<worksheet><sheetData/></worksheet>');
      zip.file('xl/charts/chart1.xml', '<chartSpace><chart>Preserve chart</chart></chartSpace>');
      zip.file('xl/drawings/drawing1.xml', '<drawing>Anchor</drawing>');
      zip.file('xl/drawings/_rels/drawing1.xml.rels', '<Relationships/>');
      zip.file('customXml/item1.xml', '<custom>Unknown extension</custom>');
    });
    const parts = await readWorkbookPackage(original);
    const changed = new Map(parts);
    changed.set('xl/worksheets/sheet1.xml', Buffer.from('<worksheet><sheetData><row r="1"/></sheetData></worksheet>'));
    const saved = await readWorkbookPackage(await writeWorkbookPackage(changed));
    expect([...saved.keys()].sort()).toEqual([...parts.keys()].sort());
    for (const [name, bytes] of parts) if (name !== 'xl/worksheets/sheet1.xml') expect(saved.get(name)).toEqual(bytes);
    expect(saved.get('xl/worksheets/sheet1.xml')?.toString()).toContain('row r="1"');
  });
  it.each(['../escape.xml', '/absolute.xml', 'xl\\escape.xml'])('refuses the package path %s without extracting it', async name => {
    await expect(readWorkbookPackage(await archive(zip => zip.file(name, 'fixture')))).rejects.toMatchObject({ code: 'WORKBOOK_INVALID' });
  });
  it('refuses case-ambiguous duplicate package parts', async () => {
    await expect(readWorkbookPackage(await archive(zip => { zip.file('xl/styles.xml', 'one'); zip.file('xl/Styles.xml', 'two'); }))).rejects.toThrow('Duplicate');
  });
  it('refuses symlinks rather than treating link content as XML', async () => {
    await expect(readWorkbookPackage(await archive(zip => zip.file('xl/link', '../outside', { unixPermissions: 0o120777 })))).rejects.toThrow('links');
  });
  it('checks CRC against the actual decompressed bytes', async () => {
    const bytes = await archive(zip => zip.file('xl/canary.xml', 'unchanged-canary'), 'STORE');
    const offset = bytes.indexOf(Buffer.from('unchanged-canary')); expect(offset).toBeGreaterThan(0);
    bytes[offset] = bytes[offset]! ^ 1;
    await expect(readWorkbookPackage(bytes)).rejects.toThrow('checksum');
  });
  it('refuses encrypted and unsupported compression entries before parsing', async () => {
    const encrypted = await archive(); const offset = centralEntry(encrypted, 'xl/workbook.xml');
    encrypted.writeUInt16LE(encrypted.readUInt16LE(offset + 8) | 1, offset + 8);
    await expect(readWorkbookPackage(encrypted)).rejects.toMatchObject({ code: 'WORKBOOK_UNSUPPORTED' });
    const unsupported = await archive(); unsupported.writeUInt16LE(12, centralEntry(unsupported, 'xl/workbook.xml') + 10);
    await expect(readWorkbookPackage(unsupported)).rejects.toMatchObject({ code: 'WORKBOOK_UNSUPPORTED' });
  });
  it('refuses inconsistent declared sizes rather than trusting a small central-directory claim', async () => {
    const bytes = await archive(zip => zip.file('xl/payload.xml', 'x'.repeat(1000)));
    bytes.writeUInt32LE(1, centralEntry(bytes, 'xl/payload.xml') + 24);
    await expect(readWorkbookPackage(bytes)).rejects.toMatchObject({ code: 'WORKBOOK_INVALID' });
  });
  it('bounds compressed bytes, part count, declared part size and total expansion', async () => {
    const bytes = await archive(zip => zip.file('xl/payload.xml', 'x'.repeat(2048)));
    for (const limits of [
      { ...WORKBOOK_PACKAGE_LIMITS, archiveBytes: 10 },
      { ...WORKBOOK_PACKAGE_LIMITS, entries: 1 },
      { ...WORKBOOK_PACKAGE_LIMITS, partBytes: 1024 },
      { ...WORKBOOK_PACKAGE_LIMITS, expandedBytes: 1024 },
    ]) await expect(readWorkbookPackage(bytes, limits)).rejects.toMatchObject({ code: 'WORKBOOK_LIMIT' });
  });
  it('rejects non-workbook and incomplete archives', async () => {
    await expect(readWorkbookPackage(Buffer.from('not a zip'))).rejects.toMatchObject({ code: 'WORKBOOK_INVALID' });
    const zip = new JSZip(); zip.file('file.txt', 'not a workbook');
    await expect(readWorkbookPackage(await zip.generateAsync({ type: 'nodebuffer' }))).rejects.toThrow('required');
  });
  it('applies the same path, duplicate and expansion bounds to writes', async () => {
    const parts = fixtureParts(); parts.set('../outside', Buffer.from('no'));
    await expect(writeWorkbookPackage(parts)).rejects.toThrow('path');
    const duplicate = fixtureParts(); duplicate.set('XL/workbook.xml', Buffer.from('duplicate'));
    await expect(writeWorkbookPackage(duplicate)).rejects.toThrow('Duplicate');
    const directory = fixtureParts(); directory.set('xl/empty/', Buffer.from('not empty'));
    await expect(writeWorkbookPackage(directory)).rejects.toThrow('file parts');
    await expect(writeWorkbookPackage(fixtureParts(), { ...WORKBOOK_PACKAGE_LIMITS, expandedBytes: 1 })).rejects.toMatchObject({ code: 'WORKBOOK_LIMIT' });
  });
});

describe('strict workbook XML', () => {
  it('preserves namespaces, rich text whitespace and unknown extension nodes', () => {
    const document = parseWorkbookXml(Buffer.from('<sheet xmlns="urn:sheet" xmlns:x="urn:extension"><t xml:space="preserve"> keep </t><x:extra value="retained"/></sheet>'));
    const roundtrip = parseWorkbookXml(writeWorkbookXml(document));
    expect(roundtrip.getElementsByTagNameNS('urn:extension', 'extra')[0]?.getAttribute('value')).toBe('retained');
    expect(roundtrip.getElementsByTagNameNS('urn:sheet', 't')[0]?.textContent).toBe(' keep ');
  });
  it.each(['little', 'big'])('supports valid %s-endian UTF-16 without silently replacing text', endian => {
    const body = Buffer.from('<?xml version="1.0" encoding="UTF-16"?><sheet>Résumé 值 🧮</sheet>', 'utf16le');
    const document = parseWorkbookXml(Buffer.concat([Buffer.from(endian === 'little' ? [0xff, 0xfe] : [0xfe, 0xff]), endian === 'little' ? body : body.swap16()]));
    expect(document.documentElement?.textContent).toBe('Résumé 值 🧮');
    const output = writeWorkbookXml(document);
    expect(output.toString()).toContain('encoding="UTF-8"');
    expect(parseWorkbookXml(output).documentElement?.textContent).toBe('Résumé 值 🧮');
  });
  it.each(['<!DOCTYPE sheet SYSTEM "file:///outside"><sheet/>', '<!DOCTYPE sheet [<!ENTITY data "expanded">]><sheet>&data;</sheet>', '<sheet><unclosed></sheet>', '<x:sheet/>'])('refuses declarations and malformed XML: %s', text => {
    expect(() => parseWorkbookXml(Buffer.from(text))).toThrow();
  });
  it('rejects malformed UTF-8 and unsupported encodings', () => {
    expect(() => parseWorkbookXml(Buffer.from([0x3c, 0x78, 0x3e, 0xff]))).toThrow();
    expect(() => parseWorkbookXml(Buffer.from('<?xml version="1.0" encoding="ISO-8859-1"?><sheet/>'))).toThrow('encoding');
    expect(() => parseWorkbookXml(Buffer.from('<?xml version="1.0" encoding="UTF-16"?><sheet/>'))).toThrow('does not match');
  });
  it('rejects excessive XML depth before building a DOM', () => {
    expect(() => parseWorkbookXml(Buffer.from('<x>'.repeat(128) + '</x>'.repeat(128)))).not.toThrow();
    expect(() => parseWorkbookXml(Buffer.from('<x>'.repeat(129) + '</x>'.repeat(129)))).toThrow('structural limit');
  });
  it('bounds node count before building a DOM, including shallow XML', () => {
    expect(() => parseWorkbookXml(Buffer.from('<sheet>' + '<c/>'.repeat(250_000) + '</sheet>'))).toThrow('structural limit');
  });
  it('bounds XML bytes even when called independently of ZIP admission', () => {
    expect(() => parseWorkbookXml(Buffer.alloc(WORKBOOK_PACKAGE_LIMITS.partBytes + 1)))
      .toThrowError(expect.objectContaining({ code: 'WORKBOOK_LIMIT' }));
  });
});
