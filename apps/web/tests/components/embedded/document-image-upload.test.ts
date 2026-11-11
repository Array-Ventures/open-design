// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const upload = vi.hoisted(() => vi.fn());
const decode = vi.hoisted(() => vi.fn());
vi.mock('../../../src/providers/registry', () => ({ uploadProjectFiles: upload }));
import { uploadDocumentImage } from '../../../src/components/embedded/document/document-image-upload';
const revoke = vi.fn(); const create = vi.fn(() => 'blob:fixture-image');
beforeEach(() => {
  vi.stubGlobal('Image', class { src = ''; naturalWidth = 400; naturalHeight = 200; decode() { return decode(); } removeAttribute() { this.src = ''; } });
  vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke });
  vi.stubGlobal('crypto', { randomUUID: () => 'fixture-image-id' });
  decode.mockResolvedValue(undefined); upload.mockResolvedValue({ uploaded: [{ path: '_studio-document-assets/authoritative.png' }], failed: [] });
});
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });
it('uses the protected upload API and its authoritative receipt while releasing the decode URL', async () => {
  const file = new File(['fixture'], 'My figure.png', { type: 'image/png' }); const signal = new AbortController().signal;
  expect(await uploadDocumentImage('project', file, signal)).toEqual({ name: '_studio-document-assets/authoritative.png', alt: 'My figure', width: 400, height: 200 });
  expect(upload).toHaveBeenCalledWith('project', [expect.any(File)], '_studio-document-assets', undefined, signal);
  const asset = upload.mock.calls[0]![1][0] as File;
  expect(asset.name).toBe('fixture-image-id.png');
  expect(asset.size).toBe(file.size);
  expect(asset.type).toBe('image/png');
  expect(revoke).toHaveBeenCalledWith('blob:fixture-image');
});
it('cancels pending decoding before making an upload request', async () => {
  decode.mockImplementation(() => new Promise(() => {})); const controller = new AbortController();
  const pending = uploadDocumentImage('project', new File(['fixture'], 'figure.png', { type: 'image/png' }), controller.signal);
  controller.abort(); await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(upload).not.toHaveBeenCalled(); expect(revoke).toHaveBeenCalledOnce();
});
it('does not begin decoding or upload when already cancelled', async () => {
  const controller = new AbortController(); controller.abort();
  await expect(uploadDocumentImage('project', new File(['fixture'], 'figure.png', { type: 'image/png' }), controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(create).not.toHaveBeenCalled(); expect(upload).not.toHaveBeenCalled();
});
it('keeps failed image decoding from creating an asset', async () => {
  decode.mockRejectedValue(new Error('Invalid image'));
  await expect(uploadDocumentImage('project', new File(['fixture'], 'figure.png', { type: 'image/png' }), new AbortController().signal)).rejects.toThrow('Invalid image');
  expect(upload).not.toHaveBeenCalled(); expect(revoke).toHaveBeenCalledOnce();
});

it('does not insert an asset when the server omitted or refused the upload', async () => {
  upload.mockResolvedValue({ uploaded: [], failed: [{ name: 'figure.png', error: 'Not stored' }] });
  await expect(uploadDocumentImage('project', new File(['fixture'], 'figure.png', { type: 'image/png' }), new AbortController().signal)).rejects.toThrow('The image could not be uploaded.');
});
it('ignores a successful receipt delivered after cancellation', async () => {
  const controller = new AbortController();
  upload.mockImplementation(async () => { controller.abort(); return { uploaded: [{ path: '_studio-document-assets/late.png' }], failed: [] }; });
  await expect(uploadDocumentImage('project', new File(['fixture'], 'figure.png', { type: 'image/png' }), controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
});
