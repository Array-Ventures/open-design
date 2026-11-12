// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Project, ProjectFile } from '../../../src/types';
import type { EmbeddedDashboardSummary } from '../../../src/components/embedded/dashboards';
vi.mock('../../../src/components/FileViewer', () => ({ FileViewer: ({ file }: { file: ProjectFile }) => <div data-testid="app-preview">{file.name}</div>, LiveArtifactViewer: () => <div data-testid="dashboard-preview">Rendered snapshot</div> }));
vi.mock('../../../src/components/embedded/useMotionTransport', () => ({ useMotionTransport: () => {} }));
vi.mock('../../../src/components/embedded/workbook/WorkbookSurface', () => ({ WorkbookSurface: ({ fileName }: { fileName: string }) => <div data-testid="workbook-preview">{fileName}</div> }));
vi.mock('../../../src/components/embedded/document/DocumentSurface', () => ({ DocumentSurface: ({ fileName, onDirtyChange }: { fileName: string; onDirtyChange(dirty: boolean): void }) => <div data-testid="document-preview">{fileName}<button onClick={() => onDirtyChange(true)}>Unsaved document edit</button><button onClick={() => onDirtyChange(false)}>Saved document edit</button></div> }));
import { ArtifactSurface } from '../../../src/components/embedded/ArtifactSurface';
afterEach(cleanup);
const project = { id: 'project-a', metadata: { kind: 'prototype' } } as unknown as Project;
const file = (name: string) => ({ name, kind: 'html' }) as ProjectFile;
const dashboard = (hostTemplatePath: string) => ({ id: 'dashboard-a', status: 'active', hostTemplatePath }) as EmbeddedDashboardSummary;
function open(files: ProjectFile[], dashboards: EmbeddedDashboardSummary[], fileName: string | null = null) {
  render(<ArtifactSurface project={project} files={files} dashboards={dashboards} fileName={fileName} generation={1} onRefresh={async () => {}} feedback={{}} />);
}
describe('default artifact experience', () => {
  it('uses the workbook surface rather than supporting HTML or a dashboard', async () => {
    render(<ArtifactSurface project={{ ...project, metadata: { kind: 'other', embeddedArtifactKind: 'workbook' } }} files={[file('index.html'), file('book.xlsx')]} dashboards={[dashboard('index.html')]} fileName={null} generation={1} onRefresh={async () => {}} feedback={{}} />);
    expect(await screen.findByTestId('workbook-preview')).toHaveTextContent('book.xlsx'); expect(screen.queryByTestId('dashboard-preview')).toBeNull();
  });
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

it('retains a dirty document when external file reconciliation changes the default entry', () => {
  const docProject = { ...project, metadata: { kind: 'document' } } as unknown as Project; // Embedded host kind; the upstream taxonomy stays unchanged.
  const surface = (files: ProjectFile[], generation: number) => <ArtifactSurface project={docProject} files={files} dashboards={[]} fileName={null} generation={generation} onRefresh={async () => {}} feedback={{}} />;
  const view = render(surface([file('index.html')], 1));
  fireEvent.click(screen.getByRole('button', { name: 'Unsaved document edit' }));
  const before = screen.getByTestId('document-preview');
  view.rerender(surface([file('other.html')], 2));
  expect(screen.getByTestId('document-preview')).toBe(before); expect(before).toHaveTextContent('index.html');
  fireEvent.click(screen.getByRole('button', { name: 'Saved document edit' }));
  expect(screen.getByTestId('document-preview')).toHaveTextContent('other.html');
});
