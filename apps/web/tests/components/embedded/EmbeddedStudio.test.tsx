// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project, ProjectFile } from '../../../src/types';
import { PooledIframe, previewIframeKeepAliveKey } from '../../../src/components/IframeKeepAlivePool';
import type { ProjectEvent } from '../../../src/providers/project-events';

const state = vi.hoisted(() => ({
  getProject: vi.fn(), files: vi.fn(), dashboards: vi.fn(), invalidate: vi.fn(), identityFrame: false,
  event: null as null | ((event: ProjectEvent) => void),
  ready: null as null | (() => void),
}));
vi.mock('../../../src/components/embedded/dashboards', () => ({ fetchEmbeddedDashboards: state.dashboards }));
vi.mock('../../../src/state/projects', () => ({ getProject: state.getProject }));
vi.mock('../../../src/router', () => ({ useRoute: () => ({ kind: 'project', projectId: 'project-a', fileName: 'index.html' }) }));
vi.mock('../../../src/providers/registry', () => ({ fetchProjectFiles: state.files, invalidateProjectFilesCache: state.invalidate, fetchPreviewComments: async () => [] }));
vi.mock('../../../src/providers/project-events', () => ({
  useProjectFileEvents: (_id: string, enabled: boolean, event: typeof state.event, options: { onReady: () => void }) => {
    state.event = enabled ? event : null;
    state.ready = enabled ? options.onReady : null;
  },
}));
vi.mock('../../../src/components/embedded/ArtifactSurface', () => ({ ArtifactSurface: () => <div>Artifact surface</div> }));
vi.mock('../../../src/components/FileWorkspace', () => ({
  FileWorkspace: (props: { embedded: boolean; files: ProjectFile[]; onRefreshFiles: () => Promise<unknown>; onManualFileWritten: () => void; chatConfig?: unknown; filesRefreshKey?: number }) => (
    <div>
      <span>{props.embedded && !props.chatConfig ? 'Host-owned agent' : 'Unexpected chat'}</span>
      <span>{props.files.map((file) => file.name).join(',')}</span>
      <span data-testid="workspace-generation">{props.filesRefreshKey}</span>
      {state.identityFrame ? <PooledIframe cacheKey={previewIframeKeepAliveKey('project-a', 'index.html')} data-testid="identity-preview" src="about:blank" /> : null}
      <button onClick={() => void props.onRefreshFiles()}>Refresh</button>
      <button onClick={props.onManualFileWritten}>Saved in Studio</button>
    </div>
  ),
}));
import { EmbeddedStudio } from '../../../src/components/embedded/EmbeddedStudio';
import studioStyles from '../../../src/components/embedded/EmbeddedStudio.module.css';

const project: Project = { id: 'project-a', name: 'Dashboard', skillId: null, designSystemId: null, createdAt: 1, updatedAt: 1 };
const file = (name: string) => ({ name, path: name, type: 'file', size: 20, mtime: 1, kind: 'html', mime: 'text/html' }) as ProjectFile;

beforeEach(() => {
  state.identityFrame = false;
  state.dashboards.mockResolvedValue([]);
  state.getProject.mockResolvedValue(project);
  state.files.mockResolvedValue([file('index.html')]);
});
afterEach(() => { cleanup(); vi.resetAllMocks(); state.event = null; state.ready = null; });

describe('host-owned embedded Studio', () => {
  it('lets the workspace retain a managed preview frame across file-list reconciliation', async () => {
    state.identityFrame = true;
    render(<EmbeddedStudio />);
    await screen.findByText('Host-owned agent');
    const frame = await screen.findByTestId('identity-preview');
    const generation = Number(screen.getByTestId('workspace-generation').textContent);
    act(() => { state.ready?.(); });
    await waitFor(() => expect(Number(screen.getByTestId('workspace-generation').textContent)).toBeGreaterThan(generation));
    expect(screen.getByTestId('identity-preview')).toBe(frame);
  });

  it('scopes host typography to the embedded document lifetime', async () => {
    const { unmount } = render(<EmbeddedStudio />);
    await screen.findByText('Host-owned agent');
    expect(document.body).toHaveClass(studioStyles.hostTypography!);
    unmount();
    expect(document.body).not.toHaveClass(studioStyles.hostTypography!);
  });

  it('loads a real project listing without any chat configuration', async () => {
    render(<EmbeddedStudio />);
    expect(await screen.findByText('Host-owned agent')).toBeInTheDocument();
    expect(screen.getByText('index.html')).toBeInTheDocument();
    expect(state.files).toHaveBeenCalledWith('project-a', expect.objectContaining({ requireAuthoritative: true }));
  });

  it('does not mount a write-capable workspace when project access fails', async () => {
    state.getProject.mockResolvedValue(null);
    render(<EmbeddedStudio />);
    expect(await screen.findByText('Project unavailable')).toBeInTheDocument();
    expect(screen.queryByTestId('embedded-studio')).not.toBeInTheDocument();
    expect(state.files).not.toHaveBeenCalled();
  });

  it('reconciles external edits when the event stream connects or reconnects', async () => {
    render(<EmbeddedStudio />);
    await screen.findByText('index.html');
    state.files.mockResolvedValue([file('updated.html')]);
    await act(async () => { state.ready?.(); });
    expect(await screen.findByText('updated.html')).toBeInTheDocument();
    state.files.mockResolvedValue([file('after-reconnect.html')]);
    await act(async () => { state.ready?.(); });
    expect(await screen.findByText('after-reconnect.html')).toBeInTheDocument();
  });

  it('keeps a newer file snapshot when an older refresh finishes late', async () => {
    render(<EmbeddedStudio />);
    await screen.findByText('index.html');
    let finishOld!: (files: ProjectFile[]) => void;
    state.files.mockReturnValueOnce(new Promise<ProjectFile[]>((resolve) => { finishOld = resolve; }));
    act(() => { screen.getByText('Refresh').click(); });
    state.files.mockResolvedValueOnce([file('newest.html')]);
    await act(async () => { state.ready?.(); });
    expect(await screen.findByText('newest.html')).toBeInTheDocument();
    await act(async () => { finishOld([file('stale.html')]); });
    expect(screen.getByText('newest.html')).toBeInTheDocument();
    expect(screen.queryByText('stale.html')).not.toBeInTheDocument();
  });

  it('retains the mounted preview and its state when a refresh has a transport failure', async () => {
    state.identityFrame = true;
    render(<EmbeddedStudio />);
    await screen.findByText('Host-owned agent');
    const frame = await screen.findByTestId('identity-preview');
    state.files.mockRejectedValueOnce(new Error('Connection interrupted'));
    act(() => { screen.getByText('Saved in Studio').click(); });
    await waitFor(() => expect(screen.getByText('Couldn’t refresh.')).toBeInTheDocument());
    expect(screen.getByTestId('identity-preview')).toBe(frame);
    state.files.mockResolvedValueOnce([file('index.html')]);
    act(() => { screen.getByRole('button', { name: 'Retry refresh' }).click(); });
    await waitFor(() => expect(screen.queryByText('Couldn’t refresh.')).toBeNull());
    expect(screen.getByTestId('identity-preview')).toBe(frame);
  });

  it('withdraws the writable workspace when a saved-edit refresh explicitly denies access', async () => {
    render(<EmbeddedStudio />);
    await screen.findByText('index.html');
    state.files.mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { status: 403 }));
    act(() => { screen.getByText('Saved in Studio').click(); });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Project unavailable'));
    expect(screen.queryByTestId('embedded-studio')).not.toBeInTheDocument();
  });
});

it('does not show unrelated dashboard failure chrome after a known-empty listing', async () => {
  state.identityFrame = true; render(<EmbeddedStudio />); await screen.findByText('Host-owned agent');
  const frame = screen.getByTestId('identity-preview');
  await waitFor(() => expect(state.dashboards).toHaveBeenCalledTimes(1));
  state.dashboards.mockRejectedValueOnce(new Error('Network interrupted'));
  await waitFor(() => expect(state.dashboards).toHaveBeenCalledTimes(2), { timeout: 3500 });
  expect(screen.queryByText('Dashboards unavailable. Retrying…')).toBeNull();
  expect(screen.getByTestId('identity-preview')).toBe(frame);
});
it('retains a useful failure message when the initial dashboard authority check fails', async () => {
  state.dashboards.mockRejectedValueOnce(new Error('Unavailable'));
  render(<EmbeddedStudio />);
  expect(await screen.findByText('Dashboards unavailable. Retrying…')).toBeInTheDocument();
});
