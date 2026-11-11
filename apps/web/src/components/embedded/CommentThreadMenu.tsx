import { RiMore2Fill, RiEditLine, RiDeleteBinLine, RiRestartLine, RiChat3Line } from '@remixicon/react';
import { Dropdown, DropdownTrigger, DropdownPopover, DropdownItem } from './boardui/dropdown';

export function CommentThreadMenu({ canEdit, canDelete, onEdit, onDelete, onReopen, onViewAll, kind = 'thread' }: {
  onViewAll?(): void;
  kind?: 'thread' | 'reply';
  onReopen?(): void | Promise<unknown>;
  canEdit: boolean; canDelete: boolean; onEdit(): void; onDelete(): void | Promise<unknown>;
}) {
  if (!canEdit && !canDelete && !onReopen && !onViewAll) return null;
  return <div onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
    <Dropdown>
      <DropdownTrigger aria-label={kind === 'reply' ? 'Reply actions' : 'Comment actions'} className="box-border flex size-8 shrink-0 items-center justify-center rounded-lg border-0 bg-transparent p-0 text-foreground-icon-secondary shadow-none hover:bg-background-secondary-hover"><RiMore2Fill className="size-4" aria-hidden /></DropdownTrigger>
      <DropdownPopover aria-label="Comment actions" placement="bottom end" className="w-44">
        {onViewAll ? <DropdownItem onSelect={onViewAll}><RiChat3Line className="size-4" aria-hidden />View all comments</DropdownItem> : null}
        {onReopen ? <DropdownItem onSelect={() => { void onReopen(); }}><RiRestartLine className="size-4" aria-hidden />Reopen</DropdownItem> : null}
        {canEdit ? <DropdownItem onSelect={onEdit}><RiEditLine className="size-4" aria-hidden />Edit</DropdownItem> : null}
        {canDelete ? <DropdownItem onSelect={() => { void onDelete(); }}><RiDeleteBinLine className="size-4" aria-hidden /><span className="text-text-error-primary">{kind === 'reply' ? 'Delete reply' : 'Delete thread'}</span></DropdownItem> : null}
      </DropdownPopover>
    </Dropdown>
  </div>;
}
