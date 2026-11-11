import type { DocumentFile } from './document-file';

export type DocumentWriteState = { dirty: boolean; saving: boolean; error: string | null };
/** Serialize saves against the last acknowledged bytes; edits during a save remain queued. */
export class DocumentWriter {
  private desired: string;
  private acknowledged: string;
  private uncertain: string | null = null;
  private running: Promise<void> | null = null;
  private active = true;
  private error: string | null = null;
  constructor(private observed: DocumentFile, initial: string,
    private readonly write: (html: string, base: DocumentFile) => Promise<DocumentFile>,
    private readonly notify: (state: DocumentWriteState) => void) {
    this.desired = this.acknowledged = initial;
  }
  state(): DocumentWriteState { return { dirty: this.desired !== this.acknowledged || this.running !== null || this.uncertain !== null, saving: this.running !== null, error: this.error }; }
  private publish() { if (this.active) this.notify(this.state()); }
  start() { this.active = true; this.publish(); }
  stop() { this.active = false; }
  change(html: string) { this.desired = html; this.publish(); }
  flush(): Promise<void> {
    if (this.running) return this.running;
    if (!this.active || !this.state().dirty) return Promise.resolve();
    this.error = null;
    const run = async () => {
      while (this.active && (this.uncertain !== null || this.desired !== this.acknowledged)) {
        const content = this.uncertain ?? this.desired;
        this.uncertain = content;
        try {
          this.observed = await this.write(content, this.observed);
          this.acknowledged = content;
          this.uncertain = null;
        } catch (error) {
          const status = typeof error === 'object' && error !== null && 'status' in error ? Number(error.status) : 0;
          if ([400, 401, 403, 404, 409, 413, 415, 422].includes(status)) this.uncertain = null;
          this.error = error instanceof Error ? error.message : 'The document could not be saved.';
          break;
        }
      }
    };
    this.running = run().finally(() => { this.running = null; this.publish(); });
    this.publish();
    return this.running;
  }
}
