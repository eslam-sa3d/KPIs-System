'use client';

import { useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import type { KpiOptionSummary } from '@pulse/contracts';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export type KpiComboboxOption = KpiOptionSummary;

/** Searchable "link to KPI" picker — one control instead of a KPI select
 *  feeding an evaluation-area select, since most KPIs only ever have a
 *  handful of areas and typing beats two levels of clicking. Evaluation
 *  areas are still the actual selectable leaf (that's what a FormKpiMapping
 *  points at), just grouped and searchable by their parent KPI's name. */
export function KpiLinkCombobox({
  kpis,
  kpiId,
  evaluationAreaId,
  onSelect,
  onClear,
  disabled,
}: {
  kpis: KpiComboboxOption[] | null;
  kpiId: string;
  evaluationAreaId: string;
  onSelect: (kpiId: string, evaluationAreaId: string) => void;
  onClear: () => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selectedKpi = kpis?.find((k) => k.id === kpiId);
  const selectedArea = selectedKpi?.evaluationAreas.find((a) => a.id === evaluationAreaId);
  const label = selectedKpi && selectedArea ? `${selectedKpi.name} — ${selectedArea.name}` : 'not linked';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled || kpis === null}
          className="w-full justify-between font-normal"
        >
          <span className={cn('truncate', !selectedArea && 'text-muted-foreground')}>
            {kpis === null ? 'loading…' : label}
          </span>
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[340px] p-0" align="start">
        <Command>
          <CommandInput placeholder="search KPIs…" />
          <CommandList>
            <CommandEmpty>no KPI matches.</CommandEmpty>
            {selectedArea && (
              <CommandGroup>
                <CommandItem
                  onSelect={() => {
                    onClear();
                    setOpen(false);
                  }}
                >
                  not linked
                </CommandItem>
              </CommandGroup>
            )}
            {kpis
              ?.filter((kpi) => kpi.evaluationAreas.some((a) => a.isActive))
              .map((kpi) => (
                <CommandGroup key={kpi.id} heading={kpi.name}>
                  {kpi.evaluationAreas
                    .filter((a) => a.isActive)
                    .map((area) => (
                      <CommandItem
                        key={area.id}
                        value={`${kpi.name} ${area.name}`}
                        onSelect={() => {
                          onSelect(kpi.id, area.id);
                          setOpen(false);
                        }}
                      >
                        <Check
                          className={cn('mr-2 size-4', area.id === evaluationAreaId ? 'opacity-100' : 'opacity-0')}
                        />
                        {area.name}
                      </CommandItem>
                    ))}
                </CommandGroup>
              ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
