import { RiMore2Fill, RiEditLine, RiDeleteBinLine, RiRestartLine } from '@remixicon/react';
import { Dropdown, DropdownTrigger, DropdownPopover, DropdownItem } from './boardui/dropdown';

export function CommentThreadMenu({ canEdit, canDelete, onEdit, onDelete, onReopen, kind = 'thread' }: {
  kind?: 'thread' | 'reply';
  onReopen?(): void | Promise<unknown>;
  canEdit: boolean; canDelete: boolean; onEdit(): void; onDelete(): void | Promise<unknown>;
}) {
  if (!canEdit && !canDelete && !onReopen) return null;
  return <div onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
    <Dropdown>
      <DropdownTrigger aria-label={kind === 'reply' ? 'Reply actions' : 'Comment actions'} className="flex size-8 items-center justify-center rounded-lg text-foreground-icon-secondary hover:bg-background-secondary-hover"><RiMore2Fill className="size-4" aria-hidden /></DropdownTrigger>
      <DropdownPopover aria-label="Comment actions" placement="bottom end" className="w-44">
        {onReopen ? <DropdownItem onSelect={() => { void onReopen(); }}><RiRestartLine className="size-4" aria-hidden />Reopen</DropdownItem> : null}
        {canEdit ? <DropdownItem onSelect={onEdit}><RiEditLine className="size-4" aria-hidden />Edit</DropdownItem> : null}
        {canDelete ? <DropdownItem onSelect={() => { void onDelete(); }}><RiDeleteBinLine className="size-4" aria-hidden /><span className="text-text-error-primary">{kind === 'reply' ? 'Delete reply' : 'Delete thread'}</span></DropdownItem> : null}
      </DropdownPopover>
    </Dropdown>
  </div>;
}
