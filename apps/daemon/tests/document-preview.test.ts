import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { buildDocumentPreview } from '../src/document-preview.js';

async function archive(files: Record<string, string>) {
  const zip = new JSZip();
  for (const [name, text] of Object.entries(files)) zip.file(name, text);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
function understateSizes(input: Buffer): Buffer {
  const output = Buffer.from(input);
  const end = output.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let central = output.readUInt32LE(end + 16);
  const count = output.readUInt16LE(end + 10);
  for (let index = 0; index < count; index++) {
    const local = output.readUInt32LE(central + 42);
    if (output.readUInt32LE(central + 24) > 1024) {
      output.writeUInt32LE(1, central + 24);
      output.writeUInt32LE(1, local + 22);
    }
    central += 46 + output.readUInt16LE(central + 28) + output.readUInt16LE(central + 30) + output.readUInt16LE(central + 32);
  }
  return output;
}
describe('document preview archive limits', () => {
  it('preserves ordinary document and spreadsheet text', async () => {
    const document = await archive({ 'word/document.xml': '<w:document><w:p><w:r><w:t>Preview fixture</w:t></w:r></w:p></w:document>' });
    expect(await buildDocumentPreview({ name: 'fixture.docx', buffer: document })).toMatchObject({ sections: [{ lines: ['Preview fixture'] }] });
    const spreadsheet = await archive({ 'xl/worksheets/sheet1.xml': '<worksheet><row><c t="inlineStr"><is><t>Cell fixture</t></is></c></row></worksheet>' });
    expect(await buildDocumentPreview({ name: 'fixture.xlsx', buffer: spreadsheet })).toMatchObject({ sections: [{ lines: ['Cell fixture'] }] });
  });
  it('enforces the actual inflated section limit when ZIP sizes understate it', async () => {
    const input = understateSizes(await archive({ 'word/document.xml': `<w:document><w:p><w:t>${'x'.repeat(6 * 1024 * 1024)}</w:t></w:p></w:document>` }));
    await expect(buildDocumentPreview({ name: 'oversized.docx', buffer: input })).rejects.toMatchObject({ statusCode: 413 });
  });
  it('counts repeated worksheet reads toward the total inflated-byte budget', async () => {
    const sheets = Array.from({ length: 11 }, (_, index) => `<sheet name="Sheet ${index}" r:id="r1"/>`).join('');
    const input = await archive({
      'xl/workbook.xml': `<workbook><sheets>${sheets}</sheets></workbook>`,
      'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>',
      'xl/worksheets/sheet1.xml': `<worksheet><!--${'x'.repeat(5 * 1024 * 1024 - 100)}--></worksheet>`,
    });
    await expect(buildDocumentPreview({ name: 'repeated.xlsx', buffer: input })).rejects.toMatchObject({ statusCode: 413 });
  });
  it('does not hide an oversized optional spreadsheet section as missing data', async () => {
    const input = await archive({ 'xl/sharedStrings.xml': `<sst><si><t>${'x'.repeat(6 * 1024 * 1024)}</t></si></sst>`, 'xl/worksheets/sheet1.xml': '<worksheet><row><c t="s"><v>0</v></c></row></worksheet>' });
    await expect(buildDocumentPreview({ name: 'oversized.xlsx', buffer: input })).rejects.toMatchObject({ statusCode: 413 });
  });
  it('does not hide unsupported XML declarations in an optional spreadsheet section', async () => {
    const input = await archive({ 'xl/sharedStrings.xml': '<!DOCTYPE fixture><sst/>', 'xl/worksheets/sheet1.xml': '<worksheet/>' });
    await expect(buildDocumentPreview({ name: 'unsupported.xlsx', buffer: input })).rejects.toMatchObject({ statusCode: 415 });
  });
});
