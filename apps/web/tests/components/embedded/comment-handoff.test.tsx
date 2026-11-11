// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PreviewComment, PreviewCommentTarget } from '../../../src/types';
import { useEmbeddedComments } from '../../../src/components/embedded/useEmbeddedComments';
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), save: vi.fn(), upload: vi.fn(), prepare: vi.fn(), stage: vi.fn() }));
vi.mock('../../../src/providers/registry', () => ({ fetchPreviewComments: mocks.fetch, upsertPreviewComment: mocks.save, uploadProjectFiles: mocks.upload, deletePreviewComment: vi.fn(), patchPreviewCommentSortKey: vi.fn() }));
vi.mock('../../../src/components/embedded/host-context', async importOriginal => ({ ...await importOriginal<typeof import('../../../src/components/embedded/host-context')>(), prepareHostFeedback: mocks.prepare, stageHostContext: mocks.stage }));
const target: PreviewCommentTarget = { filePath: 'index.html', elementId: 'heading', selector: '[data-od-id="heading"]', label: 'Heading', text: 'Revenue', position: { x: 10, y: 20, width: 100, height: 30 }, slideIndex: 3 };
const saved = { id: 'comment-one', projectId: 'p', conversationId: 'p', ...target, note: 'Make it clearer', status: 'open', attachments: [], createdAt: 1, updatedAt: 1 } as PreviewComment;
beforeEach(() => { vi.clearAllMocks(); mocks.fetch.mockResolvedValue([]); mocks.save.mockResolvedValue(saved); mocks.prepare.mockResolvedValue(true); mocks.stage.mockResolvedValue(true); });
afterEach(cleanup);
describe('saved comment chat handoff', () => {
  it('chooses chat before uploads or saving when the person cancels preparation', async () => {
    mocks.prepare.mockResolvedValue(false);
    const { result } = renderHook(() => useEmbeddedComments('p'));
    await waitFor(() => expect(result.current.state).toBe('success'));
    let answer: PreviewComment | null = saved;
    await act(async () => { answer = await result.current.save(target, saved.note, true, [new File(['image'], 'mark.png')]); });
    expect(answer).toBeNull();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it('retains failed handoff and retries the same saved comment and operation without duplicates', async () => {
    mocks.stage.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const { result } = renderHook(() => useEmbeddedComments('p'));
    await waitFor(() => expect(result.current.state).toBe('success'));
    let answer: PreviewComment | null = saved;
    await act(async () => { answer = await result.current.save(target, saved.note, true); });
    expect(answer).toBeNull();
    expect(result.current.comments).toEqual([saved]);
    await act(async () => { answer = await result.current.save(target, saved.note, true); });
    expect(answer).toEqual(saved);
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.stage).toHaveBeenCalledTimes(2);
    expect(mocks.stage.mock.calls[0]?.[1]).toContain('Slide: 4');
    expect(mocks.stage.mock.calls[0]?.[2]).toBe(mocks.stage.mock.calls[1]?.[2]);
  });
});
