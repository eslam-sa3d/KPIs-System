'use client';

import { useState } from 'react';
import { Check } from 'lucide-react';
import { api } from '../lib/api-client';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export interface UserPickerOption {
  id: string;
  email: string;
  displayName: string;
}

/** Searchable multi-select sibling to UserPickerCombobox: stays open across
 *  clicks and shows a checkmark for every id in `selectedIds`, so it doubles
 *  as both the current-membership view and the add/remove control. */
export function UserMultiSelectCombobox({
  selectedIds,
  onToggle,
  disabled,
  triggerLabel = 'add members',
}: {
  selectedIds: Set<string>;
  onToggle: (user: UserPickerOption) => void;
  disabled?: boolean;
  triggerLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [users, setUsers] = useState<UserPickerOption[] | null>(null);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next && users === null) {
          api<UserPickerOption[]>('/v1/users?pageSize=200')
            .then(setUsers)
            .catch(() => setUsers([]));
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={disabled}>
          {triggerLabel}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[420px] p-0" align="start">
        <Command>
          <CommandInput placeholder="search people…" />
          <CommandList>
            <CommandEmpty>{users === null ? 'loading…' : 'no match.'}</CommandEmpty>
            <CommandGroup>
              {users?.map((u) => (
                <CommandItem
                  key={u.id}
                  value={`${u.displayName} ${u.email}`}
                  onSelect={() => onToggle(u)}
                  style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}
                >
                  <Check className={cn('size-4', selectedIds.has(u.id) ? 'opacity-100' : 'opacity-0')} />
                  <span className="truncate" style={{ flex: '0 1 auto' }}>
                    {u.displayName}
                  </span>
                  <span className="truncate" style={{ flex: '1 1 auto', fontSize: 12, minWidth: 0, opacity: 0.65 }}>
                    {u.email}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
