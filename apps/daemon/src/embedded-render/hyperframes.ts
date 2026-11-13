import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from 'playwright-core';
import { hyperFramesAudioEncodingArgs, type HyperFramesAudioTrack } from '../media/hyperframes-audio.js';

/** Capture through upstream's frame bridge and stream PNGs directly to FFmpeg;
 * no unbounded frame directory is materialized on the host or tmpfs. */
export async function captureHyperFrames(page: Page, output: string, tracks: HyperFramesAudioTrack[]) {
  const metrics = await page.evaluate('window.__odFrameRenderer.ready()') as { duration: number; fps: number };
  const { duration, fps } = metrics;
  if (!Number.isFinite(duration) || duration <= 0 || duration > 120 || !Number.isFinite(fps) || fps < 1 || fps > 60) throw new Error('HyperFrames export requires 0–120 seconds at 1–60 fps.');
  const frames = Math.ceil(duration * fps);
  if (frames > 3600) throw new Error('HyperFrames export exceeds its 3,600-frame limit.');
  const file = 'artifact.mp4';
  const child = spawn('/usr/bin/ffmpeg', ['-nostdin', '-n', '-hide_banner', '-loglevel', 'error', '-threads', '1',
    '-protocol_whitelist', 'pipe', '-f', 'image2pipe', '-framerate', String(fps), '-vcodec', 'png', '-i', 'pipe:0',
    ...tracks.flatMap((track) => ['-protocol_whitelist', 'file,pipe', '-f', track.format, '-i', track.file]),
    ...hyperFramesAudioEncodingArgs(tracks, duration),
    '-map_metadata', '-1', '-map_chapters', '-1', '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2',
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-threads', '1', '-t', String(duration), '-fs', String(248 * 1024 * 1024), '-movflags', '+faststart', path.join(output, file)],
  { stdio: ['pipe', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-8000); });
  const finished = new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => code === 0 ? resolve() : reject(new Error(`HyperFrames encoder failed: ${stderr}`)));
  });
  void finished.catch(() => {});
  // EPIPE also reaches write callbacks; a listener prevents an unhandled event.
  child.stdin.on('error', () => {});
  const timer = setTimeout(() => child.kill('SIGKILL'), 150_000); timer.unref();
  try {
    for (let index = 0; index < frames; index++) {
      await page.evaluate(`window.__odFrameRenderer.seek(${index / fps})`);
      const frame = await page.screenshot({ type: 'png', timeout: 10_000 });
      await new Promise<void>((resolve, reject) => { child.stdin.write(frame, (error) => error ? reject(error) : resolve()); });
    }
    child.stdin.end(); await finished;
    if ((await stat(path.join(output, file))).size > 250 * 1024 * 1024) throw new Error('HyperFrames output exceeds its byte limit.');
    const probed = await promisify(execFile)('/usr/bin/ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=nb_frames', '-of', 'json', path.join(output, file)], { timeout: 20_000, maxBuffer: 4096 });
    const actualFrames = Number((JSON.parse(probed.stdout) as { streams?: { nb_frames?: string }[] }).streams?.[0]?.nb_frames);
    if (actualFrames !== frames) throw new Error('HyperFrames export did not preserve every requested frame within its output limits.');
    return { file, mime: 'video/mp4' };
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null) child.kill('SIGKILL');
    await finished.catch(() => {});
  }
}
