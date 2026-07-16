'use client';

import { api } from '../lib/api-client';
import { ComboboxPicker } from '@/components/ui/combobox-picker';

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
  triggerLabel = 'Add members',
}: {
  selectedIds: Set<string>;
  onToggle: (user: UserPickerOption) => void;
  disabled?: boolean;
  triggerLabel?: string;
}) {
  return (
    <ComboboxPicker<UserPickerOption>
      fetchItems={() => api<UserPickerOption[]>('/v1/users?pageSize=200')}
      getId={(u) => u.id}
      getSearchValue={(u) => `${u.displayName} ${u.email}`}
      renderItem={(u) => (
        <>
          <span className="truncate" style={{ flex: '0 1 auto' }}>
            {u.displayName}
          </span>
          <span className="truncate" style={{ flex: '1 1 auto', fontSize: 12, minWidth: 0, opacity: 0.65 }}>
            {u.email}
          </span>
        </>
      )}
      searchPlaceholder="Search people…"
      triggerLabel={triggerLabel}
      triggerVariant="outline"
      triggerSize="sm"
      disabled={disabled}
      selectedIds={selectedIds}
      onSelect={onToggle}
    />
  );
}
