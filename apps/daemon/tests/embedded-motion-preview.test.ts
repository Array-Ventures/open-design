import { describe, expect, it } from 'vitest';
import { embeddedMotionPreview } from '../src/embedded-files/motion-preview.js';
import { injectMotionSourcePlayer } from '@open-design/contracts/runtime/motion-source-player';
const source = '<!doctype html><html><body><div data-composition-id="main"></div></body></html>';
const metadata = { embeddedHost: 'evebot', kind: 'hyperframes' };
describe('embedded motion preview', () => {
  it('uses explicit host video intent to activate the existing source player', () => {
    const preview = embeddedMotionPreview(source, metadata, '1');
    expect(preview).toContain('<meta name="od-motion-output" content="video">');
    expect(injectMotionSourcePlayer(preview)).toContain('data-od-motion-source-player');
    expect(embeddedMotionPreview(preview, metadata, '1')).toBe(preview);
  });
  it('preserves authored interactive mode, ordinary projects and non-preview reads', () => {
    const interactive = '<meta name="od-motion-output" content="interactive">' + source;
    expect(embeddedMotionPreview(interactive, metadata, '1')).toBe(interactive);
    expect(embeddedMotionPreview(source, { ...metadata, kind: 'prototype' }, '1')).toBe(source);
    expect(embeddedMotionPreview(source, { kind: 'hyperframes' }, '1')).toBe(source);
    expect(embeddedMotionPreview(source, metadata, undefined)).toBe(source);
    expect(embeddedMotionPreview('<p>No composition</p>', metadata, '1')).toBe('<p>No composition</p>');
  });
});
