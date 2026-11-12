import { expect, it } from 'vitest';
import { mediaArtifactKind, mediaArtifactFormats, mediaInputDemuxer } from '../src/runtime/media-export.js';
it.each([['clip.mp4', 'video', 'mov'], ['clip.MOV', 'video', 'mov'], ['clip.webm', 'video', 'matroska'], ['clip.mkv', 'video', 'matroska'], ['sound.m4a', 'audio', 'mov'], ['sound.mp3', 'audio', 'mp3'], ['sound.wav', 'audio', 'wav'], ['sound.ogg', 'audio', 'ogg'], ['sound.flac', 'audio', 'flac'], ['sound.aac', 'audio', 'aac']])('binds %s capabilities to its explicit worker demuxer', (file, kind, demuxer) => {
  expect(mediaArtifactKind(file!)).toBe(kind); expect(mediaInputDemuxer(file!)).toBe(demuxer); expect(mediaArtifactFormats(file!, kind!)).toEqual(kind === 'video' ? ['mp4', 'webm'] : ['mp3', 'wav']);
  expect(mediaArtifactFormats(file!, kind === 'video' ? 'audio' : 'video')).toEqual([]);
});
it.each(['logo.png', 'logo.svg', 'index.html', 'playlist.m3u8', 'list.ffconcat', 'track.opus', '.mp4', 'file.__proto__', 'file.constructor', 'dot.dir/no-extension'])('does not invent a media conversion for %s', file => {
  expect(mediaInputDemuxer(file)).toBeUndefined(); expect(mediaArtifactFormats(file, 'video')).toEqual([]); expect(mediaArtifactFormats(file, 'audio')).toEqual([]);
});
