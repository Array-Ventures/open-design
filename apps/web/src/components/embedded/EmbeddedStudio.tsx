import { RiRefreshLine } from '@remixicon/react';
import { Button as HostButton } from './boardui/button';
import { useEmbeddedMarkup } from './useEmbeddedMarkup';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, ButtonRendererProvider, InputRendererProvider, TextareaRendererProvider, ValueSelectRendererProvider } from '@open-design/components';
import { renderEmbeddedButton, renderEmbeddedInput, renderEmbeddedTextarea, renderEmbeddedValueSelect } from './boardui/controls';
import { projectKindFromMetadataToTrackingOrLegacyDefault } from '@open-design/contracts/analytics';
import { fetchProjectFiles, invalidateProjectFilesCache } from '../../providers/registry';
import { useProjectFileEvents } from '../../providers/project-events';
import { getProject } from '../../state/projects';
import { useRoute } from '../../router';
import { useCoalescedCallback } from '../../hooks/useCoalescedCallback';
import type { OpenTabsState, Project, ProjectFile } from '../../types';
import { ArtifactSurface } from './ArtifactSurface';
import { FileWorkspace } from '../FileWorkspace';
import { IframeKeepAliveProvider, useIframeKeepAlivePool } from '../IframeKeepAlivePool';
import styles from './EmbeddedStudio.module.css';
import { CommentReviewProvider } from './CommentReview';
import { useEmbeddedComments } from './useEmbeddedComments';
import { EmbeddedViewerProvider } from './host-viewer';
import { fetchEmbeddedDashboards, type EmbeddedDashboardSummary } from './dashboards';

/** No App/ProjectView mount: the host owns conversations and agent execution. */
export function EmbeddedStudio() {
  useEffect(() => {
    const typographyClass = styles.hostTypography;
    if (!typographyClass) return;
    document.body.classList.add(typographyClass);
    return () => document.body.classList.remove(typographyClass);
  }, []);
  const route = useRoute();
  if (route.kind !== 'project') return null;
  return (
    <ButtonRendererProvider value={renderEmbeddedButton}>
    <InputRendererProvider value={renderEmbeddedInput}>
    <TextareaRendererProvider value={renderEmbeddedTextarea}>
    <ValueSelectRendererProvider value={renderEmbeddedValueSelect}>
    <IframeKeepAliveProvider key={route.projectId}>
      <EmbeddedViewerProvider projectId={route.projectId}>
        <EmbeddedProject projectId={route.projectId} fileName={route.fileName} />
      </EmbeddedViewerProvider>
    </IframeKeepAliveProvider>
    </ValueSelectRendererProvider>
    </TextareaRendererProvider>
    </InputRendererProvider>
    </ButtonRendererProvider>
  );
}

function EmbeddedProject({ projectId, fileName }: { projectId: string; fileName: string | null }) {
  const pool = useIframeKeepAlivePool();
  const comments = useEmbeddedComments(projectId);
  const [project, setProject] = useState<Project | null>(null);
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const markupNotice = useEmbeddedMarkup(projectId, files.map(file => file.name));
  const [dashboards, setDashboards] = useState<EmbeddedDashboardSummary[] | null>(null);
  const [dashboardError, setDashboardError] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // Tabs are host-frame state for now, not a shared project's global selection.
  const [tabs, setTabs] = useState<OpenTabsState>({ tabs: [], active: null });
  const mounted = useRef(true);
  const request = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; request.current += 1; };
  }, []);

  const refresh = useCallback(async () => {
    const version = ++request.current;
    invalidateProjectFilesCache(projectId);
    try {
      const next = await fetchProjectFiles(projectId, { fresh: true, requireAuthoritative: true });
      if (!mounted.current || request.current !== version) return;
      pool.evictProject(projectId);
      setFiles(next);
      setGeneration((n) => n + 1);
      setError(false);
      return { acceptedGeneration: version };
    } catch (cause) {
      if (mounted.current && request.current === version) {
        setError(true);
        const status = typeof cause === 'object' && cause !== null && 'status' in cause ? Number(cause.status) : 0;
        // Transport failure retains loaded drafts; explicit access loss withdraws the writable surface.
        if ([401, 403, 404].includes(status)) setProject(null);
      }
    }
  }, [projectId, pool]);

  useEffect(() => {
    let cancelled = false;
    void getProject(projectId).then((next) => {
      if (cancelled) return;
      if (!next) { setError(true); return; }
      setProject(next);
      void refresh();
    });
    return () => { cancelled = true; };
  }, [projectId, refresh, attempt]);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const next = await fetchEmbeddedDashboards(projectId, controller.signal);
        if (!controller.signal.aborted) { setDashboards(next); setDashboardError(false); }
      } catch {
        if (!controller.signal.aborted) setDashboardError(true);
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(() => { void load(); }, 2500);
      }
    };
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [projectId]);

  const scheduleRefresh = useCoalescedCallback(refresh, { wait: 80, maxWait: 250 });
  useProjectFileEvents(projectId, project !== null, (event) => {
    if (event.type === 'file-changed') scheduleRefresh();
    if (event.type === 'comment-changed') void comments.refresh();
  }, { onReady: () => { void refresh(); }, onConnectedChange: (connected) => { if (!connected && project) void refresh(); } });

  if (!project || generation === 0) {
    return <div role={error ? 'alert' : 'status'} className={styles.status}>
      {error ? <div>Project unavailable <Button onClick={() => { setError(false); setAttempt((n) => n + 1); }}>Retry</Button></div> : 'Loading project…'}
    </div>;
  }
  return (
    <CommentReviewProvider projectId={projectId} changeStatus={comments.changeStatus}><main className={styles.workspace} data-testid="embedded-studio">
      {error ? <div role="alert" className="flex shrink-0 items-center gap-2 px-3 py-2 text-caption-1-regular text-text-tertiary">Couldn’t refresh.<HostButton variant="ghost" size="small" iconOnly leadingIcon={RiRefreshLine} aria-label="Retry refresh" onClick={() => { void refresh(); }} /></div> : null}
      {markupNotice || comments.notice ? <div role="status" className={styles.feedbackNotice}>{markupNotice ?? comments.notice}</div> : null}
      {dashboardError && (dashboards === null || dashboards.length > 0) ? <div role="alert">Dashboards unavailable. Retrying…</div> : null}
      {new URLSearchParams(window.location.search).get('surface') === 'artifact' ? dashboards === null ? <div role="status" className={styles.status}>Loading preview…</div> : <ArtifactSurface project={project} files={files} dashboards={dashboards ?? []} fileName={fileName} generation={generation} onRefresh={refresh} feedback={{
        previewComments: comments.comments, previewCommentsState: comments.state,
        onRetryPreviewComments: () => { void comments.refresh(); }, onSavePreviewComment: comments.save, onDiscardPreviewCommentWrite: comments.discardSave,
        onRemovePreviewComment: comments.remove, onReorderPreviewComment: comments.reorder,
        onSendBoardCommentAttachments: comments.send,
      }} /> : <FileWorkspace
        embedded
        projectId={projectId}
        projectName={project.name}
        projectKind={projectKindFromMetadataToTrackingOrLegacyDefault(project.metadata)}
        files={files}
        liveArtifacts={dashboards ?? []}
        previewComments={comments.comments}
        previewCommentsState={comments.state}
        onRetryPreviewComments={() => { void comments.refresh(); }}
        onSavePreviewComment={comments.save}
        onDiscardPreviewCommentWrite={comments.discardSave}
        onRemovePreviewComment={comments.remove}
        onReorderPreviewComment={comments.reorder}
        onSendBoardCommentAttachments={comments.send}
        filesRefreshKey={generation}
        filesGeneration={generation}
        onRefreshFiles={refresh}
        onManualFileWritten={() => { void refresh(); }}
        isDeck={project.metadata?.kind === 'deck'}
        tabsState={tabs}
        onTabsStateChange={setTabs}
        routeFileName={fileName}
        openRequest={fileName ? { name: fileName, nonce: 1 } : null}
      />}
    </main></CommentReviewProvider>
  );
}
