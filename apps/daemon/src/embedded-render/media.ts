import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

const exec = promisify(execFile);
const demuxers: Record<string, string> = { '.mp4': 'mov', '.m4a': 'mov', '.mov': 'mov', '.webm': 'matroska', '.mkv': 'matroska', '.mp3': 'mp3', '.wav': 'wav', '.ogg': 'ogg', '.flac': 'flac', '.aac': 'aac' };
const formats: Record<string, { mime: string; args: string[]; video: boolean }> = {
  mp4: { mime: 'video/mp4', video: true, args: ['-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart'] },
  webm: { mime: 'video/webm', video: true, args: ['-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '5', '-c:a', 'libopus'] },
  mp3: { mime: 'audio/mpeg', video: false, args: ['-vn', '-c:a', 'libmp3lame', '-b:a', '192k'] },
  wav: { mime: 'audio/wav', video: false, args: ['-vn', '-c:a', 'pcm_s16le'] },
};
export const isMediaExport = (format: string) => Object.hasOwn(formats, format);

/** No shell, URLs, playlists, provider keys or host paths enter this worker.
 * Explicit input demuxers prevent media files from acting as indirect manifests. */
export async function renderMedia(source: string, output: string, fileName: string, format: string) {
  const target = formats[format]; const demuxer = demuxers[path.extname(fileName).toLowerCase()];
  if (!target || !demuxer) throw new Error('Media exports require a supported local audio/video input file, not HTML or a playlist.');
  const root = await realpath(source); const input = await realpath(path.join(root, fileName));
  if (!input.startsWith(root + path.sep)) throw new Error('Media input is outside the snapshot.');
  const info = await stat(input);
  if (!info.isFile() || info.size > 250 * 1024 * 1024) throw new Error('Media input exceeds its byte limit.');
  const inputArgs = ['-protocol_whitelist', 'file,pipe', '-f', demuxer, '-i', input];
  const probed = await exec('/usr/bin/ffprobe', ['-v', 'error', ...inputArgs, '-show_format', '-show_streams', '-of', 'json'], { timeout: 20_000, maxBuffer: 128 * 1024 });
  const metadata = JSON.parse(probed.stdout) as { format?: { duration?: string }; streams?: { codec_type?: string; width?: number; height?: number; avg_frame_rate?: string }[] };
  const duration = Number(metadata.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0 || duration > 120) throw new Error('Media export requires a known duration of at most 120 seconds. Trim longer source files first.');
  const streams = metadata.streams ?? [];
  if (!streams.some((stream) => stream.codec_type === (target.video ? 'video' : 'audio'))) throw new Error(`Source has no ${target.video ? 'video' : 'audio'} stream.`);
  for (const stream of streams.filter((item) => item.codec_type === 'video')) {
    const [numerator = 0, denominator = 1] = (stream.avg_frame_rate ?? '0').split('/').map(Number);
    if (!stream.width || !stream.height || stream.width > 3840 || stream.height > 2160 || !Number.isFinite(numerator / denominator) || numerator / denominator > 60) throw new Error('Media source exceeds the 3840×2160, 60 fps export limit.');
  }
  const file = `artifact.${format}`;
  await exec('/usr/bin/ffmpeg', ['-nostdin', '-n', '-hide_banner', '-loglevel', 'error', '-threads', '1', ...inputArgs,
    '-map', target.video ? '0:v:0' : '0:a:0', ...(target.video ? ['-map', '0:a:0?', '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2'] : []),
    '-map_metadata', '-1', '-map_chapters', '-1', ...target.args, '-threads', '1', '-t', '120', '-fs', String(248 * 1024 * 1024), path.join(output, file)],
  { timeout: 120_000, maxBuffer: 128 * 1024 });
  if ((await stat(path.join(output, file))).size > 250 * 1024 * 1024) throw new Error('Media output exceeds its byte limit.');
  const completed = await exec('/usr/bin/ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', path.join(output, file)], { timeout: 20_000, maxBuffer: 4096 });
  const outputDuration = Number((JSON.parse(completed.stdout) as { format?: { duration?: string } }).format?.duration);
  if (!Number.isFinite(outputDuration) || outputDuration < duration - 0.25 || outputDuration > duration + 0.5) throw new Error('Media export did not preserve the full source duration within its output limits.');
  return { file, mime: target.mime };
}
