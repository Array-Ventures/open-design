// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import type { PreviewComment } from '@open-design/contracts';
const upload = vi.hoisted(() => vi.fn());
vi.mock('../../../src/providers/registry', () => ({ uploadProjectFiles: upload }));
import { RootCommentWrite } from '../../../src/components/embedded/root-comment-write';
beforeEach(() => { vi.resetAllMocks(); upload.mockResolvedValue({ uploaded: [{ path: '_studio-comments/image.png' }], failed: [] }); });
const target = { filePath: 'index.html', elementId: 'heading', selector: 'h1', label: 'Heading', text: '', position: { x: 1, y: 2, width: 100, height: 20 }, htmlHint: '' };
it('retains one upload and root operation after an uncertain response and ignores target key order', async () => {
  const write = new RootCommentWrite(); const signal = new AbortController().signal;
  const first = await write.prepare('project', target, 'Note', [new File(['pixels'], 'image.png', { type: 'image/png' })], undefined, signal);
  const reordered = Object.fromEntries(Object.entries(target).reverse()) as typeof target;
  const retry = await write.prepare('project', reordered, 'Note', [new File(['pixels'], 'image.png', { type: 'image/png' })], undefined, signal);
  expect(retry.input).toEqual(first.input); expect(upload).toHaveBeenCalledOnce();
  expect(first.input.attachments).toEqual([{ path: '_studio-comments/image.png', name: 'image.png' }]);
  expect(first.input.operationId).toMatch(/^[a-f0-9-]{36}$/);
  const changed = await write.prepare('project', target, 'Changed caption', [new File(['pixels'], 'image.png', { type: 'image/png' })], undefined, signal);
  expect(changed.input.operationId).not.toBe(first.input.operationId); expect(upload).toHaveBeenCalledOnce();
});
it('preserves a captured baseline and rotates only after explicit rebase or acceptance', async () => {
  const write = new RootCommentWrite(); const signal = new AbortController().signal;
  const baseline = { id: 'root', editToken: 'original', attachments: [{ path: '_studio-comments/kept.png', name: 'kept.png' }] } as PreviewComment;
  const first = await write.prepare('project', target, 'Edit', [], baseline, signal);
  expect(first.input).toMatchObject({ id: 'root', expectedEditToken: 'original', attachments: baseline.attachments });
  expect((await write.prepare('project', target, 'Edit', [], baseline, signal)).input).toEqual(first.input);
  const rebased = await write.prepare('project', target, 'Edit', [], { ...baseline, editToken: 'latest' }, signal);
  expect(rebased.input.operationId).not.toBe(first.input.operationId); expect(rebased.input.expectedEditToken).toBe('latest');
  write.clear(); expect((await write.prepare('project', target, 'Edit', [], baseline, signal)).input.operationId).not.toBe(first.input.operationId);
  expect(upload).not.toHaveBeenCalled();
});
it('does not mutate captured input or upload beyond the combined image limit', async () => {
  const write = new RootCommentWrite(); const signal = new AbortController().signal;
  const selected = structuredClone(target);
  const result = await write.prepare('project', selected, 'Note', [], undefined, signal);
  selected.position.x = 200; expect(result.input.target.position.x).toBe(1);
  const baseline = { id: 'root', attachments: Array.from({ length: 8 }, (_, i) => ({ path: `_studio-comments/${i}.png`, name: `${i}.png` })) } as PreviewComment;
  await expect(write.prepare('project', target, 'Note', [new File(['x'], 'image.png')], baseline, signal)).rejects.toThrow('eight');
  expect(upload).not.toHaveBeenCalled();
});

it('settles the original uncertain write before posting a changed draft and exposes only its consumed files', async () => {
  const write = new RootCommentWrite(); const signal = new AbortController().signal;
  const original = new File(['old pixels'], 'image.png', { type: 'image/png' });
  const first = await write.prepare('project', target, 'Original', [original], undefined, signal);
  write.uncertain(first.input);
  const newer = new File(['new pixels'], 'new.png', { type: 'image/png' });
  const retry = await write.prepare('project', target, 'Newer text', [original, newer], undefined, signal);
  expect(retry).toMatchObject({ input: first.input, superseded: true });
  expect(retry.files).toEqual([original]); expect(upload).toHaveBeenCalledOnce();
  const same = await write.prepare('project', target, 'Original', [original], undefined, signal);
  expect(same.superseded).toBe(false); expect(same.input).toEqual(first.input);
});
it('releases a definitively rejected uncertain edit for rebase without uploading its images again', async () => {
  const write = new RootCommentWrite(); const signal = new AbortController().signal;
  const file = new File(['pixels'], 'image.png', { type: 'image/png' });
  const original = { id: 'root', editToken: 'original', attachments: [] } as unknown as PreviewComment;
  const first = await write.prepare('project', target, 'Draft', [file], original, signal);
  write.uncertain(first.input); write.rejected(first.input);
  const rebased = await write.prepare('project', target, 'Draft', [file], { ...original, editToken: 'remote' }, signal);
  expect(rebased.input.expectedEditToken).toBe('remote'); expect(rebased.input.operationId).not.toBe(first.input.operationId);
  expect(rebased.superseded).toBe(false); expect(upload).toHaveBeenCalledOnce();
});
