// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const imageUpload=vi.hoisted(() => vi.fn());
vi.mock('../../../src/components/embedded/project-image-upload',() => ({uploadProjectImage:imageUpload}));
import { ArtifactInsertionToolbar } from '../../../src/components/embedded/ArtifactInsertionToolbar';
import type { ManualEditInsertionPatch } from '../../../src/edit-mode/insertion';
afterEach(() => { cleanup(); document.querySelectorAll('iframe').forEach(frame => frame.remove()); vi.unstubAllGlobals(); imageUpload.mockReset(); });
function harness(onInsert = vi.fn(async (_patch: ManualEditInsertionPatch) => true)) {
  const frame = document.createElement('iframe'); document.body.append(frame);
  const post = vi.spyOn(frame.contentWindow!, 'postMessage');
  let source = '<section>Source A</section>';
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1; });
  const props = {projectId:'project',fileName:'index.html',source,busy:false,getFrame:() => frame,getSource:() => source,onPrepare:vi.fn(async () => true),onInsert};
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

it('retires geometry on frame load and explains why the pending insertion stopped', async () => {
  const h=harness(), first=await h.arm();
  await act(async () => h.frame.dispatchEvent(new Event('load')));
  expect(h.post.mock.calls.filter(([data]) => data.type === 'od-insert-arm')).toHaveLength(1);
  expect(screen.getByRole('status').textContent).toContain('canvas refreshed');
  await h.send({type:'od-insert-placement',requestId:first.requestId,parentId:'slide',placement:{left:10,top:20,width:240,height:48}});
  expect(h.onInsert).not.toHaveBeenCalled();
});
it('reports failed preparation instead of silently dropping the chosen action', async () => {
  const h=harness(); h.props.onPrepare.mockResolvedValue(false);
  fireEvent.click(screen.getByRole('button',{name:'Insert text'}));
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('not ready to insert'));
  expect(h.onInsert).not.toHaveBeenCalled();
});
it('measures insertion chrome and releases its reserved space when removed', () => {
  let resize: ResizeObserverCallback | null = null;
  const disconnect=vi.fn(), report=vi.fn();
  vi.stubGlobal('ResizeObserver',class {constructor(callback: ResizeObserverCallback){resize=callback;} observe(){} disconnect=disconnect;});
  const rect=vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockReturnValue({height:96} as DOMRect);
  const view=render(<ArtifactInsertionToolbar projectId="project" fileName="index.html" source="source" busy={false} getFrame={() => null} getSource={() => 'source'} onPrepare={async () => true} onInsert={async () => true} onHeightChange={report} />);
  expect(report).toHaveBeenLastCalledWith(120);
  rect.mockReturnValue({height:144} as DOMRect);
  act(() => resize!([],{} as ResizeObserver)); expect(report).toHaveBeenLastCalledWith(168);
  view.unmount(); expect(disconnect).toHaveBeenCalledOnce(); expect(report).toHaveBeenLastCalledWith(0);
  rect.mockRestore();
});

it('places an uploaded image through the same source-bound insertion writer using the authored base', async () => {
  const source='<!doctype html><html><head><base href="../images/"></head><body><main>Canvas</main></body></html>';
  const frame=document.createElement('iframe');document.body.append(frame);const post=vi.spyOn(frame.contentWindow!,'postMessage');
  vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback) => {callback(0);return 1;});
  imageUpload.mockResolvedValue({name:'_studio-image-assets/receipt.png',alt:'Figure',width:800,height:400});
  const onInsert=vi.fn(async () => true);
  render(<ArtifactInsertionToolbar projectId="project" fileName="slides/index.html" source={source} busy={false} getFrame={() => frame} getSource={() => source} onPrepare={async () => true} onInsert={onInsert} />);
  fireEvent.click(screen.getByRole('button',{name:'Insert image'}));
  fireEvent.change(screen.getByLabelText('Choose artifact image'),{target:{files:[new File(['image'],'Figure.png',{type:'image/png'})]}});
  await waitFor(() => expect(post.mock.calls.some(([data]) => data.type === 'od-insert-arm')).toBe(true));
  const armed=post.mock.calls.find(([data]) => data.type === 'od-insert-arm')![0];
  expect(armed.element).toEqual({kind:'image',src:'../_studio-image-assets/receipt.png',alt:'Figure',size:{width:800,height:400}});
  await act(async () => {window.dispatchEvent(new MessageEvent('message',{source:frame.contentWindow,data:{type:'od-insert-placement',requestId:armed.requestId,parentId:'canvas',placement:{left:20,top:30,width:320,height:160}}}));});
  expect(onInsert).toHaveBeenCalledWith(expect.objectContaining({kind:'insert-element',element:armed.element}),'Insert image',source);
  await waitFor(() => expect(screen.getByRole('button',{name:'Insert image'})).toBeTruthy());
  expect(imageUpload).toHaveBeenCalledOnce();
});
it('cancels placement before opening presentation properties and respects busy state', async () => {
  const h = harness(), onProperties = vi.fn(async () => {});
  h.view.rerender(<ArtifactInsertionToolbar {...h.props} onProperties={onProperties} />);
  const armed = await h.arm();
  await h.send({ type: 'od-insert-armed', requestId: armed.requestId });
  fireEvent.click(screen.getByRole('button', { name: 'Presentation properties' }));
  expect(onProperties).toHaveBeenCalledOnce();
  expect(h.post).toHaveBeenCalledWith({ type: 'od-insert-cancel', requestId: armed.requestId }, '*');
  expect(h.onInsert).not.toHaveBeenCalled();
  h.view.rerender(<ArtifactInsertionToolbar {...h.props} busy onProperties={onProperties} />);
  expect(screen.getByRole('button', { name: 'Presentation properties' })).toBeDisabled();
});
