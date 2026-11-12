import type { ProjectFile } from '../../types';
import type { EmbeddedDashboardSummary } from './dashboards';

export type ArtifactEntry = { file: ProjectFile; kind: 'app' | 'deck' | 'document' | 'workbook' | 'image' | 'video' | 'audio' | 'other'; title: string };

function ordinary(file: ProjectFile): boolean {
  return file.type !== 'dir' && !['_studio-comments/', '_studio-document-assets/'].some(prefix => file.name.startsWith(prefix)) && file.name.split('/').every(part => part && part !== '.' && part !== '..' && !part.startsWith('.') && !/[\\\u0000]/.test(part));
}

/** Prefer declared primary artifacts; filename inference is a legacy fallback. */
export function artifactEntry(files: ProjectFile[], selected: string | null, projectKind?: string): ArtifactEntry | null {
  const candidates = files.filter(ordinary);
  const file = (selected ? candidates.find(item => item.name === selected) : undefined)
    ?? candidates.find(item => item.artifactManifest?.primary === true || item.artifactManifest?.primary === item.name)
    ?? candidates.find(item => ['image', 'video', 'audio'].includes(projectKind ?? '') && item.kind === projectKind)
    ?? candidates.find(item => projectKind === 'document' && /\.(md|markdown)$/i.test(item.name))
    ?? candidates.find(item => projectKind === 'workbook' && /\.xlsx$/i.test(item.name))
    ?? candidates.find(item => item.name === 'index.html')
    ?? candidates.find(item => item.kind === 'html')
    ?? candidates.find(item => ['image', 'video', 'audio', 'pdf', 'sketch'].includes(item.kind))
    ?? candidates.find(item => /\.xlsx$/i.test(item.name))
    ?? candidates.find(item => /\.(md|markdown|txt)$/i.test(item.name));
  if (!file) return null;
  const declared = file.artifactManifest?.kind;
  const kind = /\.xlsx$/i.test(file.name) ? 'workbook' : declared === 'deck' || projectKind === 'deck' ? 'deck'
    : declared === 'markdown-document' || projectKind === 'document' || /\.(md|markdown|txt)$/i.test(file.name) ? 'document'
    : file.kind === 'image' || file.kind === 'sketch' ? 'image'
    : file.kind === 'video' || file.kind === 'audio' ? file.kind
    : file.kind === 'html' ? 'app' : 'other';
  return { file, kind, title: file.artifactManifest?.title || file.name };
}

export function artifactDashboard(files: ProjectFile[], dashboards: EmbeddedDashboardSummary[], selected: string | null): EmbeddedDashboardSummary | undefined {
  if (selected) return;
  const active = dashboards.filter(item => item.status !== 'archived');
  const primary = files.find(file => ordinary(file) && (file.artifactManifest?.primary === true || file.artifactManifest?.primary === file.name));
  if (primary) return active.find(item => item.hostTemplatePath === primary.name);
  const app = files.find(item => ordinary(item) && item.name === 'index.html');
  return app && active.every(item => item.hostTemplatePath !== app.name) ? undefined : active[0];
}
