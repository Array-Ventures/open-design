import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { mediaArtifactFormats } from '@open-design/contracts';
const runtime = vi.hoisted(() => ({ exec: vi.fn(), launch: vi.fn() }));
vi.mock('node:child_process', async original => {
  const { promisify } = await import('node:util');
  return { ...await original<object>(), execFile: Object.assign(vi.fn(), { [promisify.custom]: runtime.exec }) };
});
vi.mock('playwright-core', () => ({ chromium: { launch: runtime.launch } }));
import { renderSnapshot } from '../src/embedded-render/runner.js';
import { kindFor, mimeFor } from '../src/projects.js';
let directory: string, source: string, output: string;
let metadata: { format: { duration: string }; streams: { codec_type: string; width?: number; height?: number; avg_frame_rate?: string }[] };
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'od-media-dispatch-')); source = path.join(directory, 'source'); output = path.join(directory, 'output'); await mkdir(source); await mkdir(output);
  metadata = { format: { duration: '1' }, streams: [{ codec_type: 'video', width: 64, height: 64, avg_frame_rate: '30/1' }, { codec_type: 'audio' }] };
  runtime.launch.mockImplementation(() => { throw Error('Binary media must not launch the HTML renderer'); });
  runtime.exec.mockImplementation(async (command: string, args: string[]) => {
    if (command === '/usr/bin/ffprobe') return { stdout: JSON.stringify(args.includes('-show_format') ? metadata : { format: { duration: '1' } }), stderr: '' };
    expect(command).toBe('/usr/bin/ffmpeg'); await writeFile(args.at(-1)!, new Uint8Array([0, 255, 137, 80])); return { stdout: '', stderr: '' };
  });
});
afterEach(async () => { vi.resetAllMocks(); await rm(directory, { recursive: true, force: true }); });
it.each([
  ['clip.mp4', 'video', 'mov', 'video/mp4'], ['clip.mov', 'video', 'mov', 'video/quicktime'], ['clip.webm', 'video', 'matroska', 'video/webm'], ['clip.mkv', 'video', 'matroska', 'video/x-matroska'],
  ['voice.mp3', 'audio', 'mp3', 'audio/mpeg'], ['voice.wav', 'audio', 'wav', 'audio/wav'], ['voice.m4a', 'audio', 'mov', 'audio/mp4'], ['voice.ogg', 'audio', 'ogg', 'audio/ogg'], ['voice.flac', 'audio', 'flac', 'audio/flac'], ['voice.aac', 'audio', 'aac', 'audio/aac'],
])('dispatches all advertised %s exports to the bounded local encoder before any HTML decoding', async (fileName, kind, demuxer, mime) => {
  expect(kindFor(fileName)).toBe(kind); expect(mimeFor(fileName)).toBe(mime);
  const bytes = new Uint8Array([0, 255, 0, 128, 137, 80]); await writeFile(path.join(source, fileName), bytes);
  for (const format of mediaArtifactFormats(fileName, kind)) {
    const result = await renderSnapshot(source, output, { fileName, format });
    expect(result).toEqual({ file: `artifact.${format}`, mime: { mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav' }[format] });
    const probe = runtime.exec.mock.calls.find(([command, args]) => command === '/usr/bin/ffprobe' && args.includes('-show_format'))!;
    expect(probe[1]).toEqual(expect.arrayContaining(['-protocol_whitelist', 'file,pipe', '-f', demuxer, '-i', path.join(source, fileName)])); expect(probe[2]).toMatchObject({ timeout: 20_000, maxBuffer: 128 * 1024 });
    const encoded = runtime.exec.mock.calls.filter(([command]) => command === '/usr/bin/ffmpeg').at(-1)!;
    expect(encoded[1]).toEqual(expect.arrayContaining(['-nostdin', '-n', '-threads', '1', '-t', '120', '-fs', String(248 * 1024 * 1024)])); expect(encoded[2]).toMatchObject({ timeout: 120_000, maxBuffer: 128 * 1024 });
    expect(new Uint8Array(await readFile(path.join(output, result.file)))).toEqual(new Uint8Array([0, 255, 137, 80]));
  }
  expect(new Uint8Array(await readFile(path.join(source, fileName)))).toEqual(bytes); expect(runtime.launch).not.toHaveBeenCalled();
});
it.each([
  { duration: '0' }, { duration: '121' }, { duration: 'unknown' }, { width: 3841 }, { height: 2161 }, { fps: '61/1' }, { fps: '1/0' }, { streams: [] },
])('refuses unsupported media metadata before invoking an encoder: %j', async limits => {
  await writeFile(path.join(source, 'clip.mp4'), 'fixture');
  if ('duration' in limits) metadata.format.duration = limits.duration!;
  if ('width' in limits) metadata.streams[0]!.width = limits.width;
  if ('height' in limits) metadata.streams[0]!.height = limits.height;
  if ('fps' in limits) metadata.streams[0]!.avg_frame_rate = limits.fps;
  if ('streams' in limits) metadata.streams = limits.streams!;
  await expect(renderSnapshot(source, output, { fileName: 'clip.mp4', format: 'mp4' })).rejects.toThrow();
  expect(runtime.exec.mock.calls.some(([command]) => command === '/usr/bin/ffmpeg')).toBe(false); expect(runtime.launch).not.toHaveBeenCalled();
});
it('refuses oversized inputs and source escapes without probing, and never advertises image conversion', async () => {
  await writeFile(path.join(source, 'large.mp4'), ''); await truncate(path.join(source, 'large.mp4'), 250 * 1024 * 1024 + 1);
  await expect(renderSnapshot(source, output, { fileName: 'large.mp4', format: 'mp4' })).rejects.toThrow('byte limit');
  await writeFile(path.join(directory, 'outside.wav'), 'fixture'); await symlink(path.join(directory, 'outside.wav'), path.join(source, 'escape.wav'));
  await expect(renderSnapshot(source, output, { fileName: 'escape.wav', format: 'wav' })).rejects.toThrow('outside');
  expect(runtime.exec).not.toHaveBeenCalled(); expect(mediaArtifactFormats('logo.png', 'image')).toEqual([]); expect(mediaArtifactFormats('logo.svg', 'image')).toEqual([]);
});
