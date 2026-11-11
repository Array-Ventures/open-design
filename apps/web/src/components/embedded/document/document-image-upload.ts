import { uploadProjectFiles } from '../../../providers/registry';
export type DocumentImageReceipt = { name: string; alt: string; width: number; height: number };
const extensions: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg' };
async function imageSize(file: File, signal: AbortSignal): Promise<{ width: number; height: number }> {
  if (signal.aborted) throw new DOMException('Image upload cancelled', 'AbortError');
  const url = URL.createObjectURL(file); const image = new Image();
  let abort!: () => void;
  try {
    const cancelled = new Promise<never>((_resolve, reject) => { abort = () => { image.removeAttribute('src'); reject(new DOMException('Image upload cancelled', 'AbortError')); }; signal.addEventListener('abort', abort, { once: true }); });
    if (signal.aborted) abort();
    image.src = url; await Promise.race([image.decode(), cancelled]);
    if (image.naturalWidth < 1 || image.naturalHeight < 1 || image.naturalWidth > 10000 || image.naturalHeight > 10000) throw new Error('Choose an image up to 10,000 pixels per side.');
    return { width: image.naturalWidth, height: image.naturalHeight };
  } finally { signal.removeEventListener('abort', abort); URL.revokeObjectURL(url); }
}
export async function uploadDocumentImage(projectId: string, file: File, signal: AbortSignal): Promise<DocumentImageReceipt> {
  if (file.size > 20 * 1024 * 1024) throw new Error('Choose an image smaller than 20 MB.');
  const extension = extensions[file.type] ?? (!file.type ? /\.(png|jpe?g|webp|gif|svg)$/i.exec(file.name)?.[1]?.toLowerCase() : undefined);
  if (!extension) throw new Error('Choose a PNG, JPEG, WebP, GIF or SVG image.');
  const size = await imageSize(file, signal);
  if (signal.aborted) throw new DOMException('Image upload cancelled', 'AbortError');
  const asset = new File([file], `${crypto.randomUUID()}.${extension}`, { type: file.type });
  const result = await uploadProjectFiles(projectId, [asset], '_studio-document-assets', undefined, signal);
  if (signal.aborted) throw new DOMException('Image upload cancelled', 'AbortError');
  const receipt = result.uploaded[0];
  if (!receipt || result.failed.length) throw new Error('The image could not be uploaded. Try again.');
  return { name: receipt.path, alt: file.name.replace(/\.[^.]+$/, '') || 'Image', ...size };
}
