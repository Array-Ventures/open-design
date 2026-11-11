import { expect, it } from 'vitest';
import { DocumentWriter } from '../../../src/components/embedded/document/document-writer';
const base = { html: 'initial', sha256: 'original' };
it('serializes edits made during a save against its acknowledged digest', async () => {
  const calls: { html: string; sha: string }[] = []; let release!: () => void;
  const writer = new DocumentWriter(base, 'initial', async (html, prior) => {
    calls.push({ html, sha: prior.sha256 });
    if (calls.length === 1) await new Promise<void>(resolve => { release = resolve; });
    return { html, sha256: html };
  }, () => {});
  writer.change('first'); const saving = writer.flush(); writer.change('second');
  expect(writer.flush()).toBe(saving); expect(calls).toEqual([{ html: 'first', sha: 'original' }]);
  release(); await saving;
  expect(calls).toEqual([{ html: 'first', sha: 'original' }, { html: 'second', sha: 'first' }]);
  expect(writer.state()).toEqual({ dirty: false, saving: false, error: null });
});
it('retains edits and the original base after a conflict, allowing an explicit retry', async () => {
  let fail = true; const bases: string[] = [];
  const writer = new DocumentWriter(base, 'initial', async (html, prior) => {
    bases.push(prior.sha256); if (fail) throw Object.assign(new Error('This file changed.'), { status: 409 });
    return { html, sha256: 'saved' };
  }, () => {});
  writer.change('edited'); await writer.flush();
  expect(writer.state()).toEqual({ dirty: true, saving: false, error: 'This file changed.' });
  writer.change('latest edit'); fail = false; await writer.flush();
  expect(bases).toEqual(['original', 'original']); expect(writer.state().dirty).toBe(false);
});
it('does not start another save or notify an unmounted surface', async () => {
  let release!: () => void; const notifications: unknown[] = []; let writes = 0;
  const writer = new DocumentWriter(base, 'initial', async html => { writes++; await new Promise<void>(r => { release = r; }); return { html, sha256: html }; }, state => notifications.push(state));
  writer.change('first'); const saving = writer.flush(); writer.change('second'); writer.stop();
  const count = notifications.length; release(); await saving;
  expect(writes).toBe(1); expect(notifications).toHaveLength(count); expect(writer.state().dirty).toBe(true);
});

it('keeps navigation dirty when undo returns to the acknowledged content during a different inflight write', async () => {
  let release!: () => void; const writes: string[] = [];
  const writer = new DocumentWriter(base, 'initial', async html => {
    writes.push(html); if (writes.length === 1) await new Promise<void>(resolve => { release = resolve; });
    return { html, sha256: html };
  }, () => {});
  writer.change('edited'); const pending = writer.flush(); writer.change('initial');
  expect(writer.state()).toMatchObject({ dirty: true, saving: true });
  release(); await pending;
  expect(writes).toEqual(['edited', 'initial']); expect(writer.state().dirty).toBe(false);
});

it('replays an uncertain committed save before restoring an undone edit after a lost response', async () => {
  let disk = 'initial'; let loseResponse = true; const attempts: { html: string; base: string }[] = [];
  const writer = new DocumentWriter(base, 'initial', async (html, prior) => {
    attempts.push({ html, base: prior.sha256 }); disk = html;
    if (loseResponse) { loseResponse = false; throw new Error('Lost response'); }
    return { html, sha256: html };
  }, () => {});
  writer.change('edited'); await writer.flush(); writer.change('initial');
  expect(disk).toBe('edited'); expect(writer.state()).toMatchObject({ dirty: true, error: 'Lost response' });
  await writer.flush();
  expect(attempts).toEqual([{ html: 'edited', base: 'original' }, { html: 'edited', base: 'original' }, { html: 'initial', base: 'edited' }]);
  expect(disk).toBe('initial'); expect(writer.state()).toEqual({ dirty: false, saving: false, error: null });
});
