import { artifactEntry, artifactDashboard } from './artifact-entry';
import { useArtifactHostState } from './useArtifactHostState';
import { LiveArtifactFeedbackPreview, type ArtifactFeedbackProps } from './LiveArtifactFeedbackPreview';
import { useRef } from 'react';
import { useMotionTransport } from './useMotionTransport';
import { RiSparklingLine } from '@remixicon/react';
import { FileViewer, LiveArtifactViewer } from '../FileViewer';
import { liveArtifactSummaryToWorkspaceEntry, type Project, type ProjectFile } from '../../types';
import type { EmbeddedDashboardSummary } from './dashboards';
import { projectKindFromMetadataToTrackingOrLegacyDefault } from '@open-design/contracts/analytics';
import styles from './EmbeddedStudio.module.css';

/** Content surface only. Evebot owns navigation and project management. */
export function ArtifactSurface({ project, files, dashboards, fileName, generation, onRefresh, feedback }: {
  project: Project; files: ProjectFile[]; dashboards: EmbeddedDashboardSummary[];
  fileName: string | null; generation: number; onRefresh(): Promise<unknown>; feedback: ArtifactFeedbackProps;
}) {
  const surface = useRef<HTMLDivElement>(null);
  useMotionTransport(project.id, surface);
  const entry = artifactEntry(files, fileName, project.metadata?.kind as string | undefined);
  const file = entry?.file;
  const dashboard = artifactDashboard(files, dashboards, fileName);
  useArtifactHostState(project.id, entry, Boolean(dashboard));
  return <div ref={surface} className={styles.artifactSurface} data-testid="artifact-surface">
    {dashboard ? <LiveArtifactViewer chrome={false} projectId={project.id} liveArtifact={liveArtifactSummaryToWorkspaceEntry(dashboard)}
        previewRenderer={({ url, source }) => <LiveArtifactFeedbackPreview projectId={project.id} previewUrl={url} source={source} files={files} feedback={feedback} />}
        onRefreshArtifacts={async () => { await onRefresh(); }} />
      : file ? <FileViewer embedded inlineAnnotations {...feedback} projectId={project.id} projectKind={(project.metadata?.kind as string | undefined) === 'hyperframes' ? 'hyperframes' : projectKindFromMetadataToTrackingOrLegacyDefault(project.metadata)} file={file} filesRefreshKey={generation} isDeck={entry?.kind === 'deck'} onFileSaved={async () => { await onRefresh(); }} />
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
