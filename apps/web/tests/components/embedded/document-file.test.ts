import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
const write = vi.hoisted(() => vi.fn());
vi.mock('../../../src/providers/registry', () => ({ projectFileUrl: (id: string, name: string) => `/api/projects/${id}/raw/${name}`, writeProjectTextFileDetailed: write }));
import { documentDigest, MAX_DOCUMENT_BYTES, readDocumentFile, saveDocumentFile } from '../../../src/components/embedded/document/document-file';
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });
describe('structured document file boundary', () => {
  it('retains the digest of exact bytes while decoding a UTF-8 BOM for editing', async () => {
    const bytes = new TextEncoder().encode('\uFEFF<p>Hello</p>');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes)));
    const document = await readDocumentFile('project-a', 'doc.html');
    expect(document).toEqual({ html: '<p>Hello</p>', sha256: createHash('sha256').update(bytes).digest('hex') });
    expect(fetch).toHaveBeenCalledWith('/api/projects/project-a/raw/doc.html', expect.objectContaining({ cache: 'no-store' }));
  });
  it('rejects an oversized streaming document even when the response has no length', async () => {
    const cancel = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(MAX_DOCUMENT_BYTES + 1)); }, cancel }))));
    await expect(readDocumentFile('project-a', 'doc.html')).rejects.toThrow('too large');
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('does not decode binary document data as editable content', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([0xff]))));
    await expect(readDocumentFile('project-a', 'doc.html')).rejects.toThrow('UTF-8');
  });
  it('uses the observed digest and reports a conflict without substituting a new baseline', async () => {
    const observed = { html: '<p>Before</p>', sha256: 'a'.repeat(64), versionId: 'original' };
    write.mockResolvedValue({ ok: false, code: 'FILE_CONTENT_CHANGED', status: 409, message: 'Changed' });
    await expect(saveDocumentFile('project-a', 'doc.html', '<p>After</p>', observed)).rejects.toMatchObject({ code: 'FILE_CONTENT_CHANGED', status: 409 });
    expect(write).toHaveBeenCalledWith('project-a', 'doc.html', '<p>After</p>', expect.objectContaining({ expectedContentSha256: observed.sha256, parentVersionId: 'original', versionSource: 'manual' }));
    expect(observed.html).toBe('<p>Before</p>');
  });
  it('returns the immutable revision and new digest only after an accepted save', async () => {
    write.mockResolvedValue({ ok: true, file: {}, version: { id: 'saved' } });
    const html = '<p>After</p>';
    expect(await saveDocumentFile('project-a', 'doc.html', html, { html: '', sha256: 'a'.repeat(64) })).toEqual({ html, sha256: await documentDigest(new TextEncoder().encode(html)), versionId: 'saved' });
  });
});
