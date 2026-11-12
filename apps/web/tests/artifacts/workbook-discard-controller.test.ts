import { afterEach, expect, it, vi } from 'vitest';
import { connectWorkbookDiscard, WorkbookDiscardNotCommittedError, type PreparedWorkbookDiscard } from '../../src/components/embedded/workbook/discard-controller';
const projectId = crypto.randomUUID(), controllerId = crypto.randomUUID(), origin = 'http://localhost:8321';
const tick = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
afterEach(() => vi.useRealTimers());
function setup(prepare: (signal: AbortSignal) => Promise<PreparedWorkbookDiscard> = vi.fn(async () => ({ commit: vi.fn(async () => {}), cancel: vi.fn(async () => {}) }))) {
  let receive: ((event: Pick<MessageEvent, 'source' | 'origin' | 'data'>) => void) | undefined;
  const parent = { postMessage: vi.fn() } as unknown as Window, disconnect = vi.fn();
  const close = connectWorkbookDiscard(projectId, controllerId, prepare, { origin, parent, listen: fn => { receive = fn; return disconnect; } }, 100);
  const requestId = crypto.randomUUID();
  const send = (type: string, extra = {}, source: Window = parent) => receive?.({ source, origin, data: { type, projectId, controllerId, requestId, ...extra } });
  return { prepare, parent, close, send, requestId, disconnect };
}
it('prepares without deleting, grants exactly once and replays a lost acknowledgement', async () => {
  const commit = vi.fn(async () => {}), cancel = vi.fn(async () => {}), link = setup(vi.fn(async () => ({ commit, cancel })));
  link.send('studio:discard-workbook'); await tick(); expect(commit).not.toHaveBeenCalled();
  expect(vi.mocked(link.parent.postMessage)).toHaveBeenCalledWith(expect.objectContaining({ type: 'studio:workbook-discard-ready' }), origin);
  link.send('studio:commit-workbook-discard'); link.send('studio:commit-workbook-discard'); await tick();
  link.send('studio:commit-workbook-discard'); await tick(); expect(commit).toHaveBeenCalledOnce();
  expect(vi.mocked(link.parent.postMessage)).toHaveBeenLastCalledWith(expect.objectContaining({ accepted: true }), origin);
  link.send('studio:discard-workbook', { requestId: crypto.randomUUID() }); await tick();
  expect(link.prepare).toHaveBeenCalledOnce(); // unacknowledged grant blocks newer branch substitution
  link.send('studio:finish-workbook-discard'); link.close(); await tick();
});
it('cancels before grant and never accepts an old grant against a reopened writer', async () => {
  const commit = vi.fn(async () => {}), cancel = vi.fn(async () => {}), link = setup(vi.fn(async () => ({ commit, cancel })));
  link.send('studio:discard-workbook'); await tick(); link.send('studio:cancel-workbook-discard'); await tick();
  link.send('studio:commit-workbook-discard'); await tick(); expect(commit).not.toHaveBeenCalled(); expect(cancel).toHaveBeenCalledOnce();
  expect(vi.mocked(link.parent.postMessage)).toHaveBeenLastCalledWith(expect.objectContaining({ accepted: false, uncommitted: true }), origin); link.close();
});
it('keeps an irreversible in-flight commit alive through unmount and ignores cancellation', async () => {
  let finish!: () => void; const commit = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  const link = setup(vi.fn(async () => ({ commit, cancel: vi.fn(async () => {}) })));
  link.send('studio:discard-workbook'); await tick(); link.send('studio:commit-workbook-discard'); await tick(); link.close(); link.send('studio:cancel-workbook-discard'); finish(); await tick();
  link.send('studio:commit-workbook-discard'); await tick(); expect(commit).toHaveBeenCalledOnce();
  expect(vi.mocked(link.parent.postMessage)).toHaveBeenLastCalledWith(expect.objectContaining({ accepted: true }), origin);
  link.send('studio:finish-workbook-discard'); expect(link.disconnect).toHaveBeenCalledOnce();
});
it('cancels late preparation after unmount and refuses untrusted scope or unknown grants', async () => {
  let finish!: (value: PreparedWorkbookDiscard) => void;
  const prepare = vi.fn(() => new Promise<PreparedWorkbookDiscard>(resolve => { finish = resolve; }));
  const link = setup(prepare), commit = vi.fn(async () => {}), cancel = vi.fn(async () => {});
  link.send('studio:commit-workbook-discard'); link.send('studio:discard-workbook', { projectId: crypto.randomUUID() }); link.send('studio:discard-workbook', {}, {} as Window); await tick(); expect(prepare).not.toHaveBeenCalled();
  link.send('studio:discard-workbook'); await tick(); link.close(); finish({ commit, cancel }); await tick(); expect(cancel).toHaveBeenCalledOnce(); expect(commit).not.toHaveBeenCalled();
});
it('retries the same frozen failed commit and distinguishes definitive pre-write refusal', async () => {
  const commit = vi.fn().mockRejectedValueOnce(Error('IDB failed')).mockResolvedValueOnce(undefined), link = setup(vi.fn(async () => ({ commit, cancel: vi.fn(async () => {}) })));
  link.send('studio:discard-workbook'); await tick(); link.send('studio:commit-workbook-discard'); await tick(); link.close(); link.send('studio:commit-workbook-discard'); await tick(); expect(commit).toHaveBeenCalledTimes(2); link.send('studio:finish-workbook-discard');
  const refused = setup(vi.fn(async () => ({ commit: vi.fn(async () => { throw new WorkbookDiscardNotCommittedError('Source replaced'); }), cancel: vi.fn(async () => {}) })));
  refused.send('studio:discard-workbook'); await tick(); refused.send('studio:commit-workbook-discard'); await tick(); expect(vi.mocked(refused.parent.postMessage)).toHaveBeenLastCalledWith(expect.objectContaining({ accepted: false, uncommitted: true }), origin); refused.close();
});
