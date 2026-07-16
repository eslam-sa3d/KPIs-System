'use client';

import { useState } from 'react';
import type { KpiOptionSummary } from '@pulse/contracts';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export interface SubCriteriaPickerOption {
  id: string;
  name: string;
  kpiName: string;
  areaName: string;
}

/** Flattens every Sub-Criteria across every KPI's Evaluation Areas into one
 *  searchable list — `kpis` is whatever's already loaded for the KPI-link
 *  combobox on this same page, so this needs no fetch of its own. */
function flattenSubCriteria(kpis: KpiOptionSummary[]): SubCriteriaPickerOption[] {
  return kpis.flatMap((kpi) =>
    kpi.evaluationAreas.flatMap((area) =>
      area.subCriteria.map((sub) => ({ id: sub.id, name: sub.name, kpiName: kpi.name, areaName: area.name })),
    ),
  );
}

/** Searchable "pick an existing Sub-Criteria" popover for the field label
 *  input — selecting one fills the label with that Sub-Criteria's own name,
 *  same as picking a real user does elsewhere (see UserPickerCombobox);
 *  typing a plain label still works exactly as before, this is purely an
 *  optional shortcut. Trigger renders as plain text below the label input. */
export function SubCriteriaPickerCombobox({
  kpis,
  onSelect,
  disabled,
}: {
  kpis: KpiOptionSummary[] | null;
  onSelect: (subCriteria: SubCriteriaPickerOption) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const options = kpis ? flattenSubCriteria(kpis) : [];

  if (kpis !== null && options.length === 0) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" className="option-row-other-link" disabled={disabled || kpis === null}>
          Choose from sub-criteria
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[420px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search sub-criteria…" />
          <CommandList>
            <CommandEmpty>No match.</CommandEmpty>
            <CommandGroup>
              {options.map((o) => (
                <CommandItem
                  key={o.id}
                  value={`${o.name} ${o.kpiName} ${o.areaName}`}
                  onSelect={() => {
                    onSelect(o);
                    setOpen(false);
                  }}
                  style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}
                >
                  <span className="truncate" style={{ flex: '0 1 auto' }}>
                    {o.name}
                  </span>
                  <span className="truncate" style={{ flex: '1 1 auto', fontSize: 12, minWidth: 0, opacity: 0.65 }}>
                    {o.kpiName} — {o.areaName}
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
