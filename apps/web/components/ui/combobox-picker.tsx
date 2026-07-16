'use client';

import type { ReactNode } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLazyComboboxItems } from '../../lib/use-lazy-combobox-items';
import { Button } from './button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from './command';
import { Popover, PopoverContent, PopoverTrigger } from './popover';

/**
 * Shared scaffold behind UserPickerCombobox/UserMultiSelectCombobox/
 * FormMultiSelectCombobox: a searchable popover list, lazily fetched on
 * first open. Passing `selectedIds` switches it into multi-select mode —
 * a Check renders per row and the popover stays open across picks, instead
 * of closing after a single choice.
 */
export function ComboboxPicker<T>({
  fetchItems,
  getId,
  getSearchValue,
  renderItem,
  searchPlaceholder,
  triggerLabel,
  triggerVariant = 'outline',
  triggerSize,
  triggerClassName,
  disabled,
  selectedIds,
  onSelect,
}: {
  fetchItems: () => Promise<T[]>;
  getId: (item: T) => string;
  getSearchValue: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  searchPlaceholder: string;
  triggerLabel: string;
  triggerVariant?: 'ghost' | 'outline';
  triggerSize?: 'default' | 'sm';
  triggerClassName?: string;
  disabled?: boolean;
  /** Present => multi-select: shows a Check per row, stays open across picks. */
  selectedIds?: Set<string>;
  onSelect: (item: T) => void;
}) {
  const { open, onOpenChange, items } = useLazyComboboxItems(fetchItems);
  const multi = selectedIds !== undefined;

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant={triggerVariant}
          size={triggerSize}
          className={triggerClassName}
          disabled={disabled}
        >
          {triggerLabel}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[420px] p-0" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{items === null ? 'Loading…' : 'No match.'}</CommandEmpty>
            <CommandGroup>
              {items?.map((item) => {
                const id = getId(item);
                return (
                  <CommandItem
                    key={id}
                    value={getSearchValue(item)}
                    onSelect={() => {
                      onSelect(item);
                      if (!multi) onOpenChange(false);
                    }}
                    style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}
                  >
                    {multi && <Check className={cn('size-4', selectedIds!.has(id) ? 'opacity-100' : 'opacity-0')} />}
                    {renderItem(item)}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
