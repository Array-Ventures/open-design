// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {sha256} from '@noble/hashes/sha256';
import {bytesToHex} from '@noble/hashes/utils';
const write=vi.hoisted(() => vi.fn());
const decode=vi.hoisted(() => vi.fn());
vi.mock('../../../src/providers/registry',() => ({writeProjectBase64File:write,projectFileUrl:(_project:string,name:string) => `/raw/${name}`}));
import {uploadDocumentImage} from '../../../src/components/embedded/document/document-image-upload';
const bytes=new TextEncoder().encode('fixture'),path=`_studio-image-assets/${bytesToHex(sha256(bytes))}.png`;
const revoke=vi.fn(),create=vi.fn(() => 'blob:fixture-image'),read=vi.fn();
beforeEach(() => {
  vi.stubGlobal('Image',class {src='';naturalWidth=400;naturalHeight=200;decode(){return decode();}removeAttribute(){this.src='';}});
  vi.stubGlobal('URL',{createObjectURL:create,revokeObjectURL:revoke});vi.stubGlobal('fetch',read);
  decode.mockResolvedValue(undefined);write.mockResolvedValue({name:path});
  read.mockResolvedValueOnce(new Response(null,{status:404})).mockResolvedValueOnce(new Response(bytes));
});
afterEach(() => {vi.unstubAllGlobals();vi.resetAllMocks();});
it('uses protected create-only storage and confirms authoritative bytes while releasing the decode URL',async () => {
  const file=new File(['fixture'],'My figure.png',{type:'image/png'}),signal=new AbortController().signal;
  expect(await uploadDocumentImage('project',file,signal)).toEqual({name:path,alt:'My figure',width:400,height:200});
  expect(write).toHaveBeenCalledWith('project',path,btoa('fixture'),undefined,{overwrite:false,signal});
  expect(read).toHaveBeenCalledTimes(2);expect(revoke).toHaveBeenCalledWith('blob:fixture-image');
});
it('cancels pending decoding before making a storage request',async () => {
  decode.mockImplementation(() => new Promise(() => {}));const controller=new AbortController();
  const pending=uploadDocumentImage('project',new File(['fixture'],'figure.png',{type:'image/png'}),controller.signal);
  controller.abort();await expect(pending).rejects.toMatchObject({name:'AbortError'});
  expect(read).not.toHaveBeenCalled();expect(write).not.toHaveBeenCalled();expect(revoke).toHaveBeenCalledOnce();
});
it('does not decode or store an already cancelled image',async () => {
  const controller=new AbortController();controller.abort();
  await expect(uploadDocumentImage('project',new File(['fixture'],'figure.png',{type:'image/png'}),controller.signal)).rejects.toMatchObject({name:'AbortError'});
  expect(create).not.toHaveBeenCalled();expect(read).not.toHaveBeenCalled();expect(write).not.toHaveBeenCalled();
});
it('keeps failed decoding from creating an asset',async () => {
  decode.mockRejectedValue(new Error('Invalid image'));
  await expect(uploadDocumentImage('project',new File(['fixture'],'figure.png',{type:'image/png'}),new AbortController().signal)).rejects.toThrow('Invalid image');
  expect(read).not.toHaveBeenCalled();expect(write).not.toHaveBeenCalled();expect(revoke).toHaveBeenCalledOnce();
});
it('does not return a receipt when stored bytes cannot be confirmed',async () => {
  write.mockResolvedValue(null);read.mockReset().mockResolvedValue(new Response(null,{status:404}));
  await expect(uploadDocumentImage('project',new File(['fixture'],'figure.png',{type:'image/png'}),new AbortController().signal)).rejects.toThrow('could not be confirmed');
  expect(write).toHaveBeenCalledOnce();expect(read).toHaveBeenCalledTimes(2);
});
it('ignores a successful storage response delivered after cancellation',async () => {
  const controller=new AbortController();write.mockImplementation(async () => {controller.abort();return{name:path};});
  await expect(uploadDocumentImage('project',new File(['fixture'],'figure.png',{type:'image/png'}),controller.signal)).rejects.toMatchObject({name:'AbortError'});
  expect(read).toHaveBeenCalledOnce();
});
