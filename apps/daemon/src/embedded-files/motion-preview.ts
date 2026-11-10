import { findRealTagOffset, prependAfterDoctype } from '@open-design/contracts/runtime/html-injection-points';

/** Host project intent fills the missing legacy video marker only in previews. */
export function embeddedMotionPreview(html: string, metadata: unknown, requested: unknown): string {
  const project = metadata as { embeddedHost?: string; kind?: string } | null;
  if (requested !== '1' || project?.embeddedHost !== 'evebot' || !['hyperframes', 'video'].includes(project.kind ?? '')) return html;
  // An explicit interactive or video marker always belongs to the author.
  if (findRealTagOffset(html, /<meta\b[^>]*\bname\s*=\s*["']od-motion-output["']/i) >= 0) return html;
  if (findRealTagOffset(html, /<[^/!][^>]*\bdata-composition-id\s*=/i) < 0) return html;
  return prependAfterDoctype(html, '<meta name="od-motion-output" content="video">');
}
