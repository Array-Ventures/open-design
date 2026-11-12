import { artifactEntry, artifactDashboard, type ArtifactEntry } from './artifact-entry';
import { useArtifactHostState } from './useArtifactHostState';
import { LiveArtifactFeedbackPreview, type ArtifactFeedbackProps } from './LiveArtifactFeedbackPreview';
import { lazy, Suspense, useRef, useState } from 'react';
import { useMotionTransport } from './useMotionTransport';
import { RiSparklingLine, RiArrowLeftLine } from '@remixicon/react';
import { FileViewer, LiveArtifactViewer } from '../FileViewer';
import { liveArtifactSummaryToWorkspaceEntry, type Project, type ProjectFile } from '../../types';
import type { EmbeddedDashboardSummary } from './dashboards';
import { projectKindFromMetadataToTrackingOrLegacyDefault } from '@open-design/contracts/analytics';
import styles from './EmbeddedStudio.module.css';
import { useEmbeddedViewer } from './host-viewer';
import { useMissingWorkbookRestores } from './workbook/use-missing-workbook-restores';
import { MissingWorkbookRestores } from './workbook/MissingWorkbookRestores';
import { Button } from './boardui/button';
import { ARTIFACT_ICON_BUTTON } from './artifact-controls';
import { cx } from './boardui/cx';
import { DocumentSurface } from './document/DocumentSurface';
const WorkbookSurface = lazy(() => import('./workbook/WorkbookSurface').then(module => ({ default: module.WorkbookSurface })));

/** Content surface only. Evebot owns navigation and project management. */
export function ArtifactSurface({ project, files, dashboards, fileName, generation, onRefresh, feedback }: {
  project: Project; files: ProjectFile[]; dashboards: EmbeddedDashboardSummary[];
  fileName: string | null; generation: number; onRefresh(): Promise<unknown>; feedback: ArtifactFeedbackProps;
}) {
  const surface = useRef<HTMLDivElement>(null);
  useMotionTransport(project.id, surface);
  const [heldContent, holdContent] = useState<ArtifactEntry | null>(null);
  const member = useEmbeddedViewer();
  const recovery = useMissingWorkbookRestores(member?.memberId ?? null, project.id, files.map(file => file.name), generation);
  const [choice, choose] = useState<{ scope: string; fileName: string } | null>(null);
  const recoveryFile = choice?.scope === recovery.scopeKey ? choice.fileName : null;
  const projectKind = project.metadata?.embeddedArtifactKind ?? project.metadata?.kind as string | undefined;
  const entry = heldContent ?? artifactEntry(files, fileName, projectKind);
  const file = entry?.file;
  const dashboard = heldContent || entry?.kind === 'workbook' ? undefined : artifactDashboard(files, dashboards, fileName);
  useArtifactHostState(project.id, recoveryFile ? null : entry, !recoveryFile && Boolean(dashboard));
  const viewer = file ? <FileViewer embedded inlineAnnotations {...feedback} projectId={project.id} projectKind={projectKind === 'hyperframes' ? 'hyperframes' : projectKindFromMetadataToTrackingOrLegacyDefault(project.metadata)} file={file} filesRefreshKey={generation} isDeck={entry?.kind === 'deck'} onFileSaved={async () => { await onRefresh(); }} /> : null;
  return <div ref={surface} className={styles.artifactSurface} data-testid="artifact-surface">
    {recoveryFile ? <Suspense fallback={<div role="status">Loading restore status…</div>}><WorkbookSurface key={`recovery:${recovery.scopeKey}:${recoveryFile}`} projectId={project.id} fileName={recoveryFile} title={project.name} sourceStamp="missing-status-only" statusOnly onAccessLost={() => { choose(null); recovery.refresh(); }} />
      <Button variant="ghost" size="small" iconOnly leadingIcon={RiArrowLeftLine} className={cx(ARTIFACT_ICON_BUTTON, 'absolute start-3 top-3 z-40')} aria-label="Back to artifact" title="Back to artifact" onClick={() => { choose(null); recovery.refresh(); void onRefresh(); }} /></Suspense>
      : dashboard ? <LiveArtifactViewer chrome={false} projectId={project.id} liveArtifact={liveArtifactSummaryToWorkspaceEntry(dashboard)}
        previewRenderer={({ url, source }) => <LiveArtifactFeedbackPreview projectId={project.id} previewUrl={url} source={source} files={files} feedback={feedback} />}
        onRefreshArtifacts={async () => { await onRefresh(); }} />
      : file && entry?.kind === 'document' && /\.(html?|md|markdown)$/i.test(file.name) ? <DocumentSurface key={`${project.id}:${file.name}`} projectId={project.id} fileName={file.name} title={file.artifactManifest?.title && file.artifactManifest.title !== file.name ? file.artifactManifest.title : project.name} generation={generation} fallback={viewer} onDirtyChange={dirty => holdContent(dirty ? entry : null)} onSaved={() => { void onRefresh(); }} />
      : file && entry?.kind === 'workbook' ? <Suspense fallback={<div role="status" className="p-4 text-body-2-regular text-text-tertiary">Loading workbook…</div>}><WorkbookSurface projectId={project.id} fileName={file.name} title={project.name} sourceStamp={`${file.mtime}:${file.size}`} onDirtyChange={dirty => holdContent(dirty ? entry : null)} onSaved={() => { void onRefresh(); }} /></Suspense>
      : file ? viewer
      : recovery.files.length || recovery.more || recovery.error || recovery.loading ? null : <div role="status" className={styles.cooking}>
          <div className={styles.cookingPreview} aria-hidden="true">
            <div className={styles.cookingSheet}><span /><span /><span /><div /></div>
            <div className={styles.cookingSpark}><RiSparklingLine size={20} /></div>
          </div>
          <div className={styles.cookingCopy}>
            <h3>Agent is cooking<span aria-hidden="true">…</span></h3>
            <p>Your artifact will take shape here.</p>
          </div>
        </div>}
    {!recoveryFile ? <MissingWorkbookRestores files={recovery.files} more={recovery.more} loading={recovery.loading} error={recovery.error} retry={recovery.refresh} centered={!entry && !dashboard} disabled={Boolean(heldContent)} onOpen={fileName => choose({ scope: recovery.scopeKey, fileName })} /> : null}
  </div>;
}
