import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { prepareDeckSourceCapture } from '../src/embedded-render/deck-source.js';
import { RenderInput } from '../src/embedded-render/input.js';
const html = '<deck-stage><section class="slide">One</section><section class="slide">Two</section></deck-stage>';
const bytes = Buffer.from(html);
const sha = createHash('sha256').update(bytes).digest('hex');
const selection = { deckSourceSha256: sha, deckSourcePath: 'path-0-1', index: 1 };
describe('source-owned deck image capture', () => {
  it('stamps only conversion bytes and provides a once-only pristine-getter capture before authored descendants', () => {
    const capture = prepareDeckSourceCapture(bytes, selection);
    expect(bytes.toString()).toBe(html);
    expect(capture.html).toContain(`<section class="slide" ${capture.attribute}="${capture.nonce}"><script`);
    expect(capture.html).toContain(`window["__od_capture_${capture.nonce}"]();`);
    expect(capture.bootstrap).toContain("get(Document.prototype,'currentScript')");
    expect(capture.bootstrap).toContain("get(Node.prototype,'parentNode')");
  });
  it('rejects forged file digest, mismatched path/index, ambiguous stage and unsupported insertion roots', () => {
    expect(() => prepareDeckSourceCapture(bytes, { ...selection, deckSourceSha256: '0'.repeat(64) })).toThrow('source revision');
    expect(() => prepareDeckSourceCapture(bytes, { ...selection, index: 0 })).toThrow('source-owned');
    for (const source of [html + '<deck-stage></deck-stage>', '<deck-stage><img class="slide"></deck-stage>']) {
      const buffer = Buffer.from(source);
      expect(() => prepareDeckSourceCapture(buffer, { ...selection, index: 0, deckSourcePath: 'path-0-0', deckSourceSha256: createHash('sha256').update(buffer).digest('hex') })).toThrow('source-owned');
    }
  });
  it('maps notes-free preview paths to the same source slide while preserving original-byte digest', () => {
    const source = '<script id="od-speaker-notes" type="application/json">["note"]</script>' + html;
    const buffer = Buffer.from(source);
    const capture = prepareDeckSourceCapture(buffer, { ...selection, deckSourceSha256: createHash('sha256').update(buffer).digest('hex') });
    expect(capture.html).toContain('>Two</section>');
  });
  it('uses the same strict BOM/non-ASCII decode as preview but hashes the original bytes', () => {
    const raw = Buffer.from('\ufeff' + html.replace('Two', '二 café'));
    expect(prepareDeckSourceCapture(raw, { ...selection, deckSourceSha256: createHash('sha256').update(raw).digest('hex') }).html).toContain('二 café');
    const invalid = Buffer.concat([Buffer.from([0xff]), bytes]);
    expect(() => prepareDeckSourceCapture(invalid, { ...selection, deckSourceSha256: createHash('sha256').update(invalid).digest('hex') })).toThrow('valid UTF-8');
  });
  it('requires all new binding fields only for the new deck-image contract, preserving legacy explicit index', () => {
    const input = { fileName: 'index.html', format: 'image', deck: true, index: 1 };
    expect(RenderInput.safeParse(input).success).toBe(true);
    expect(RenderInput.safeParse({ ...input, ...selection }).success).toBe(true);
    for (const patch of [{ deckSourceSha256: sha }, { deckSourcePath: selection.deckSourcePath }, { ...selection, format: 'pdf' }, { ...selection, deck: false }, { ...selection, index: undefined }]) expect(RenderInput.safeParse({ ...input, ...patch }).success).toBe(false);
  });
});
