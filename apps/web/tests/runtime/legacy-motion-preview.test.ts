import { expect, it } from 'vitest';
import { buildSrcdoc } from '../../src/runtime/srcdoc';
import { prepareLegacyMotionPreview } from '@open-design/contracts/runtime/motion-source-player';
const legacy = '<!doctype html><html><head><title>Reel</title></head><body><main data-composition-id="main" data-duration="21" data-width="1080" data-height="1920"><h1>Reel</h1></main><script>window.__timelines={main:timeline};</script></body></html>';
it('adapts a declared legacy motion preview into the existing player without rewriting its source', () => {
  const result = buildSrcdoc(legacy, { motionPreview: true, legacyMotionVideo: true });
  expect(result).toContain('window.__odMotionPreview=true');
  expect(result).toContain('data-od-motion-source-player');
  expect(result).toContain('window.__timelines={main:timeline}');
  expect(legacy).not.toContain('od-motion-output');
  expect(prepareLegacyMotionPreview(prepareLegacyMotionPreview(legacy))).toBe(prepareLegacyMotionPreview(legacy));
});
it('preserves ordinary, standalone, interactive and frozen behavior', () => {
  expect(buildSrcdoc(legacy, { motionPreview: true })).not.toContain('data-od-motion-source-player');
  expect(buildSrcdoc(legacy, { legacyMotionVideo: true })).not.toContain('data-od-motion-source-player');
  expect(buildSrcdoc(legacy, { motionPreview: true, legacyMotionVideo: true, freezeMotion: true })).not.toContain('data-od-motion-source-player');
  const interactive = legacy.replace('<title>', '<meta name="od-motion-output" content="interactive"><title>');
  expect(prepareLegacyMotionPreview(interactive)).toBe(interactive);
  expect(buildSrcdoc(interactive, { motionPreview: true, legacyMotionVideo: true })).not.toContain('data-od-motion-source-player');
});
it('requires a real complete composition rather than quoted code or invalid dimensions', () => {
  for (const html of [legacy.replace('data-width="1080"', 'data-width="0"'), '<main data-composition-id="example"></main>', `<script>const example=${JSON.stringify(legacy)};</script>`, `<!-- ${legacy} -->`]) expect(prepareLegacyMotionPreview(html)).toBe(html);
});
