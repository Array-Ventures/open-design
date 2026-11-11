import type { PreviewCommentAttachment } from '@open-design/contracts';
import { projectFileUrl } from '../../providers/registry';
import { RiCloseLine } from '@remixicon/react';
import { Button } from './boardui/button';

export function ReplyImages({ projectId, saved = [], fresh = [], onRemoveSaved, onRemoveFresh }: {
  projectId: string; saved?: PreviewCommentAttachment[]; fresh?: { file: File; url: string }[];
  onRemoveSaved?(path: string): void; onRemoveFresh?(file: File): void;
}) {
  if (!saved.length && !fresh.length) return null;
  return <div className="flex flex-wrap gap-2" aria-label="Reply images">
    {saved.map(image => <div key={image.path} className="relative">
      <a href={projectFileUrl(projectId, image.path)} target="_blank" rel="noopener noreferrer" aria-label={`Preview ${image.name}`} className="block overflow-hidden rounded-lg border border-separator-border">
        <img src={projectFileUrl(projectId, image.path)} alt={image.name} className="size-16 object-cover" />
      </a>
      {onRemoveSaved ? <RemoveImage name={image.name} onClick={() => onRemoveSaved(image.path)} /> : null}
    </div>)}
    {fresh.map(image => <div key={image.url} className="relative">
      <a href={image.url} target="_blank" rel="noopener noreferrer" aria-label={`Preview ${image.file.name}`} className="block overflow-hidden rounded-lg border border-separator-border"><img src={image.url} alt={image.file.name} className="size-16 object-cover" /></a>
      {onRemoveFresh ? <RemoveImage name={image.file.name} onClick={() => onRemoveFresh(image.file)} /> : null}
    </div>)}
  </div>;
}
function RemoveImage({ name, onClick }: { name: string; onClick(): void }) {
  return <Button variant="ghost" size="xs" iconOnly leadingIcon={RiCloseLine} aria-label={`Remove ${name}`} title="Remove image" onClick={onClick}
    className="absolute -end-1 -top-1 size-6 rounded-full border border-separator-border bg-background-full p-0 text-foreground-icon-secondary shadow-none hover:bg-background-secondary-hover" />;
}
