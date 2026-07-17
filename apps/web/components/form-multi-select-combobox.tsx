'use client';

import type { FormListItem } from '@pulse/contracts';
import { api } from '../lib/api-client';
import { ComboboxPicker } from '@/components/ui/combobox-picker';

/** Searchable multi-select of Forms, same stays-open/checkmark pattern as
 *  UserMultiSelectCombobox — powers the dashboard's form-scope picker. */
export function FormMultiSelectCombobox({
  selectedIds,
  onToggle,
  disabled,
  triggerLabel = 'Choose a form',
}: {
  selectedIds: Set<string>;
  onToggle: (form: FormListItem) => void;
  disabled?: boolean;
  triggerLabel?: string;
}) {
  return (
    <ComboboxPicker<FormListItem>
      fetchItems={() =>
        // /v1/forms is the admin management list and deliberately includes
        // archived forms (so "unarchive" stays reachable there) — this picker
        // is choosing which forms feed the live dashboard, where an archived
        // form is never a meaningful choice, so it's excluded here instead.
        api<FormListItem[]>('/v1/forms').then((all) => all.filter((f) => f.status !== 'archived'))
      }
      getId={(f) => f.id}
      getSearchValue={(f) => f.title}
      renderItem={(f) => (
        <>
          <span className="truncate" style={{ flex: '1 1 auto', minWidth: 0 }}>
            {f.title}
          </span>
          <span className="truncate" style={{ flex: '0 0 auto', fontSize: 12, opacity: 0.65 }}>
            {f.status}
          </span>
        </>
      )}
      searchPlaceholder="Search forms…"
      triggerLabel={triggerLabel}
      triggerVariant="outline"
      triggerSize="sm"
      disabled={disabled}
      selectedIds={selectedIds}
      onSelect={onToggle}
    />
  );
}
