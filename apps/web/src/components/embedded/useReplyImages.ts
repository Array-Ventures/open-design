import { useEffect, useRef, useState } from 'react';
import type { PreviewCommentAttachment } from '@open-design/contracts';
import { FeedbackImageUpload } from './feedback-image-upload';

export type ImageDraft = { files: File[]; kept: PreviewCommentAttachment[] };
function limitError(draft: ImageDraft): string | null {
  return draft.files.length + draft.kept.length > 8 || draft.files.some(file => file.size > 25 * 1024 * 1024)
    || draft.files.reduce((size, file) => size + file.size, 0) > 50 * 1024 * 1024 ? 'Use up to 8 images, 25 MB each and 50 MB total.' : null;
}
export function useReplyImages(projectId: string, context: string, onChange: () => void) {
  const [draft, setDraft] = useState<ImageDraft>({ files: [], kept: [] });
  const current = useRef(draft);
  const upload = useRef(new FeedbackImageUpload());
  const [previews, setPreviews] = useState<{ file: File; url: string }[]>([]);
  useEffect(() => {
    const next = draft.files.map(file => ({ file, url: URL.createObjectURL(new Blob([file], { type: /\.png$/i.test(file.name) ? 'image/png' : /\.jpe?g$/i.test(file.name) ? 'image/jpeg' : /\.gif$/i.test(file.name) ? 'image/gif' : 'image/webp' })) }));
    setPreviews(next);
    return () => next.forEach(image => URL.revokeObjectURL(image.url));
  }, [draft.files]);
  function update(next: ImageDraft, announce = true) { current.current = next; setDraft(next); if (announce) onChange(); }
  function reset(kept: PreviewCommentAttachment[] = []) { upload.current.clear(); update({ files: [], kept }, false); }
  function add(files: File[]): string | null {
    const next = [...current.current.files, ...files];
    const problem = limitError({ files: next, kept: current.current.kept });
    if (problem) return problem;
    if (files.some(file => !/\.(png|jpe?g|gif|webp)$/i.test(file.name)
      || file.type && !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type))) return 'Use PNG, JPEG, GIF or WebP images.';
    update({ ...current.current, files: next }); return null;
  }
  async function prepare(snapshot: ImageDraft, signal: AbortSignal): Promise<PreviewCommentAttachment[]> {
    const result = await upload.current.prepare(projectId, snapshot.files, context, signal);
    return result.paths.map((path, index) => ({ path, name: (snapshot.files[index]!.name.replace(/[\r\n\0]/g, ' ').trim() || 'Image').slice(0, 200) }));
  }
  /** Consume only this request's files; later additions/removals stay authoritative. */
  function accepted(snapshot: ImageDraft, uploaded: PreviewCommentAttachment[], editing: boolean) {
    const next = current.current;
    const savedFresh = editing ? uploaded.filter((_, index) => next.files.includes(snapshot.files[index]!)) : [];
    update({ files: next.files.filter(file => !snapshot.files.includes(file)), kept: [...next.kept, ...savedFresh] }, false);
    upload.current.clear();
  }
  function rebase(previous: PreviewCommentAttachment[], latest: PreviewCommentAttachment[]) {
    const before = new Set(previous.map(image => image.path));
    const kept = new Set(current.current.kept.map(image => image.path));
    const removed = new Set(previous.filter(image => !kept.has(image.path)).map(image => image.path));
    const merged = latest.filter(image => !removed.has(image.path));
    const paths = new Set(merged.map(image => image.path));
    for (const image of current.current.kept) if (!before.has(image.path) && !paths.has(image.path)) { merged.push(image); paths.add(image.path); }
    update({ ...current.current, kept: merged }, false);
  }
  return { draft, previews, validate: () => limitError(current.current), read: () => current.current, add, reset, prepare, accepted, rebase,
    hasChanges: (saved: PreviewCommentAttachment[] = []) => Boolean(draft.files.length || JSON.stringify(draft.kept) !== JSON.stringify(saved)),
    removeFresh: (file: File) => update({ ...current.current, files: current.current.files.filter(item => item !== file) }),
    removeKept: (path: string) => update({ ...current.current, kept: current.current.kept.filter(item => item.path !== path) }),
    detach: () => update({ ...current.current, kept: [] }, false),
  };
}
