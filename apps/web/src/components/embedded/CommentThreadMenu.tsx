import { RiMore2Fill, RiEditLine, RiDeleteBinLine } from '@remixicon/react';
import { Dropdown, DropdownTrigger, DropdownPopover, DropdownItem } from './boardui/dropdown';

export function CommentThreadMenu({ canEdit, canDelete, onEdit, onDelete }: {
  canEdit: boolean; canDelete: boolean; onEdit(): void; onDelete(): void | Promise<unknown>;
}) {
  if (!canEdit && !canDelete) return null;
  return <div onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
    <Dropdown>
      <DropdownTrigger aria-label="Comment actions" className="flex size-8 items-center justify-center rounded-lg text-foreground-icon-secondary hover:bg-background-secondary-hover"><RiMore2Fill className="size-4" aria-hidden /></DropdownTrigger>
      <DropdownPopover aria-label="Comment actions" placement="bottom end" className="w-44">
        {canEdit ? <DropdownItem onSelect={onEdit}><RiEditLine className="size-4" aria-hidden />Edit</DropdownItem> : null}
        {canDelete ? <DropdownItem onSelect={() => { void onDelete(); }}><RiDeleteBinLine className="size-4" aria-hidden /><span className="text-text-error-primary">Delete thread</span></DropdownItem> : null}
      </DropdownPopover>
    </Dropdown>
  </div>;
}
