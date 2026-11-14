import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const { JSDOM } = createRequire(import.meta.url)('jsdom');
import { load } from 'cheerio';
import { findSpeakerNotesScriptBlock } from '@open-design/contracts/runtime/speaker-notes';
import { prepareDeckSourceCapture, checkedDeckRuntimeIndex } from '../src/embedded-render/deck-source.js';
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
  // Chromium also proves the getter shim RED: jsdom's native getters live in
  // another realm, so this unit's genuine pre-fix failure is the RegExp case.
  it.each(['call-getter', 'regexp-test'])('retains the original source node under authored %s tampering', (name) => {
    const raw = readFileSync(new URL(`./fixtures/decks/prototype-${name}.html`, import.meta.url));
    const capture = prepareDeckSourceCapture(raw, { ...selection, deckSourceSha256: createHash('sha256').update(raw).digest('hex') });
    const dom = new JSDOM(capture.html, { runScripts: 'dangerously', beforeParse(window: { eval(source: string): unknown }) { window.eval(capture.bootstrap); } });
    try {
      const original = dom.window.document.querySelector('.second');
      expect(dom.window.eval(capture.targetExpression) === original).toBe(true);
      expect(original.isConnected).toBe(true);
      expect(original.textContent).toBe('Original second BLUE');
    } finally { dom.window.close(); }
  });
  it('rejects forged file digest, mismatched path/index, ambiguous stage and unsupported insertion roots', () => {
    expect(() => prepareDeckSourceCapture(bytes, { ...selection, deckSourceSha256: '0'.repeat(64) })).toThrow('source revision');
    expect(() => prepareDeckSourceCapture(bytes, { ...selection, index: 0 })).toThrow('source-owned');
    for (const source of [html + '<deck-stage></deck-stage>', '<deck-stage><img class="slide"></deck-stage>']) {
      const buffer = Buffer.from(source);
      expect(() => prepareDeckSourceCapture(buffer, { ...selection, index: 0, deckSourcePath: 'path-0-0', deckSourceSha256: createHash('sha256').update(buffer).digest('hex') })).toThrow('source-owned');
    }
  });
  it('maps a real body speaker-notes removal to the same source slide, refusing the shifted raw path', () => {
    const notes = '<script id="speaker-notes" type="application/json">["First note","Second note"]</script>';
    const source = '<!doctype html><html><body>' + notes + html + '</body></html>';
    const block = findSpeakerNotesScriptBlock(source);
    expect(block).not.toBeNull();
    expect(source.slice(block!.start, block!.end)).toBe(notes);
    const raw = load(source), visual = load(source.slice(0, block!.start) + source.slice(block!.end));
    const path = (document: ReturnType<typeof load>) => `path-${document('body').children().index(document('deck-stage'))}-${document('deck-stage').children().index(document('section').last())}`;
    expect(raw('body').children().toArray().map(node => node.tagName)).toEqual(['script', 'deck-stage']);
    const rawPath = path(raw), previewPath = path(visual);
    expect(rawPath).toBe('path-1-1');
    expect(previewPath).toBe('path-0-1');
    expect(rawPath).not.toBe(previewPath);
    const buffer = Buffer.from(source), sourceSha256 = createHash('sha256').update(buffer).digest('hex');
    const capture = prepareDeckSourceCapture(buffer, { ...selection, deckSourcePath: previewPath, deckSourceSha256: sourceSha256 });
    const converted = load(capture.html), target = converted(`[${capture.attribute}="${capture.nonce}"]`).filter('section');
    expect(target).toHaveLength(1);
    expect(target.contents().filter((_index, node) => node.type === 'text').text()).toBe('Two');
    expect(converted('#speaker-notes').html()).toBe('["First note","Second note"]');
    expect(() => prepareDeckSourceCapture(buffer, { ...selection, deckSourcePath: rawPath, deckSourceSha256: sourceSha256 })).toThrow('source-owned');
    expect(buffer.toString()).toBe(source);
  });
  it('uses the same strict BOM/non-ASCII decode as preview but hashes the original bytes', () => {
    const raw = Buffer.from('\ufeff' + html.replace('Two', '二 café'));
    expect(prepareDeckSourceCapture(raw, { ...selection, deckSourceSha256: createHash('sha256').update(raw).digest('hex') }).html).toContain('二 café');
    const invalid = Buffer.concat([Buffer.from([0xff]), bytes]);
    expect(() => prepareDeckSourceCapture(invalid, { ...selection, deckSourceSha256: createHash('sha256').update(invalid).digest('hex') })).toThrow('valid UTF-8');
  });
  it('refuses absent or non-finite browser index/count results before navigation', () => {
    expect(checkedDeckRuntimeIndex({ index: 1, count: 2 })).toBe(1);
    for (const value of [undefined, null, {}, { index: undefined, count: 2 }, { index: NaN, count: 2 }, { index: Infinity, count: 2 }, { index: 0.5, count: 2 }, { index: -1, count: 2 }, { index: 2, count: 2 }, { index: 0, count: 201 }, { index: 0, count: 0 }]) expect(() => checkedDeckRuntimeIndex(value)).toThrow('source-owned');
  });
  it('keeps the 200-slide bound at new PNG admission rather than changing existing source collection APIs', () => {
    const raw = Buffer.from('<deck-stage>' + '<section class="slide">One</section>'.repeat(201) + '</deck-stage>');
    expect(() => prepareDeckSourceCapture(raw, { index: 0, deckSourcePath: 'path-0-0', deckSourceSha256: createHash('sha256').update(raw).digest('hex') })).toThrow('source-owned');
  });
  it('requires all new binding fields only for the new deck-image contract, preserving legacy explicit index', () => {
    const input = { fileName: 'index.html', format: 'image', deck: true, index: 1 };
    expect(RenderInput.safeParse(input).success).toBe(true);
    expect(RenderInput.safeParse({ ...input, ...selection }).success).toBe(true);
    for (const patch of [{ deckSourceSha256: sha }, { deckSourcePath: selection.deckSourcePath }, { ...selection, format: 'pdf' }, { ...selection, deck: false }, { ...selection, index: undefined }]) expect(RenderInput.safeParse({ ...input, ...patch }).success).toBe(false);
  });
});
