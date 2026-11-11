import { RiSlideshow3Line, RiStickyNoteLine } from '@remixicon/react';
import { Dropdown, DropdownTrigger, DropdownPopover, DropdownItem } from './boardui/dropdown';

/** Presentation intent belongs to the deck, not the technical file menu. */
export function DeckPresentationMenu({ onPresent }: { onPresent(withNotes: boolean): void }) {
  return <Dropdown>
    <DropdownTrigger aria-label="Present" className="flex size-8 shrink-0 items-center justify-center rounded-lg p-0 text-foreground-icon-secondary hover:bg-background-secondary-hover">
      <RiSlideshow3Line className="size-4 shrink-0" aria-hidden />
    </DropdownTrigger>
    <DropdownPopover aria-label="Present" placement="bottom end">
      <DropdownItem onSelect={() => onPresent(false)}><RiSlideshow3Line className="size-4 shrink-0" aria-hidden />Present</DropdownItem>
      <DropdownItem onSelect={() => onPresent(true)}><RiStickyNoteLine className="size-4 shrink-0" aria-hidden />Present with speaker notes</DropdownItem>
    </DropdownPopover>
  </Dropdown>;
}
