// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
const upload = vi.hoisted(() => vi.fn());
vi.mock('../../../src/providers/registry', () => ({ uploadProjectFiles: upload }));
import { FeedbackImageUpload } from '../../../src/components/embedded/feedback-image-upload';
beforeEach(() => { vi.resetAllMocks(); upload.mockResolvedValue({ uploaded: [{ path: '.studio-comments/mark.png' }], failed: [] }); });
it('shares one upload and operation receipt across concurrent or lost-response retries', async () => {
  const cache = new FeedbackImageUpload();
  let sequence = 0;
  const file = () => new File(['pixels'], `mark-${sequence++}.png`, { type: 'image/png' });
  const [a, b] = await Promise.all([cache.prepare('project', [file()], 'note'), cache.prepare('project', [file()], 'note')]);
  expect(b).toEqual(a); expect(upload).toHaveBeenCalledTimes(1);
  expect(await cache.prepare('project', [file()], 'note')).toEqual(a);
  expect(upload).toHaveBeenCalledTimes(1);
  const edited = await cache.prepare('project', [file()], 'edited note');
  expect(edited.operationId).not.toBe(a.operationId); expect(upload).toHaveBeenCalledTimes(2);
});
it('does not cache partial failures, and resets after an accepted handoff', async () => {
  const cache = new FeedbackImageUpload(); const file = new File(['image'], 'mark.png');
  upload.mockResolvedValueOnce({ uploaded: [], failed: [{ name: 'mark.png' }] });
  await expect(cache.prepare('project', [file], 'note')).rejects.toThrow('could not be saved');
  const a = await cache.prepare('project', [file], 'note'); cache.clear();
  const b = await cache.prepare('project', [file], 'note');
  expect(b.operationId).not.toBe(a.operationId); expect(upload).toHaveBeenCalledTimes(3);
});
it('rejects excessive images before uploading anything', async () => {
  const cache = new FeedbackImageUpload();
  await expect(cache.prepare('project', Array.from({ length: 9 }, () => new File(['x'], 'x.png')), 'note')).rejects.toThrow('limit');
  expect(upload).not.toHaveBeenCalled();
});
