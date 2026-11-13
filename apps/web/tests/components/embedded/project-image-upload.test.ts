// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {sha256} from '@noble/hashes/sha256';
import {bytesToHex} from '@noble/hashes/utils';
const create=vi.hoisted(() => vi.fn());
vi.mock('../../../src/providers/registry',() => ({projectFileUrl:(_id:string,name:string) => `/raw/${name}`,writeProjectBase64File:create}));
import {uploadProjectImage} from '../../../src/components/embedded/project-image-upload';
const bytes=new TextEncoder().encode('fixture image bytes'),digest=bytesToHex(sha256(bytes));
const path=`_studio-image-assets/${digest}.png`;
const read=vi.fn(),revoke=vi.fn();
beforeEach(() => {
  vi.stubGlobal('Image',class {src='';naturalWidth=400;naturalHeight=200;decode(){return Promise.resolve();}removeAttribute(){this.src='';}});
  vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:fixture');
  vi.spyOn(URL,'revokeObjectURL').mockImplementation(revoke);
  vi.stubGlobal('fetch',read);
  create.mockResolvedValue({name:path});
});
afterEach(() => {vi.unstubAllGlobals();vi.restoreAllMocks();vi.resetAllMocks();});
const file=() => new File([bytes],'Figure.png',{type:'image/png'});
it('creates a content-addressed asset without overwriting and verifies the returned bytes',async () => {
  read.mockResolvedValueOnce(new Response(null,{status:404})).mockResolvedValueOnce(new Response(bytes));
  const signal=new AbortController().signal;
  expect(await uploadProjectImage('project',file(),signal)).toEqual({name:path,alt:'Figure',width:400,height:200});
  expect(create).toHaveBeenCalledWith('project',path,btoa('fixture image bytes'),undefined,{overwrite:false,signal});
  expect(read).toHaveBeenCalledTimes(2);expect(revoke).toHaveBeenCalledOnce();
});
it('recovers an existing identical asset without another write',async () => {
  read.mockResolvedValue(new Response(bytes));
  expect((await uploadProjectImage('project',file(),new AbortController().signal)).name).toBe(path);
  expect(create).not.toHaveBeenCalled();
});
it('recovers a committed upload whose acknowledgement was lost',async () => {
  create.mockResolvedValue(null);
  read.mockResolvedValueOnce(new Response(null,{status:404})).mockResolvedValueOnce(new Response(bytes));
  expect((await uploadProjectImage('project',file(),new AbortController().signal)).name).toBe(path);
  expect(create).toHaveBeenCalledOnce();
});
it('does not overwrite a name occupied by different bytes',async () => {
  read.mockResolvedValue(new Response(new Uint8Array(bytes.length).fill(1)));
  await expect(uploadProjectImage('project',file(),new AbortController().signal)).rejects.toThrow('not replaced');
  expect(create).not.toHaveBeenCalled();
});
it('bounds confirmation reads even without Content-Length',async () => {
  const cancel=vi.fn();
  read.mockResolvedValue(new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(bytes.length+1));},cancel})));
  await expect(uploadProjectImage('project',file(),new AbortController().signal)).rejects.toThrow('not replaced');
  expect(cancel).toHaveBeenCalledOnce();expect(create).not.toHaveBeenCalled();
});
it('requires current read authorization and refuses unconfirmed writes',async () => {
  read.mockResolvedValue(new Response(null,{status:403}));
  await expect(uploadProjectImage('project',file(),new AbortController().signal)).rejects.toThrow('confirm');
  expect(create).not.toHaveBeenCalled();
  read.mockReset().mockResolvedValue(new Response(null,{status:404}));
  await expect(uploadProjectImage('project',file(),new AbortController().signal)).rejects.toThrow('could not be confirmed');
  expect(create).toHaveBeenCalledOnce();
});
it('does not accept a receipt after cancellation',async () => {
  const controller=new AbortController();
  read.mockResolvedValueOnce(new Response(null,{status:404}));
  create.mockImplementation(async () => {controller.abort();return{name:path};});
  await expect(uploadProjectImage('project',file(),controller.signal)).rejects.toMatchObject({name:'AbortError'});
  expect(read).toHaveBeenCalledOnce();
});
