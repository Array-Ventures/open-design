/** File extension selects a local demuxer, never a URL or automatic manifest.
 * Presence of the required streams and all byte/time/frame limits remain worker checks. */
const inputs: Record<string, { kind: 'video' | 'audio'; demuxer: string }> = {
  mp4: { kind: 'video', demuxer: 'mov' }, mov: { kind: 'video', demuxer: 'mov' }, webm: { kind: 'video', demuxer: 'matroska' }, mkv: { kind: 'video', demuxer: 'matroska' },
  m4a: { kind: 'audio', demuxer: 'mov' }, mp3: { kind: 'audio', demuxer: 'mp3' }, wav: { kind: 'audio', demuxer: 'wav' }, ogg: { kind: 'audio', demuxer: 'ogg' }, flac: { kind: 'audio', demuxer: 'flac' }, aac: { kind: 'audio', demuxer: 'aac' },
};
function input(fileName: string) {
  const name = fileName.split('/').at(-1) ?? '', dot = name.lastIndexOf('.'), extension = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  return Object.hasOwn(inputs, extension) ? inputs[extension] : undefined;
}
export const mediaInputDemuxer = (fileName: string): string | undefined => input(fileName)?.demuxer;
export const mediaArtifactKind = (fileName: string): 'video' | 'audio' | undefined => input(fileName)?.kind;
export function mediaArtifactFormats(fileName: string, kind: string): ('mp4' | 'webm' | 'mp3' | 'wav')[] {
  const actual = mediaArtifactKind(fileName);
  return actual !== kind ? [] : actual === 'video' ? ['mp4', 'webm'] : actual === 'audio' ? ['mp3', 'wav'] : [];
}
