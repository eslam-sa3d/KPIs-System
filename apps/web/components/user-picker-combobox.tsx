'use client';

import { useState } from 'react';
import { api } from '../lib/api-client';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export interface UserPickerOption {
  id: string;
  email: string;
  displayName: string;
}

/** Searchable "pick a real user" popover, fetched lazily on first open so a
 *  page with several triggers (one per option row) doesn't fetch the roster
 *  until it's actually needed. Trigger renders as plain text, matching the
 *  "add option"/"add Other" links it sits beside. */
export function UserPickerCombobox({
  onSelect,
  disabled,
  triggerLabel = 'select a user',
}: {
  onSelect: (user: UserPickerOption) => void;
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
        <Button type="button" variant="ghost" className="option-row-other-link" disabled={disabled}>
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
                  onSelect={() => {
                    onSelect(u);
                    setOpen(false);
                  }}
                  style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}
                >
                  <span className="truncate" style={{ flex: '0 1 auto' }}>
                    {u.displayName}
                  </span>
                  {/* opacity dims relative to whatever the current text color is (default
                      foreground, or accent-foreground when this item is keyboard-selected)
                      instead of a fixed muted gray, which reads as illegible against the
                      selected item's own accent background. */}
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
