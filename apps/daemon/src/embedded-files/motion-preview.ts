import { prepareLegacyMotionPreview } from '@open-design/contracts/runtime/motion-source-player';

/** Host project intent fills the missing legacy video marker only in previews. */
export function embeddedMotionPreview(html: string, metadata: unknown, requested: unknown): string {
  const project = metadata as { embeddedHost?: string; kind?: string } | null;
  if (requested !== '1' || project?.embeddedHost !== 'evebot' || !['hyperframes', 'video'].includes(project.kind ?? '')) return html;
  return prepareLegacyMotionPreview(html);
}
