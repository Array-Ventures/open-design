import { RiSparklingLine } from '@remixicon/react';
import { FileViewer, LiveArtifactViewer } from '../FileViewer';
import { liveArtifactSummaryToWorkspaceEntry, type Project, type ProjectFile } from '../../types';
import type { LiveArtifactSummary } from '@open-design/contracts';
import { projectKindFromMetadataToTrackingOrLegacyDefault } from '@open-design/contracts/analytics';
import styles from './EmbeddedStudio.module.css';

/** Content surface only. Evebot owns navigation and project management. */
export function ArtifactSurface({ project, files, dashboards, fileName, generation, onRefresh }: {
  project: Project; files: ProjectFile[]; dashboards: LiveArtifactSummary[];
  fileName: string | null; generation: number; onRefresh(): Promise<unknown>;
}) {
  const candidates = files.filter(file => !file.name.startsWith('.') && !file.name.split('/').some(part => part.startsWith('.')));
  const file = (fileName ? candidates.find(file => file.name === fileName) : undefined)
    ?? candidates.find(file => file.name === 'index.html')
    ?? candidates.find(file => file.kind === 'html')
    ?? candidates.find(file => ['image', 'video', 'audio', 'pdf', 'sketch'].includes(file.kind))
    ?? candidates.find(file => /\.(md|txt)$/i.test(file.name));
  const dashboard = !fileName ? dashboards.find(item => item.status !== 'archived') : undefined;
  return <div className={styles.artifactSurface} data-testid="artifact-surface">
    {dashboard ? <LiveArtifactViewer chrome={false} projectId={project.id} liveArtifact={liveArtifactSummaryToWorkspaceEntry(dashboard)} onRefreshArtifacts={async () => { await onRefresh(); }} />
      : file ? <FileViewer embedded projectId={project.id} projectKind={projectKindFromMetadataToTrackingOrLegacyDefault(project.metadata)} file={file} filesRefreshKey={generation} isDeck={project.metadata?.kind === 'deck'} onFileSaved={async () => { await onRefresh(); }} />
      : <div role="status" className={styles.cooking}>
          <div className={styles.cookingPreview} aria-hidden="true">
            <div className={styles.cookingSheet}><span /><span /><span /><div /></div>
            <div className={styles.cookingSpark}><RiSparklingLine size={20} /></div>
          </div>
          <div className={styles.cookingCopy}>
            <h3>Agent is cooking<span aria-hidden="true">…</span></h3>
            <p>Your artifact will take shape here.</p>
          </div>
        </div>}
  </div>;
}
