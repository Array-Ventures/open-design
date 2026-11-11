import { canonicalCommentJson, type PreviewComment, type PreviewCommentTarget, type PreviewCommentUpsertRequest } from '@open-design/contracts';
import { FeedbackImageUpload } from './feedback-image-upload';
export type RootCommentAttempt = { input: PreviewCommentUpsertRequest; files: File[]; superseded: boolean };

/** Capture a request before POST; uncertain responses reuse its uploaded paths and UUID. */
export class RootCommentWrite {
  private upload = new FeedbackImageUpload();
  private pending: { key: string; scope: string; input: PreviewCommentUpsertRequest; files: File[]; uncertain: boolean } | null = null;
  async prepare(projectId: string, target: PreviewCommentTarget, note: string, files: File[], baseline: PreviewComment | undefined, signal: AbortSignal): Promise<RootCommentAttempt> {
    const scope = canonicalCommentJson([projectId, target.filePath, target.elementId, target.selector, baseline?.id]);
    if (this.pending && this.pending.scope !== scope) this.clear();
    const previous = this.pending;
    if (previous?.uncertain) {
      const superseded = canonicalCommentJson([target, note, baseline?.editToken]) !== canonicalCommentJson([previous.input.target, previous.input.note, previous.input.expectedEditToken])
        || files.length !== previous.files.length || files.some((file, index) => file !== previous.files[index]);
      return { input: previous.input, files: previous.files, superseded };
    }
    const kept = baseline?.attachments ?? [];
    if (kept.length + files.length > 8) throw Error('Use at most eight comment images.');
    const result = await this.upload.prepare(projectId, files, baseline?.id ?? 'new-comment', signal);
    const attachments = [...kept.map(image => ({ ...image })), ...result.paths.map((path, index) => ({ path, name: (files[index]!.name.replace(/[\r\n\0]/g, ' ').trim() || 'Image').slice(0, 200) }))];
    const payload = { ...(baseline ? { id: baseline.id, expectedEditToken: baseline.editToken } : {}), target: structuredClone(target), note, attachments };
    const key = canonicalCommentJson(payload);
    if (this.pending?.key === key) return { input: this.pending.input, files: this.pending.files, superseded: false };
    const input = { ...payload, operationId: crypto.randomUUID() };
    this.pending = { key, scope, input, files: [...files], uncertain: false };
    return { input, files: this.pending.files, superseded: false };
  }
  uncertain(input: PreviewCommentUpsertRequest) { if (this.pending?.input === input) this.pending.uncertain = true; }
  /** A definitive conflict may start a new operation after explicit rebase, retaining uploaded bytes. */
  rejected(input: PreviewCommentUpsertRequest) { if (this.pending?.input === input) this.pending = null; }
  clear() { this.pending = null; this.upload.clear(); }
}
