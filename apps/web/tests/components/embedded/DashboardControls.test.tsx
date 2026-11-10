// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DashboardControls } from '../../../src/components/embedded/DashboardControls';
import { dashboardDetail, type NativeDashboard } from '../../../src/components/embedded/dashboards';
const host = vi.hoisted(() => ({ stage: vi.fn() }));
vi.mock('../../../src/components/embedded/host-context', () => ({ stageHostContext: host.stage }));
const row: NativeDashboard = {
  id: '18a8301a-b6e1-4001-8000-c967b1eab223', projectId: '18a8301a-b6e1-4001-8000-c967b1eab222',
  input: { title: 'Revenue', sourceDirectory: '.', templateFile: 'template.html', dataFile: 'data.json' },
  pinned: false, archived: false, createdAt: '2026-11-08T00:00:00Z', updatedAt: '2026-11-08T00:00:00Z',
  latest: null, ready: null, data: {}, sourceChanged: true, sourceError: null,
};
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.resetAllMocks(); });
describe('embedded dashboard management', () => {
  for (const label of ['Update data with bot', 'Schedule updates']) {
    it(`stages ${label} without fetching data or creating a schedule`, async () => {
      const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
      host.stage.mockResolvedValue(true);
      const onSaved = vi.fn();
      render(<DashboardControls artifact={dashboardDetail(row)} onSaved={onSaved} />);
      fireEvent.click(screen.getByRole('button', { name: label }));
      expect(await screen.findByRole('status')).toHaveTextContent('Send it there to continue');
      expect(host.stage).toHaveBeenCalledWith(row.projectId, expect.stringContaining(`Dashboard: ${row.id}`));
      expect(host.stage.mock.calls[0]![1]).toContain('refreshing-dashboards');
      expect(host.stage.mock.calls[0]![1]).toContain('do not widen visibility or grant connections');
      expect(fetcher).not.toHaveBeenCalled(); expect(onSaved).not.toHaveBeenCalled();
    });
  }
  it('reports a rejected composer handoff and does not claim a scheduled update', async () => {
    host.stage.mockResolvedValue(false);
    render(<DashboardControls artifact={dashboardDetail(row)} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Schedule updates' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be added');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
  it('does not start data work for an archived dashboard', () => {
    render(<DashboardControls artifact={dashboardDetail({ ...row, archived: true })} onSaved={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Update data with bot' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Schedule updates' })).toBeDisabled();
    expect(host.stage).not.toHaveBeenCalled();
  });

  it('archives through native metadata, with explicit retained-files wording', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ ...row, archived: true }));
    vi.stubGlobal('fetch', fetcher);
    const onSaved = vi.fn();
    render(<DashboardControls artifact={dashboardDetail(row)} onSaved={onSaved} />);
    expect(screen.getByText(/Archiving retains files and history/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Archive dashboard' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ status: 'archived' })));
    expect(fetcher).toHaveBeenCalledWith(`/api/studio/projects/${row.projectId}/dashboards/${row.id}`, expect.objectContaining({ method: 'PATCH', body: '{"archived":true}' }));
  });
  it('offers restore on an archived dashboard and never deletes source files', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(row));
    vi.stubGlobal('fetch', fetcher);
    render(<DashboardControls artifact={dashboardDetail({ ...row, archived: true })} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Restore dashboard' }));
    await waitFor(() => expect(fetcher).toHaveBeenCalled());
    expect(fetcher.mock.calls[0]![1]).toMatchObject({ method: 'PATCH', body: '{"archived":false}' });
  });
  it('keeps edits available after access failure without reporting success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 403 })));
    const onSaved = vi.fn();
    render(<DashboardControls artifact={dashboardDetail(row)} onSaved={onSaved} />);
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Dashboard title' }), { target: { value: 'New title' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save title' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('403');
    expect(screen.getByRole('textbox')).toHaveValue('New title');
    expect(onSaved).not.toHaveBeenCalled();
  });
});
