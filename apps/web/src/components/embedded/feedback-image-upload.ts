import { uploadProjectFiles } from '../../providers/registry';

type PreparedImages = { operationId: string; paths: string[] };
/** Retain an upload receipt while its handoff is retryable; never upload the same mark twice. */
export class FeedbackImageUpload {
  private pending: { key: string; images: Promise<PreparedImages> } | null = null;
  async prepare(projectId: string, files: File[], context: string): Promise<PreparedImages> {
    if (files.length > 8 || files.some(file => file.size > 25 * 1024 * 1024) || files.reduce((total, file) => total + file.size, 0) > 50 * 1024 * 1024) throw new Error('Feedback images exceed the upload limit.');
    const hashes = await Promise.all(files.map(async file => {
      const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
      return [file.type, file.size, Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('')];
    }));
    const key = JSON.stringify([projectId, context, hashes]);
    if (this.pending?.key === key) return this.pending.images;
    const images = (async () => {
      const result = files.length ? await uploadProjectFiles(projectId, files, '.studio-comments') : { uploaded: [], failed: [] };
      if (result.failed.length || result.uploaded.length !== files.length) throw new Error('The marked image could not be saved.');
      return { operationId: crypto.randomUUID(), paths: result.uploaded.map(file => file.path) };
    })();
    this.pending = { key, images };
    try { return await images; }
    catch (error) { if (this.pending?.images === images) this.pending = null; throw error; }
  }
  clear() { this.pending = null; }
}
