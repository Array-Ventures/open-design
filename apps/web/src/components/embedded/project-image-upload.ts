import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { projectFileUrl, writeProjectBase64File } from '../../providers/registry';
export type ProjectImageReceipt = { name: string; alt: string; width: number; height: number };
const extensions: Record<string,string> = {'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif','image/svg+xml':'svg'};
export async function decodeProjectImage(file: File,signal: AbortSignal): Promise<{width:number;height:number;extension:string}> {
  if (signal.aborted) throw new DOMException('Image upload cancelled','AbortError');
  if (file.size > 20*1024*1024) throw new Error('Choose an image smaller than 20 MB.');
  const extension=extensions[file.type] ?? (!file.type ? /\.(png|jpe?g|webp|gif|svg)$/i.exec(file.name)?.[1]?.toLowerCase() : undefined);
  if (!extension) throw new Error('Choose a PNG, JPEG, WebP, GIF or SVG image.');
  const url=URL.createObjectURL(file),image=new Image(); let abort!:()=>void;
  try {
    const cancelled=new Promise<never>((_resolve,reject) => {abort=() => {image.removeAttribute('src');reject(new DOMException('Image upload cancelled','AbortError'));};signal.addEventListener('abort',abort,{once:true});});
    if (signal.aborted) abort();
    image.src=url; await Promise.race([image.decode(),cancelled]);
    if (image.naturalWidth < 1 || image.naturalHeight < 1 || image.naturalWidth > 10000 || image.naturalHeight > 10000) throw new Error('Choose an image up to 10,000 pixels per side.');
    return {width:image.naturalWidth,height:image.naturalHeight,extension};
  } finally {signal.removeEventListener('abort',abort);URL.revokeObjectURL(url);}
}
function imageBytes(file: File,signal: AbortSignal): Promise<{bytes:Uint8Array;base64:string}> {
  return new Promise((resolve,reject) => {
    const reader=new FileReader();
    const abort=() => reader.abort();
    const finish=() => signal.removeEventListener('abort',abort);
    reader.onerror=() => {finish();reject(reader.error ?? new Error('Could not read image.'));};
    reader.onabort=() => {finish();reject(new DOMException('Image upload cancelled','AbortError'));};
    reader.onload=() => {
      finish(); if (signal.aborted) {reject(new DOMException('Image upload cancelled','AbortError'));return;}
      const base64=String(reader.result).split(',')[1];
      if (!base64) {reject(new Error('Could not read image.'));return;}
      try {
        const decoded=atob(base64),bytes=new Uint8Array(decoded.length);
        for(let i=0;i<decoded.length;i++) bytes[i]=decoded.charCodeAt(i);
        resolve({bytes,base64});
      } catch {reject(new Error('Could not read image.'));}
    };
    signal.addEventListener('abort',abort,{once:true});
    if (signal.aborted) {finish();reject(new DOMException('Image upload cancelled','AbortError'));return;}
    try {reader.readAsDataURL(file);} catch(error) {finish();reject(error);}
  });
}
/** Bound the confirmation read to exactly the picked bytes, even if another
 * writer has occupied that name with a larger file or omitted Content-Length. */
async function storedImageMatches(projectId: string,name: string,bytes: Uint8Array,digest: string,signal: AbortSignal): Promise<'missing'|'matches'|'conflict'> {
  const response=await fetch(projectFileUrl(projectId,name),{cache:'no-store',signal});
  if (response.status === 404) return 'missing';
  if (!response.ok || !response.body) throw new Error('Could not confirm the uploaded image. Try again.');
  const declared=response.headers.get('content-length');
  if (declared !== null && Number(declared) !== bytes.length) {await response.body.cancel();return 'conflict';}
  const reader=response.body.getReader(),hash=sha256.create();let count=0;
  try {
    while(true) {
      if (signal.aborted) throw new DOMException('Image upload cancelled','AbortError');
      const {done,value}=await reader.read(); if(done) break;
      count+=value.byteLength;
      if (count > bytes.length) {await reader.cancel();return 'conflict';}
      hash.update(value);
    }
  } finally {reader.releaseLock();}
  return count === bytes.length && bytesToHex(hash.digest()) === digest ? 'matches' : 'conflict';
}
/** Create-only, content-addressed assets let a lost acknowledgement recover
 * from the authenticated raw read without overwriting or suffixing a filename. */
export async function uploadProjectImage(projectId: string,file: File,signal: AbortSignal): Promise<ProjectImageReceipt> {
  const {extension,...size}=await decodeProjectImage(file,signal);
  const {bytes,base64}=await imageBytes(file,signal),digest=bytesToHex(sha256(bytes));
  const name=`_studio-image-assets/${digest}.${extension === 'jpeg' ? 'jpg' : extension}`;
  let state=await storedImageMatches(projectId,name,bytes,digest,signal);
  if(state === 'conflict') throw new Error('An existing image does not match these bytes. It was not replaced.');
  if(state === 'missing') {
    await writeProjectBase64File(projectId,name,base64,undefined,{overwrite:false,signal});
    if (signal.aborted) throw new DOMException('Image upload cancelled','AbortError');
    state=await storedImageMatches(projectId,name,bytes,digest,signal);
  }
  if(state !== 'matches') throw new Error('The image could not be confirmed. Retry the same image.');
  if(signal.aborted) throw new DOMException('Image upload cancelled','AbortError');
  return {name,alt:(file.name.replace(/\.[^.]+$/,'') || 'Image').slice(0,2000),...size};
}
