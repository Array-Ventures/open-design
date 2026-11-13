import {useLayoutEffect,useRef,useState} from 'react';
import {RiImageLine} from '@remixicon/react';
import {Button} from './boardui/button';
import {cx} from './boardui/cx';
import {DOCUMENT_ICON_BUTTON} from './document/document-controls';
import {uploadProjectImage,type ProjectImageReceipt} from './project-image-upload';
export type ArtifactImageState = 'empty'|'uploading'|'ready'|'failed';
interface Props {
  projectId:string; disabled:boolean; active?:boolean; reset:number; consumed:number;
  getSource():string|null;
  onImage(asset:ProjectImageReceipt):Promise<void>;
  onStatus(message:string|null):void;
  onStateChange(state:ArtifactImageState):void;
}
/** An upload receipt belongs to this project/file controller. Late results
 * cannot place an image after unmount/reset or silently target changed source. */
export function ArtifactImagePicker(props:Props) {
  const current=useRef(props),input=useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {current.current=props;});
  const life=useRef({active:true,generation:0,controller:null as AbortController|null});
  const receipt=useRef<ProjectImageReceipt|null>(null),picked=useRef<File|null>(null),chosenSource=useRef<string|null>(null);
  const [state,setState]=useState<ArtifactImageState>('empty');
  const report=(next:ArtifactImageState) => {setState(next);current.current.onStateChange(next);};
  useLayoutEffect(() => {
    const instance=life.current;instance.active=true;
    return () => {instance.active=false;instance.generation++;instance.controller?.abort();};
  },[]);
  useLayoutEffect(() => {
    life.current.generation++;life.current.controller?.abort();life.current.controller=null;
    receipt.current=null;picked.current=null;chosenSource.current=null;
    report('empty');
  },[props.reset,props.consumed]);
  const upload=async (file:File) => {
    if(current.current.disabled || life.current.controller) return;
    const instance=life.current,generation=++instance.generation,controller=new AbortController();
    instance.controller=controller;picked.current=file;
    const source=chosenSource.current;
    report('uploading');current.current.onStatus('Uploading image…');
    try {
      const asset=await uploadProjectImage(current.current.projectId,file,controller.signal);
      if(!instance.active || instance.generation !== generation || controller.signal.aborted) return;
      receipt.current=asset;report('ready');
      if(source === null || current.current.getSource() !== source) {
        current.current.onStatus('Image uploaded. Select Image to place it in the updated artifact.');return;
      }
      await current.current.onImage(asset);
    } catch(error) {
      if(!instance.active || instance.generation !== generation || controller.signal.aborted) return;
      report(receipt.current ? 'ready' : 'failed');
      current.current.onStatus(receipt.current ? 'Image uploaded. Select Image to place it.' : error instanceof Error ? error.message : 'The image could not be uploaded.');
    } finally {if(instance.controller === controller) instance.controller=null;}
  };
  const choose=() => {
    if(current.current.disabled || state === 'uploading') return;
    if(receipt.current) {
      const generation=life.current.generation;
      void current.current.onImage(receipt.current).catch(() => {if(life.current.active && life.current.generation === generation) current.current.onStatus('Image uploaded. Select Image to place it.');});
      return;
    }
    if(picked.current) {chosenSource.current=current.current.getSource();void upload(picked.current);return;}
    chosenSource.current=current.current.getSource();input.current?.click();
  };
  const label=state === 'ready' ? 'Insert uploaded image' : state === 'failed' ? 'Retry image upload' : 'Insert image';
  return <>
    <Button variant="ghost" size="small" iconOnly leadingIcon={RiImageLine} className={cx(DOCUMENT_ICON_BUTTON,props.active && 'bg-accent-100 text-accent-700')} aria-pressed={props.active === true} disabled={props.disabled || state === 'uploading'} aria-label={label} title={state === 'uploading' ? 'Uploading image…' : label} onClick={choose} />
    <input ref={input} hidden type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" aria-label="Choose artifact image" onChange={event => {
      const file=event.currentTarget.files?.[0];event.currentTarget.value='';if(file) void upload(file);
    }} />
  </>;
}
