import { artifactEntry, artifactDashboard, type ArtifactEntry } from './artifact-entry';
import { useArtifactHostState } from './useArtifactHostState';
import { LiveArtifactFeedbackPreview, type ArtifactFeedbackProps } from './LiveArtifactFeedbackPreview';
import { useRef, useState } from 'react';
import { useMotionTransport } from './useMotionTransport';
import { RiSparklingLine } from '@remixicon/react';
import { FileViewer, LiveArtifactViewer } from '../FileViewer';
import { liveArtifactSummaryToWorkspaceEntry, type Project, type ProjectFile } from '../../types';
import type { EmbeddedDashboardSummary } from './dashboards';
import { projectKindFromMetadataToTrackingOrLegacyDefault } from '@open-design/contracts/analytics';
import styles from './EmbeddedStudio.module.css';
import { DocumentSurface } from './document/DocumentSurface';

/** Content surface only. Evebot owns navigation and project management. */
export function ArtifactSurface({ project, files, dashboards, fileName, generation, onRefresh, feedback }: {
  project: Project; files: ProjectFile[]; dashboards: EmbeddedDashboardSummary[];
  fileName: string | null; generation: number; onRefresh(): Promise<unknown>; feedback: ArtifactFeedbackProps;
}) {
  const surface = useRef<HTMLDivElement>(null);
  useMotionTransport(project.id, surface);
  const [heldDocument, holdDocument] = useState<ArtifactEntry | null>(null);
  const entry = heldDocument ?? artifactEntry(files, fileName, project.metadata?.kind as string | undefined);
  const file = entry?.file;
  const dashboard = heldDocument ? undefined : artifactDashboard(files, dashboards, fileName);
  useArtifactHostState(project.id, entry, Boolean(dashboard));
  const viewer = file ? <FileViewer embedded inlineAnnotations {...feedback} projectId={project.id} projectKind={(project.metadata?.kind as string | undefined) === 'hyperframes' ? 'hyperframes' : projectKindFromMetadataToTrackingOrLegacyDefault(project.metadata)} file={file} filesRefreshKey={generation} isDeck={entry?.kind === 'deck'} onFileSaved={async () => { await onRefresh(); }} /> : null;
  return <div ref={surface} className={styles.artifactSurface} data-testid="artifact-surface">
    {dashboard ? <LiveArtifactViewer chrome={false} projectId={project.id} liveArtifact={liveArtifactSummaryToWorkspaceEntry(dashboard)}
        previewRenderer={({ url, source }) => <LiveArtifactFeedbackPreview projectId={project.id} previewUrl={url} source={source} files={files} feedback={feedback} />}
        onRefreshArtifacts={async () => { await onRefresh(); }} />
      : file && entry?.kind === 'document' && /\.html?$/i.test(file.name) ? <DocumentSurface key={`${project.id}:${file.name}`} projectId={project.id} fileName={file.name} title={file.artifactManifest?.title && file.artifactManifest.title !== file.name ? file.artifactManifest.title : project.name} generation={generation} fallback={viewer} onDirtyChange={dirty => holdDocument(dirty ? entry : null)} onSaved={() => { void onRefresh(); }} />
      : file ? viewer
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
