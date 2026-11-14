import { expect, it } from 'vitest';
import JSZip from 'jszip';
import { documentDocxImageAssets, documentImageSha256, documentSourceImageSha256 } from '../src/embedded-render/document-image-assets.js';
const ns = 'http://schemas.openxmlformats.org/package/2006/relationships';
const type = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';
function archive(target = 'media/image1.png', extra = '') {
  const zip = new JSZip();
  zip.file('word/_rels/document.xml.rels', `<Relationships xmlns="${ns}"><Relationship Id="rImage" Type="${type}" Target="${target}"/>${extra}</Relationships>`);
  zip.file('word/media/image1.png', new Uint8Array([0]));
  return zip;
}
it('binds the actual original image bytes to a package-local native relationship', async () => {
  const result = await documentDocxImageAssets(archive());
  expect(result.get('rImage')).toBe(documentSourceImageSha256('data:image/png;base64,AA=='));
  expect(result.get('rImage')).toBe(documentImageSha256(new Uint8Array([0])));
});
it.each(['../image1.png','/word/media/image1.png','https://fixture.test/image.png','media/missing.png','media/image1.png#fragment'])('refuses ambiguous or missing package media: %s', async target => {
  await expect(documentDocxImageAssets(archive(target))).rejects.toThrow('ownership');
});
it('refuses duplicate IDs instead of choosing an image relationship by order', async () => {
  await expect(documentDocxImageAssets(archive('media/image1.png',`<Relationship Id="rImage" Type="${type}" Target="media/image1.png"/>`))).rejects.toThrow('ownership');
});
it.each(['pixel.png','data:image/png;base64,A===','data:image/png;base64,AB==','data:image/svg+xml;base64,AA=='])('does not infer unsupported source bytes: %s', source => {
  expect(() => documentSourceImageSha256(source)).toThrow('ownership');
});
it('does not resolve an external image or a nested forged relationship as package-local ownership', async () => {
  const external = archive();
  external.file('word/_rels/document.xml.rels', `<Relationships xmlns="${ns}"><Relationship Id="rImage" Type="${type}" Target="media/image1.png" TargetMode="External"/></Relationships>`);
  expect((await documentDocxImageAssets(external)).size).toBe(0);
  const nested = archive();
  nested.file('word/_rels/document.xml.rels', `<Relationships xmlns="${ns}"><Wrapper><Relationship Id="rImage" Type="${type}" Target="media/image1.png"/></Wrapper></Relationships>`);
  await expect(documentDocxImageAssets(nested)).rejects.toThrow('ownership');
});
it.each(['data:image/png;base64,AA','data:image/png;base64,A A==','data:image/png;base64,A\r\n\tA==','data:image/png;base64,A%20A%3D%3D'])('preserves bytes across observed browser/Pandoc base64 spellings: %s', source => {
  expect(documentSourceImageSha256(source)).toBe(documentSourceImageSha256('data:image/png;base64,AA=='));
});
it.each(['data:image/png;base64,A','data:image/png;base64,AB','data:image/png;base64,AA=','data:image/png;base64,AA===','data:image/png;base64,A%zzA==','data:image/png;base64,A\u000bA=='])('refuses malformed padding, unused bits and non-base64 whitespace: %s', source => {
  expect(() => documentSourceImageSha256(source)).toThrow();
});
