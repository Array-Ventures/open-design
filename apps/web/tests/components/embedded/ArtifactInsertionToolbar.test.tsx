// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ArtifactInsertionToolbar } from '../../../src/components/embedded/ArtifactInsertionToolbar';
import type { ManualEditInsertionPatch } from '../../../src/edit-mode/insertion';
afterEach(() => { cleanup(); document.querySelectorAll('iframe').forEach(frame => frame.remove()); vi.unstubAllGlobals(); });
function harness(onInsert = vi.fn(async (_patch: ManualEditInsertionPatch) => true)) {
  const frame = document.createElement('iframe'); document.body.append(frame);
  const post = vi.spyOn(frame.contentWindow!, 'postMessage');
  let source = '<section>Source A</section>';
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1; });
  const props = {source,busy:false,getFrame:() => frame,getSource:() => source,onPrepare:vi.fn(async () => true),onInsert};
  const view = render(<ArtifactInsertionToolbar {...props} />);
  const arm = async () => {
    fireEvent.click(screen.getByRole('button',{name:'Insert text'}));
    await waitFor(() => expect(post.mock.calls.some(([data]) => data.type === 'od-insert-arm')).toBe(true));
    return post.mock.calls.find(([data]) => data.type === 'od-insert-arm')![0];
  };
  const send = async (data: object, sender: Window = frame.contentWindow!) => act(async () => {
    window.dispatchEvent(new MessageEvent('message',{source:sender,data}));
  });
  const change = (value: string) => {source=value;view.rerender(<ArtifactInsertionToolbar {...props} source={source} />);};
  return {frame,post,props,view,arm,send,change,onInsert};
}
it('accepts only the live frame and request, and uses host-owned content and identity', async () => {
  const h = harness(), armed = await h.arm();
  const placement = {type:'od-insert-placement',requestId:armed.requestId,parentId:'slide',placement:{left:10,top:20,width:240,height:48},element:{kind:'text',text:'Spoofed'}};
  await h.send(placement,window); await h.send({...placement,requestId:crypto.randomUUID()});
  expect(h.onInsert).not.toHaveBeenCalled();
  await h.send(placement);
  expect(h.onInsert).toHaveBeenCalledOnce();
  expect(h.onInsert.mock.calls[0]![0]).toEqual({kind:'insert-element',id:expect.stringMatching(/^eve-/),parentId:'slide',element:{kind:'text',text:'Text'},placement:placement.placement});
  await h.send(placement); expect(h.onInsert).toHaveBeenCalledOnce();
});
it('keeps the same insertion identity on a failed save retry', async () => {
  const onInsert = vi.fn(async (_patch: ManualEditInsertionPatch) => false), h = harness(onInsert), armed = await h.arm();
  await h.send({type:'od-insert-placement',requestId:armed.requestId,parentId:'slide',placement:{left:10,top:20,width:240,height:48}});
  expect(screen.getByRole('status').textContent).toContain('Could not save');
  h.change('<section>Source changed while save was uncertain</section>');
  fireEvent.click(screen.getByRole('button',{name:'Retry insertion save'}));
  await waitFor(() => expect(onInsert).toHaveBeenCalledTimes(2));
  expect(onInsert.mock.calls[1]![0]).toEqual(onInsert.mock.calls[0]![0]);
  expect(onInsert).toHaveBeenNthCalledWith(2,onInsert.mock.calls[0]![0],'Insert text','<section>Source A</section>');
  expect((screen.getByRole('button',{name:'Insert text'}) as HTMLButtonElement).disabled).toBe(true);
});
it('retires a request after source replacement or frame navigation', async () => {
  const h = harness(), armed = await h.arm(); h.change('<section>Source B</section>');
  await h.send({type:'od-insert-placement',requestId:armed.requestId,parentId:'slide',placement:{left:10,top:20,width:240,height:48}});
  expect(h.onInsert).not.toHaveBeenCalled();
  expect(h.post.mock.calls.some(([data]) => data.type === 'od-insert-cancel')).toBe(true);
});
it('refuses malformed geometry and cancels without a write', async () => {
  const h = harness(), armed = await h.arm();
  await h.send({type:'od-insert-placement',requestId:armed.requestId,parentId:'slide',placement:{left:-1,top:20,width:240,height:48}});
  expect(h.onInsert).not.toHaveBeenCalled(); expect(screen.getByRole('status').textContent).toContain('Could not determine');
});
it('does not arm a canvas after preparation fails', async () => {
  const h = harness(); h.props.onPrepare.mockResolvedValue(false);
  fireEvent.click(screen.getByRole('button',{name:'Insert text'}));
  await act(async () => {});
  expect(h.post.mock.calls.some(([data]) => data.type === 'od-insert-arm')).toBe(false);
  expect(h.onInsert).not.toHaveBeenCalled();
});
