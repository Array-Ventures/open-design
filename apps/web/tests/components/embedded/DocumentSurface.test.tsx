// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DocumentSurface } from '../../../src/components/embedded/document/DocumentSurface';
const read = vi.hoisted(() => vi.fn());
const consent = vi.hoisted(() => vi.fn());
vi.mock('../../../src/components/embedded/host-context', () => ({ confirmHostFeedbackDiscard: consent }));
const actor = vi.hoisted(() => ({ id: 'person-a' as string | null }));
vi.mock('../../../src/components/embedded/host-viewer', () => ({ useEmbeddedViewer: () => actor.id ? ({ memberId: actor.id }) : null }));
const state = vi.hoisted(() => ({ mounts: 0, editor: null as null | { observed: { html: string; sha256: string }; onSaved(value: { html: string; sha256: string }): void; onDirtyChange(dirty: boolean, saving: boolean): void; onWriteError(error: string | null): void } }));
vi.mock('../../../src/components/embedded/document/document-file', () => ({ readDocumentFile: read }));
vi.mock('../../../src/components/embedded/document/DocumentEditor', async () => {
  const { useState } = await import('react');
  return { DocumentEditor: (props: NonNullable<typeof state.editor>) => { state.editor = props; const [mount] = useState(() => ++state.mounts); return <div>Rich editor<span data-testid="editor-mount">{mount}</span></div>; } };
});
afterEach(() => { cleanup(); vi.clearAllMocks(); state.mounts = 0; state.editor = null; actor.id = 'person-a'; });
it.each([
  '<html data-eve-document="1"><head><style>p{color:red}</style></head><body><p>Authored styling</p></body></html>',
  '<html data-eve-document="1"><body style="background:red"><p>Authored body</p></body></html>',
  '<html data-eve-document="1"><body><p class="custom">Authored class</p></body></html>',
  '<html data-eve-document="1"><body><a href="ftp://example.test/file">Unsupported link</a></body></html>',
  '<html data-eve-document="1"><body><img src="picture.png" srcset="other.png 2x"></body></html>',
  '<html data-eve-document="1"><body><img src="../outside.png"></body></html>',
  '<html><body><p>Authored legacy content</p></body></html>',
  '<html data-eve-document="1"><body><hr><p>Rule</p></body></html>',
  '<html data-eve-document="1"><body><table><caption>Caption</caption><tr><td>1</td></tr></table></body></html>',
  '<html data-eve-document="1"><body><img src="https://outside.fixture.test/picture.png"><p>Illustrated document</p></body></html>',
])('retains the actual viewer for content that cannot yet round-trip through the editor', async html => {
  read.mockResolvedValue({ html, sha256: 'original' });
  render(<DocumentSurface projectId="fixture" fileName="report.html" title="Report" fallback={<div>Original viewer</div>} onSaved={() => {}} />);
  expect(await screen.findByText('Original viewer')).toBeInTheDocument(); expect(screen.queryByText('Rich editor')).toBeNull();
});
it('opens an opted-in supported semantic document in the rich surface', async () => {
  read.mockResolvedValue({ html: '<html data-eve-document="1"><body><h1>Report</h1><p>Ready</p></body></html>', sha256: 'original' });
  render(<DocumentSurface projectId="fixture" fileName="report.html" title="Report" fallback={<div>Original viewer</div>} onSaved={() => {}} />);
  expect(await screen.findByText('Rich editor')).toBeInTheDocument();
});

const version = (name: string) => ({ html: `<html data-eve-document="1"><body><p>${name}</p></body></html>`, sha256: name });
const surface = (generation: number) => <DocumentSurface projectId="fixture" fileName="report.html" title="Report" generation={generation} fallback={<div>Original viewer</div>} onSaved={() => {}} />;
it('replaces a clean editor when an external generation changes its bytes', async () => {
  read.mockResolvedValue(version('first')); const view = render(surface(1)); await screen.findByText('Rich editor');
  const before = screen.getByTestId('editor-mount').textContent;
  read.mockResolvedValue(version('external')); view.rerender(surface(2));
  await waitFor(() => expect(state.editor?.observed.sha256).toBe('external'));
  expect(screen.getByTestId('editor-mount').textContent).not.toBe(before);
});
it('retains dirty edits on an external update and accepts that update after undo returns clean', async () => {
  read.mockResolvedValue(version('first')); const view = render(surface(1)); await screen.findByText('Rich editor');
  act(() => state.editor!.onDirtyChange(true, false));
  read.mockResolvedValue(version('external')); view.rerender(surface(2)); await screen.findByText('Document changed elsewhere.');
  expect(state.editor?.observed.sha256).toBe('first');
  act(() => state.editor!.onDirtyChange(false, false));
  await waitFor(() => expect(state.editor?.observed.sha256).toBe('external'));
});
it('does not remount the editor for an acknowledged own-save generation', async () => {
  read.mockResolvedValue(version('first')); const view = render(surface(1)); await screen.findByText('Rich editor');
  const before = screen.getByTestId('editor-mount').textContent;
  act(() => { state.editor!.onDirtyChange(true, true); state.editor!.onSaved(version('saved')); state.editor!.onDirtyChange(false, false); });
  read.mockResolvedValue(version('saved')); view.rerender(surface(2)); await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  expect(screen.getByTestId('editor-mount').textContent).toBe(before);
});
it('discards an intermediate pending snapshot after multiple acknowledged own saves', async () => {
  read.mockResolvedValue(version('first')); const view = render(surface(1)); await screen.findByText('Rich editor');
  const before = screen.getByTestId('editor-mount').textContent;
  act(() => state.editor!.onDirtyChange(true, true));
  read.mockResolvedValue(version('middle')); view.rerender(surface(2)); await screen.findByText('Document changed elsewhere.');
  read.mockResolvedValue(version('latest'));
  act(() => { state.editor!.onSaved(version('middle')); state.editor!.onSaved(version('latest')); state.editor!.onDirtyChange(false, false); });
  await waitFor(() => expect(read).toHaveBeenCalledTimes(3));
  expect(screen.getByTestId('editor-mount').textContent).toBe(before);
  expect(screen.queryByText('Document changed elsewhere.')).toBeNull();
});
it('retains the document instance on a transient read failure', async () => {
  read.mockResolvedValue(version('first')); const view = render(surface(1)); await screen.findByText('Rich editor');
  const before = screen.getByTestId('editor-mount').textContent;
  read.mockRejectedValue(new Error('Connection interrupted')); view.rerender(surface(2)); await screen.findByText('Connection interrupted');
  expect(screen.getByTestId('editor-mount').textContent).toBe(before);
});

it('keeps edits made while a confirmed latest-document read is pending', async () => {
  consent.mockResolvedValue(true); read.mockResolvedValue(version('first'));
  const view = render(surface(1)); await screen.findByText('Rich editor');
  act(() => state.editor!.onDirtyChange(true, false));
  read.mockResolvedValue(version('external')); view.rerender(surface(2)); await screen.findByText('Document changed elsewhere.');
  let finish!: (value: ReturnType<typeof version>) => void;
  read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  fireEvent.click(screen.getByRole('button', { name: 'Load latest document' }));
  await waitFor(() => expect(read).toHaveBeenCalledTimes(3));
  act(() => state.editor!.onDirtyChange(true, false));
  await act(async () => { finish(version('external')); });
  expect(state.editor?.observed.sha256).toBe('first');
  expect(screen.getByText('The document changed while loading. Try again.')).toBeInTheDocument();
});
it('remounts after explicit discard even when latest bytes match the original revision', async () => {
  consent.mockResolvedValue(true); read.mockResolvedValue(version('first'));
  const view = render(surface(1)); await screen.findByText('Rich editor'); const before = screen.getByTestId('editor-mount').textContent;
  act(() => state.editor!.onDirtyChange(true, false));
  read.mockRejectedValueOnce(new Error('Connection interrupted')); view.rerender(surface(2)); await screen.findByText('Connection interrupted');
  read.mockResolvedValue(version('first')); fireEvent.click(screen.getByRole('button', { name: 'Load latest document' }));
  await waitFor(() => expect(screen.getByTestId('editor-mount').textContent).not.toBe(before));
  expect(consent).toHaveBeenCalledWith('fixture', 'document');
});
it.each([401, 403, 404])('withdraws the editor when a raw read explicitly rejects access or existence (%s)', async status => {
  read.mockResolvedValue(version('first')); const view = render(surface(1)); await screen.findByText('Rich editor');
  read.mockRejectedValue(Object.assign(new Error('Unavailable'), { status })); view.rerender(surface(2));
  expect(await screen.findByText('Document unavailable.')).toBeInTheDocument(); expect(screen.queryByText('Rich editor')).toBeNull();
});

it('invalidates the prior account editor and reads again when the host viewer changes', async () => {
  read.mockResolvedValue(version('first')); const view = render(surface(1)); await screen.findByText('Rich editor');
  const before = screen.getByTestId('editor-mount').textContent; act(() => state.editor!.onDirtyChange(true, false));
  actor.id = 'person-b'; read.mockResolvedValue(version('current actor')); view.rerender(surface(1));
  await waitFor(() => expect(state.editor?.observed.sha256).toBe('current actor'));
  expect(screen.getByTestId('editor-mount').textContent).not.toBe(before);
});

it('waits for the initial host identity before mounting any editable document', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(window, 'parent');
  try {
    Object.defineProperty(window, 'parent', { configurable: true, value: {} }); actor.id = null;
    read.mockResolvedValue(version('first')); const view = render(surface(1));
    expect(screen.getByText('Loading document…')).toBeInTheDocument(); expect(read).not.toHaveBeenCalled();
    actor.id = 'person-a'; view.rerender(surface(1));
    expect(await screen.findByText('Rich editor')).toBeInTheDocument(); expect(read).toHaveBeenCalledTimes(1);
  } finally { if (descriptor) Object.defineProperty(window, 'parent', descriptor); }
});

it('offers confirmed reload for a save conflict even without a file-change notification', async () => {
  read.mockResolvedValue(version('first')); consent.mockResolvedValue(true);
  render(surface(1)); await screen.findByText('Rich editor');
  const before = screen.getByTestId('editor-mount').textContent;
  act(() => { state.editor!.onDirtyChange(true, false); state.editor!.onWriteError('Document changed elsewhere.'); });
  expect(screen.getByRole('alert')).toHaveTextContent('Document changed elsewhere.');
  expect(screen.getByTestId('editor-mount').textContent).toBe(before);
  read.mockResolvedValue(version('external')); fireEvent.click(screen.getByRole('button', { name: 'Load latest document' }));
  await waitFor(() => expect(state.editor?.observed.sha256).toBe('external'));
  expect(consent).toHaveBeenCalledWith('fixture', 'document');
});
