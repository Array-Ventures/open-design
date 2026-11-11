// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Project, ProjectFile } from '../../../src/types';
import type { EmbeddedDashboardSummary } from '../../../src/components/embedded/dashboards';
vi.mock('../../../src/components/FileViewer', () => ({ FileViewer: ({ file }: { file: ProjectFile }) => <div data-testid="app-preview">{file.name}</div>, LiveArtifactViewer: () => <div data-testid="dashboard-preview">Rendered snapshot</div> }));
vi.mock('../../../src/components/embedded/useMotionTransport', () => ({ useMotionTransport: () => {} }));
import { ArtifactSurface } from '../../../src/components/embedded/ArtifactSurface';
afterEach(cleanup);
const project = { id: 'project-a', metadata: { kind: 'prototype' } } as unknown as Project;
const file = (name: string) => ({ name, kind: 'html' }) as ProjectFile;
const dashboard = (hostTemplatePath: string) => ({ id: 'dashboard-a', status: 'active', hostTemplatePath }) as EmbeddedDashboardSummary;
function open(files: ProjectFile[], dashboards: EmbeddedDashboardSummary[], fileName: string | null = null) {
  render(<ArtifactSurface project={project} files={files} dashboards={dashboards} fileName={fileName} generation={1} onRefresh={async () => {}} feedback={{}} />);
}
describe('default artifact experience', () => {
  it('opens a separate working app instead of its older dashboard snapshot', () => {
    open([file('index.html'), file('dashboard.html')], [dashboard('dashboard.html')]);
    expect(screen.getByTestId('app-preview')).toHaveTextContent('index.html');
    expect(screen.queryByTestId('dashboard-preview')).toBeNull();
  });
  it('keeps a registered index template on its rendered snapshot', () => {
    open([file('index.html')], [dashboard('index.html')]);
    expect(screen.getByTestId('dashboard-preview')).toBeVisible();
    expect(screen.queryByTestId('app-preview')).toBeNull();
  });
  it('honors an explicit file selection', () => {
    open([file('index.html'), file('other.html')], [dashboard('index.html')], 'other.html');
    expect(screen.getByTestId('app-preview')).toHaveTextContent('other.html');
  });
});
