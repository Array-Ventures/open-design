import { useEffect, useRef, useState, type ReactNode, type SyntheticEvent } from 'react';

interface Props {
  kind: 'audio' | 'video';
  src: string;
  unavailable: string;
  actions: ReactNode;
}

/** Each source revision owns its native element and error state. The caller
 * retains project authorization, URL construction and original-file actions. */
export function MediaPlayback(props: Props) {
  return <PlaybackSource key={`${props.kind}:${props.src}`} {...props} />;
}

function PlaybackSource({ kind, src, unavailable, actions }: Props) {
  const [failed, setFailed] = useState(false);
  const media = useRef<HTMLMediaElement | null>(null);
  useEffect(() => {
    const owned = media.current;
    return () => { owned?.pause(); };
  }, []);
  const error = (event: SyntheticEvent<HTMLMediaElement>) => {
    // A native MediaError, not arbitrary event text, witnesses failure. Its code
    // does not reliably distinguish codec support from network/decoding causes.
    if (event.currentTarget.error) {
      event.currentTarget.pause();
      setFailed(true);
    }
  };
  if (failed) return <div role="alert" className="flex flex-col items-center gap-2 p-4 text-center text-body-2-regular text-text-secondary">
    <p>{unavailable}</p>
    {actions}
  </div>;
  return kind === 'video'
    ? <video ref={node => { media.current = node; }} src={src} controls playsInline preload="metadata" onError={error} />
    : <audio ref={node => { media.current = node; }} src={src} controls preload="metadata" onError={error} />;
}
