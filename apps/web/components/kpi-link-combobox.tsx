'use client';

import AtlaskitSelect from '@atlaskit/select';

export interface KpiComboboxOption {
  id: string;
  name: string;
  evaluationAreas: Array<{ id: string; name: string; isActive: boolean }>;
}

type AreaOption = { value: string; label: string; kpiId: string };
type NotLinkedOption = { value: '__unlinked__'; label: string; kpiId: null };
type OptionType = AreaOption | NotLinkedOption;

/** Searchable "link to KPI" picker — one control instead of a KPI select
 *  feeding an evaluation-area select, since most KPIs only ever have a
 *  handful of areas and typing beats two levels of clicking. Evaluation
 *  areas are still the actual selectable leaf (that's what a FormKpiMapping
 *  points at), just grouped and searchable by their parent KPI's name.
 *
 *  Previously a Radix Popover + cmdk Command (shadcn's "combobox" recipe) —
 *  neither has an Atlaskit equivalent, but Atlaskit's Select (react-select)
 *  already does grouped, searchable, keyboard-navigable options natively,
 *  so this is a single Select with grouped options instead of a hand-rolled
 *  popover + filtered list. */
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
  const selectedKpi = kpis?.find((k) => k.id === kpiId);
  const selectedArea = selectedKpi?.evaluationAreas.find((a) => a.id === evaluationAreaId);

  const groups = (kpis ?? [])
    .filter((kpi) => kpi.evaluationAreas.some((a) => a.isActive))
    .map((kpi) => ({
      label: kpi.name,
      options: kpi.evaluationAreas
        .filter((a) => a.isActive)
        .map((area): AreaOption => ({ value: area.id, label: area.name, kpiId: kpi.id })),
    }));

  const notLinkedOption: NotLinkedOption = { value: '__unlinked__', label: 'not linked', kpiId: null };
  const options = selectedArea ? [{ label: '', options: [notLinkedOption] }, ...groups] : groups;

  const selected: OptionType | null = selectedArea
    ? { value: selectedArea.id, label: selectedArea.name, kpiId: kpiId }
    : null;

  return (
    <AtlaskitSelect<OptionType>
      options={options}
      value={selected}
      placeholder={kpis === null ? 'loading…' : 'search KPIs…'}
      isLoading={kpis === null}
      isDisabled={disabled || kpis === null}
      isSearchable
      getOptionValue={(option) => option.value}
      onChange={(option) => {
        if (!option || option.kpiId === null) {
          onClear();
        } else {
          onSelect(option.kpiId, option.value);
        }
      }}
    />
  );
}
