import { RiChatNewLine, RiMarkPenLine } from '@remixicon/react';
import { Button } from './boardui/button';

export function ArtifactAnnotationControls({ commenting, marking, onComment, onMark, disabled }: {
  commenting: boolean; marking: boolean; onComment(): void; onMark(): void; disabled?: boolean;
}) {
  return <div className="artifact-inline-actions" role="toolbar" aria-label="Artifact feedback">
    <Button iconOnly size="small" variant={commenting ? 'secondary' : 'ghost'} leadingIcon={RiChatNewLine}
      aria-label="Comment" title="Comment" aria-pressed={commenting} disabled={disabled} onClick={onComment} />
    <Button iconOnly size="small" variant={marking ? 'secondary' : 'ghost'} leadingIcon={RiMarkPenLine}
      aria-label="Markup" title="Markup" aria-pressed={marking} disabled={disabled} onClick={onMark} />
  </div>;
}
