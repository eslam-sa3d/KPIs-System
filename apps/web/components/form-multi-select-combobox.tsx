'use client';

import { useState } from 'react';
import { Check } from 'lucide-react';
import type { FormListItem } from '@pulse/contracts';
import { api } from '../lib/api-client';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

/** Searchable multi-select of Forms, same stays-open/checkmark pattern as
 *  UserMultiSelectCombobox — powers the dashboard's form-scope picker. */
export function FormMultiSelectCombobox({
  selectedIds,
  onToggle,
  disabled,
  triggerLabel = 'choose a form',
}: {
  selectedIds: Set<string>;
  onToggle: (form: FormListItem) => void;
  disabled?: boolean;
  triggerLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [forms, setForms] = useState<FormListItem[] | null>(null);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next && forms === null) {
          // /v1/forms is the admin management list and deliberately includes
          // archived forms (so "unarchive" stays reachable there) — this picker
          // is choosing which forms feed the live dashboard, where an archived
          // form is never a meaningful choice, so it's excluded here instead.
          api<FormListItem[]>('/v1/forms')
            .then((all) => setForms(all.filter((f) => f.status !== 'archived')))
            .catch(() => setForms([]));
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
          <CommandInput placeholder="search forms…" />
          <CommandList>
            <CommandEmpty>{forms === null ? 'loading…' : 'no match.'}</CommandEmpty>
            <CommandGroup>
              {forms?.map((f) => (
                <CommandItem
                  key={f.id}
                  value={f.title}
                  onSelect={() => onToggle(f)}
                  style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}
                >
                  <Check className={cn('size-4', selectedIds.has(f.id) ? 'opacity-100' : 'opacity-0')} />
                  <span className="truncate" style={{ flex: '1 1 auto', minWidth: 0 }}>
                    {f.title}
                  </span>
                  <span className="truncate" style={{ flex: '0 0 auto', fontSize: 12, opacity: 0.65 }}>
                    {f.status}
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
