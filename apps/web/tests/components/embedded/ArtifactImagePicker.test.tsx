// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
const upload=vi.hoisted(() => vi.fn());
vi.mock('../../../src/components/embedded/project-image-upload',() => ({uploadProjectImage:upload}));
import {ArtifactImagePicker} from '../../../src/components/embedded/ArtifactImagePicker';
const asset={name:'_studio-image-assets/receipt.png',alt:'Figure',width:800,height:400};
afterEach(() => {cleanup();vi.resetAllMocks();});
function harness() {
  let source='original';
  const props={projectId:'project',disabled:false,reset:0,consumed:0,getSource:() => source,onImage:vi.fn(async () => {}),onStatus:vi.fn(),onStateChange:vi.fn()};
  const view=render(<ArtifactImagePicker {...props} />);
  const file=new File(['fixture'],'Figure.png',{type:'image/png'});
  const pick=() => {fireEvent.click(screen.getByRole('button',{name:'Insert image'}));fireEvent.change(screen.getByLabelText('Choose artifact image'),{target:{files:[file]}});};
  return{props,view,file,pick,change:() => {source='new source';}};
}
it('retains the authenticated upload receipt until a placement is committed',async () => {
  upload.mockResolvedValue(asset);const h=harness();h.pick();
  await waitFor(() => expect(h.props.onImage).toHaveBeenCalledWith(asset));
  expect(upload).toHaveBeenCalledWith('project',h.file,expect.any(AbortSignal));
  fireEvent.click(screen.getByRole('button',{name:'Insert uploaded image'}));
  expect(h.props.onImage).toHaveBeenCalledTimes(2);expect(upload).toHaveBeenCalledOnce();
  h.view.rerender(<ArtifactImagePicker {...h.props} consumed={1} />);
  expect(screen.getByRole('button',{name:'Insert image'})).toBeTruthy();
});
it('does not auto-place into source changed during upload, but keeps the receipt for an explicit choice',async () => {
  let finish!:(value:typeof asset)=>void;upload.mockImplementation(() => new Promise(resolve => {finish=resolve;}));
  const h=harness();h.pick();h.change();await act(async () => finish(asset));
  expect(h.props.onImage).not.toHaveBeenCalled();expect(h.props.onStatus).toHaveBeenLastCalledWith(expect.stringContaining('updated artifact'));
  fireEvent.click(screen.getByRole('button',{name:'Insert uploaded image'}));
  expect(h.props.onImage).toHaveBeenCalledWith(asset);expect(upload).toHaveBeenCalledOnce();
});
it('retries the same picked file after an upload failure',async () => {
  upload.mockRejectedValueOnce(new Error('Uncertain response')).mockResolvedValueOnce(asset);
  const h=harness();h.pick();await waitFor(() => expect(screen.getByRole('button',{name:'Retry image upload'})).toBeTruthy());
  fireEvent.click(screen.getByRole('button',{name:'Retry image upload'}));
  await waitFor(() => expect(h.props.onImage).toHaveBeenCalledOnce());
  expect(upload.mock.calls[1]![1]).toBe(h.file);
});
it.each(['reset','unmount'] as const)('aborts and ignores late receipts after %s',async action => {
  let finish!:(value:typeof asset)=>void;upload.mockImplementation(() => new Promise(resolve => {finish=resolve;}));
  const h=harness();h.pick();const signal=upload.mock.calls[0]![2] as AbortSignal;
  if(action === 'reset') h.view.rerender(<ArtifactImagePicker {...h.props} reset={1} />);else h.view.unmount();
  expect(signal.aborted).toBe(true);await act(async () => finish(asset));
  expect(h.props.onImage).not.toHaveBeenCalled();
  if(action === 'reset') expect(screen.getByRole('button',{name:'Insert image'})).toBeTruthy();
});
