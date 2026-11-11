// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PreviewComment } from '../../../src/types';

const api = vi.hoisted(() => ({ list: vi.fn(), save: vi.fn(), remove: vi.fn(), reorder: vi.fn(), upload: vi.fn(), stage: vi.fn(), prepare: vi.fn() }));
vi.mock('../../../src/providers/registry', () => ({ fetchPreviewComments: api.list, upsertPreviewComment: api.save, deletePreviewComment: api.remove, patchPreviewCommentSortKey: api.reorder, uploadProjectFiles: api.upload }));
vi.mock('../../../src/components/embedded/host-context', async original => ({ ...await original<typeof import('../../../src/components/embedded/host-context')>(), stageHostContext: api.stage, prepareHostFeedback: api.prepare }));
import { useEmbeddedComments } from '../../../src/components/embedded/useEmbeddedComments';
const target = { filePath: 'index.html', elementId: 'heading', selector: '#heading', label: 'Heading', text: 'Original', position: { x: 0, y: 0, width: 100, height: 20 }, htmlHint: '<h1>Original</h1>' };
const comment = { ...target, id: 'comment-a', note: 'Change heading', conversationId: 'project-a', attachments: [] } as unknown as PreviewComment;
beforeEach(() => { api.list.mockResolvedValue([]); api.stage.mockResolvedValue(true); api.prepare.mockResolvedValue('11111111-1111-4111-8111-111111111111'); api.save.mockResolvedValue(comment); });
afterEach(() => { cleanup(); vi.resetAllMocks(); });
describe('embedded persistent annotations', () => {
  it('saves in the project comment container and stages only after an explicit attach', async () => {
    const { result } = renderHook(() => useEmbeddedComments('project-a'));
    await waitFor(() => expect(result.current.state).toBe('success'));
    await act(async () => { await result.current.save(target, 'Change heading', false); });
    expect(api.save).toHaveBeenCalledWith('project-a', 'project-a', expect.objectContaining({ target, note: 'Change heading' }));
    expect(result.current.comments).toEqual([comment]); expect(api.stage).not.toHaveBeenCalled();
    await act(async () => { await result.current.save(target, 'Change heading', true); });
    expect(api.stage).toHaveBeenCalledWith('project-a', 'Change heading', expect.any(String), expect.any(String), [], [expect.objectContaining({ kind: 'comment', filePath: target.filePath })], expect.any(Function));
  });
  it('preserves saved comments when the host refuses a draft handoff', async () => {
    api.stage.mockResolvedValue(false);
    const { result } = renderHook(() => useEmbeddedComments('project-a'));
    await waitFor(() => expect(result.current.state).toBe('success'));
    await act(async () => { await result.current.save(target, 'Change heading', true); });
    expect(result.current.comments).toEqual([comment]);
    expect(result.current.notice).toContain('Comment saved');
  });
  it('does not save a partial image comment and reports upload failure', async () => {
    api.upload.mockResolvedValue({ uploaded: [], failed: [{ name: 'image.png' }] });
    const { result } = renderHook(() => useEmbeddedComments('project-a'));
    await waitFor(() => expect(result.current.state).toBe('success'));
    await act(async () => { expect(await result.current.save(target, 'Change', false, [new File(['image'], 'image.png')])).toBeNull(); });
    expect(api.save).not.toHaveBeenCalled(); expect(result.current.notice).toContain('not saved');
  });
});
